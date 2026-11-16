-- Apply after 03_profile_actions_table. Existing relationships are established couples.
BEGIN;

ALTER TABLE public.relationships ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'dating'
  CHECK (stage IN ('talking', 'dating'));
ALTER TABLE public.match_requests ADD COLUMN IF NOT EXISTS close_reason text
  CHECK (close_reason IS NULL OR (status = 'cancelled' AND close_reason IN ('connection_started', 'unavailable')));

-- The primary key enforces one active pair per member across either side of a
-- relationship, including concurrent writes and clients using stricter isolation.
CREATE TABLE IF NOT EXISTS public.active_connection_members (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  relationship_id uuid NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE
);
ALTER TABLE public.active_connection_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.active_connection_members FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX IF NOT EXISTS active_connection_members_relationship
  ON public.active_connection_members(relationship_id);
LOCK TABLE public.relationships IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT member FROM public.relationships r
    CROSS JOIN LATERAL (VALUES (r.user_low), (r.user_high)) AS members(member)
    WHERE r.status = 'active' GROUP BY member HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Resolve existing overlapping active relationships before enabling Connections.';
  END IF;
END;
$$;

INSERT INTO public.active_connection_members (user_id, relationship_id)
SELECT members.user_id, r.id FROM public.relationships r
CROSS JOIN LATERAL (VALUES (r.user_low), (r.user_high)) AS members(user_id)
WHERE r.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM public.active_connection_members a
    WHERE a.user_id = members.user_id AND a.relationship_id = r.id
  );

CREATE OR REPLACE FUNCTION public.has_active_connection(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.active_connection_members WHERE user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.profile_browsing_state()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND account_status = 'active')
      THEN 'unavailable'
    WHEN public.has_active_connection(auth.uid()) THEN 'paused'
    ELSE 'available'
  END;
$$;

CREATE OR REPLACE FUNCTION public.profile_is_matchable(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.users u ON u.id = p.user_id
    WHERE p.user_id = p_user_id AND u.account_status = 'active' AND p.is_discoverable
      AND p.onboarding_completed_at IS NOT NULL
      AND p.date_of_birth <= (current_date - interval '18 years')::date
      AND (SELECT fv.status FROM public.face_verifications fv
           WHERE fv.user_id = p.user_id ORDER BY fv.submitted_at DESC, fv.id DESC LIMIT 1) = 'approved'
  ) AND NOT public.has_active_connection(p_user_id);
$$;

CREATE OR REPLACE FUNCTION public.can_view_profile(p_target_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.profile_browsing_state() = 'available' AND (
    p_target_user_id = auth.uid()
    OR (public.profile_is_matchable(p_target_user_id)
        AND NOT public.is_blocked_either_way(auth.uid(), p_target_user_id))
  );
$$;

CREATE OR REPLACE FUNCTION public.can_match_users(p_sender uuid, p_recipient uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_sender IS NOT NULL AND p_recipient IS NOT NULL AND p_sender <> p_recipient
    AND (auth.uid() IS NULL OR auth.uid() IN (p_sender, p_recipient))
    AND public.profile_is_matchable(p_sender) AND public.profile_is_matchable(p_recipient)
    AND NOT public.is_blocked_either_way(p_sender, p_recipient);
$$;

-- Couple stories need display names independently of single-profile browsing.
CREATE OR REPLACE FUNCTION public.couple_story_author(p_post_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT profile.display_name FROM public.posts post
  JOIN public.profiles profile ON profile.user_id = post.author_id
  WHERE post.id = p_post_id AND post.post_type = 'relationship'
    AND post.status = 'published' AND public.can_view_post(post.id);
$$;

CREATE OR REPLACE FUNCTION public.connection_member_name(p_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.display_name FROM public.profiles p JOIN public.users u ON u.id = p.user_id
  WHERE p.user_id = p_user_id AND u.account_status = 'active'
    AND NOT public.is_blocked_either_way(auth.uid(), p_user_id)
    AND (
      EXISTS (SELECT 1 FROM public.match_requests m
              WHERE m.pair_low = least(auth.uid(), p_user_id) AND m.pair_high = greatest(auth.uid(), p_user_id))
      OR EXISTS (SELECT 1 FROM public.relationships r
                 WHERE r.user_low = least(auth.uid(), p_user_id) AND r.user_high = greatest(auth.uid(), p_user_id))
    ) AND auth.uid() IS NOT NULL;
$$;

-- Acquire participant locks in UUID order before inspecting or changing a pair.
-- NO KEY UPDATE permits foreign key checks on the same users.
CREATE OR REPLACE FUNCTION public.lock_connection_members(p_one uuid, p_two uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT FROM public.users WHERE id IN (p_one, p_two) ORDER BY id FOR NO KEY UPDATE;
$$;

CREATE OR REPLACE FUNCTION public.guard_active_connection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.lock_connection_members(NEW.user_low, NEW.user_high);
  IF TG_OP = 'UPDATE' AND (OLD.user_low, OLD.user_high) IS DISTINCT FROM (NEW.user_low, NEW.user_high) THEN
    RAISE EXCEPTION 'Connection participants cannot change.' USING ERRCODE = 'LV409';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_active_connection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'ended' THEN
    DELETE FROM public.active_connection_members WHERE relationship_id = NEW.id;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN RETURN NEW; END IF;

  INSERT INTO public.active_connection_members(user_id, relationship_id)
  VALUES (NEW.user_low, NEW.id), (NEW.user_high, NEW.id);
  -- Different pairs may share pending invites even when their member locks differ.
  -- Take pending row locks in a consistent order across both transactions.
  WITH competing AS MATERIALIZED (
    SELECT id FROM public.match_requests
    WHERE status = 'pending'
      AND (sender_id IN (NEW.user_low, NEW.user_high) OR recipient_id IN (NEW.user_low, NEW.user_high))
    ORDER BY id FOR UPDATE
  )
  UPDATE public.match_requests m
  SET status = 'cancelled', close_reason = 'connection_started', responded_at = now()
  FROM competing WHERE m.id = competing.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_active_connection ON public.relationships;
CREATE TRIGGER guard_active_connection BEFORE INSERT OR UPDATE OF status, user_low, user_high
  ON public.relationships FOR EACH ROW EXECUTE FUNCTION public.guard_active_connection();
DROP TRIGGER IF EXISTS sync_active_connection ON public.relationships;
CREATE TRIGGER sync_active_connection AFTER INSERT OR UPDATE OF status
  ON public.relationships FOR EACH ROW EXECUTE FUNCTION public.sync_active_connection();

-- Close leftover pending invitations for pairs that predate this migration.
UPDATE public.match_requests
SET status = 'cancelled', close_reason = 'connection_started', responded_at = now()
WHERE status = 'pending' AND (
  public.has_active_connection(sender_id) OR public.has_active_connection(recipient_id)
);

-- Require the RPC so direct clients take the same locks as the Express API.
REVOKE INSERT ON public.match_requests FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS requests_send_only ON public.match_requests;

CREATE OR REPLACE FUNCTION public.send_match_request(p_target_id uuid)
RETURNS public.match_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_request public.match_requests;
BEGIN
  IF v_actor IS NULL OR p_target_id IS NULL OR v_actor = p_target_id THEN
    RAISE EXCEPTION 'Choose another profile.' USING ERRCODE = 'LV400';
  END IF;
  PERFORM public.lock_connection_members(v_actor, p_target_id);
  IF public.profile_browsing_state() = 'paused' THEN
    RAISE EXCEPTION 'Your connection has paused new requests.' USING ERRCODE = 'LV409';
  END IF;
  IF NOT public.can_match_users(v_actor, p_target_id) THEN
    RAISE EXCEPTION 'This profile is no longer available to connect.' USING ERRCODE = 'LV404';
  END IF;
  SELECT * INTO v_request FROM public.match_requests
  WHERE pair_low = least(v_actor, p_target_id) AND pair_high = greatest(v_actor, p_target_id)
    AND status = 'pending';
  IF FOUND THEN RETURN v_request; END IF;
  INSERT INTO public.match_requests (sender_id, recipient_id)
  VALUES (v_actor, p_target_id) RETURNING * INTO v_request;
  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_match_request(p_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_request public.match_requests; v_relationship_id uuid;
BEGIN
  SELECT * INTO v_request FROM public.match_requests WHERE id = p_request_id AND recipient_id = v_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found.' USING ERRCODE = 'LV404'; END IF;

  PERFORM public.lock_connection_members(v_request.sender_id, v_request.recipient_id);
  SELECT * INTO v_request FROM public.match_requests WHERE id = p_request_id AND recipient_id = v_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found.' USING ERRCODE = 'LV404'; END IF;
  IF v_request.status = 'accepted' THEN
    SELECT id INTO v_relationship_id FROM public.relationships
    WHERE source_request_id = p_request_id AND status = 'active';
    IF FOUND THEN RETURN v_relationship_id; END IF;
  END IF;
  IF v_request.close_reason = 'connection_started' THEN
    RAISE EXCEPTION 'This invitation closed because one of you connected with someone else.'
      USING ERRCODE = 'LV409';
  END IF;
  IF v_request.status <> 'pending' OR NOT public.can_match_users(v_request.sender_id, v_actor) THEN
    RAISE EXCEPTION 'This invitation is no longer available.' USING ERRCODE = 'LV409';
  END IF;

  UPDATE public.match_requests SET status = 'accepted', responded_at = now() WHERE id = p_request_id;
  INSERT INTO public.relationships (user_low, user_high, source_request_id, stage)
  VALUES (v_request.pair_low, v_request.pair_high, p_request_id, 'talking')
  ON CONFLICT (user_low, user_high) DO UPDATE
    SET status = 'active', ended_at = NULL, stage = 'talking', source_request_id = EXCLUDED.source_request_id
  RETURNING id INTO v_relationship_id;
  INSERT INTO public.interaction_events (viewer_id, target_user_id, event_type, idempotency_key)
  VALUES (v_actor, v_request.sender_id, 'connection_accepted', 'match-accepted:' || p_request_id::text)
  ON CONFLICT (viewer_id, idempotency_key) DO NOTHING;
  RETURN v_relationship_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_match_request(p_request_id uuid, p_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_request public.match_requests;
BEGIN
  SELECT * INTO v_request FROM public.match_requests WHERE id = p_request_id AND (
    (p_action = 'rejected' AND recipient_id = v_actor) OR (p_action = 'cancelled' AND sender_id = v_actor)
  );
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found.' USING ERRCODE = 'LV404'; END IF;
  PERFORM public.lock_connection_members(v_request.sender_id, v_request.recipient_id);
  SELECT * INTO v_request FROM public.match_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found.' USING ERRCODE = 'LV404'; END IF;
  IF v_request.status = p_action AND v_request.close_reason IS NULL THEN RETURN; END IF;
  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'This invitation is already closed.' USING ERRCODE = 'LV409';
  END IF;
  UPDATE public.match_requests SET status = p_action, responded_at = now() WHERE id = p_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_talking_connection(p_relationship_id uuid, p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pair public.relationships;
BEGIN
  SELECT * INTO v_pair FROM public.relationships
  WHERE id = p_relationship_id AND auth.uid() IN (user_low, user_high);
  IF NOT FOUND THEN RAISE EXCEPTION 'Connection not found.' USING ERRCODE = 'LV404'; END IF;
  PERFORM public.lock_connection_members(v_pair.user_low, v_pair.user_high);
  SELECT * INTO v_pair FROM public.relationships WHERE id = p_relationship_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Connection not found.' USING ERRCODE = 'LV404'; END IF;
  IF p_request_id IS NULL OR v_pair.stage <> 'talking' OR v_pair.source_request_id IS DISTINCT FROM p_request_id THEN
    RAISE EXCEPTION 'This connection has changed.' USING ERRCODE = 'LV409';
  END IF;
  UPDATE public.relationships SET status = 'ended', ended_at = now()
  WHERE id = p_relationship_id AND status = 'active';
END;
$$;

CREATE OR REPLACE FUNCTION public.end_relationship(p_relationship_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pair public.relationships;
BEGIN
  SELECT * INTO v_pair FROM public.relationships
  WHERE id = p_relationship_id AND auth.uid() IN (user_low, user_high);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a relationship participant' USING ERRCODE = '42501';
  END IF;
  PERFORM public.lock_connection_members(v_pair.user_low, v_pair.user_high);
  -- Talking connections use end_talking_connection and its invitation ID.
  -- The pair ID alone can refer to a later connection between the same people.
  UPDATE public.relationships SET status = 'ended', ended_at = now()
  WHERE id = p_relationship_id AND status = 'active' AND stage = 'dating'
    AND source_request_id IS NOT DISTINCT FROM v_pair.source_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_blocked_connection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.lock_connection_members(NEW.blocker_id, NEW.blocked_id);
  UPDATE public.match_requests SET status = 'cancelled', close_reason = 'unavailable', responded_at = now()
  WHERE pair_low = least(NEW.blocker_id, NEW.blocked_id)
    AND pair_high = greatest(NEW.blocker_id, NEW.blocked_id) AND status = 'pending';
  UPDATE public.relationships SET status = 'ended', ended_at = now()
  WHERE user_low = least(NEW.blocker_id, NEW.blocked_id)
    AND user_high = greatest(NEW.blocker_id, NEW.blocked_id) AND status = 'active' AND stage = 'talking';
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS resolve_blocked_connection ON public.blocks;
CREATE TRIGGER resolve_blocked_connection BEFORE INSERT
  ON public.blocks FOR EACH ROW EXECUTE FUNCTION public.resolve_blocked_connection();

-- Resolve pending invitations that were blocked before the migration.
UPDATE public.match_requests m SET status = 'cancelled', close_reason = 'unavailable', responded_at = now()
WHERE m.status = 'pending' AND public.is_blocked_either_way(m.sender_id, m.recipient_id);

DROP POLICY profile_browse_actions_delete_own ON public.profile_browse_actions;
CREATE POLICY profile_browse_actions_delete_own ON public.profile_browse_actions
  FOR DELETE TO authenticated USING (
    viewer_id = (SELECT auth.uid()) AND (SELECT public.profile_browsing_state()) = 'available'
  );

DROP POLICY ranking_snapshot_read_owner ON public.ranking_snapshots;
CREATE POLICY ranking_snapshot_read_owner ON public.ranking_snapshots FOR SELECT TO authenticated
  USING (viewer_id = (SELECT auth.uid()) AND (SELECT public.profile_browsing_state()) = 'available');

CREATE OR REPLACE FUNCTION public.require_dating_couple_story()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.post_type = 'relationship' AND EXISTS (
    SELECT 1 FROM public.relationships WHERE id = NEW.relationship_id AND stage = 'talking'
  ) THEN
    RAISE EXCEPTION 'Couple stories require an established relationship.' USING ERRCODE = 'LV409';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS require_dating_couple_story ON public.posts;
CREATE TRIGGER require_dating_couple_story BEFORE INSERT OR UPDATE OF status, relationship_id, post_type
  ON public.posts FOR EACH ROW EXECUTE FUNCTION public.require_dating_couple_story();

REVOKE ALL ON FUNCTION public.has_active_connection(uuid), public.profile_is_matchable(uuid),
  public.lock_connection_members(uuid, uuid), public.guard_active_connection(),
  public.sync_active_connection(), public.resolve_blocked_connection(),
  public.require_dating_couple_story()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.profile_browsing_state(), public.couple_story_author(uuid),
  public.connection_member_name(uuid), public.send_match_request(uuid), public.end_talking_connection(uuid, uuid),
  public.accept_match_request(uuid), public.close_match_request(uuid, text), public.end_relationship(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_browsing_state(), public.couple_story_author(uuid),
  public.connection_member_name(uuid), public.send_match_request(uuid), public.end_talking_connection(uuid, uuid),
  public.accept_match_request(uuid), public.close_match_request(uuid, text), public.end_relationship(uuid)
  TO authenticated;

COMMIT;
