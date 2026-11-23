-- Apply after 05_compatibility/003_compatibility_explanations.sql.
BEGIN;

-- Keep only the active Like and the first connection request per person and target.
-- Each snapshot describes the target at the time of the action.
CREATE TABLE IF NOT EXISTS public.profile_learning_evidence (
  viewer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  signal text NOT NULL CHECK (signal IN ('save', 'request')),
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  traits jsonb NOT NULL,
  interests text[] NOT NULL,
  PRIMARY KEY (viewer_id, target_id, signal),
  CHECK (viewer_id <> target_id)
);

ALTER TABLE public.profile_learning_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_learning_evidence FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX IF NOT EXISTS ranking_snapshots_for_you_items
  ON public.ranking_snapshots USING gin (item_ids) WHERE mode = 'for-you';

CREATE OR REPLACE FUNCTION public.capture_profile_learning(p_viewer uuid, p_target uuid, p_signal text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_enabled boolean;
BEGIN
  -- Consent changes and resets take an exclusive lock on this same profile row.
  SELECT allow_behavioural_personalization INTO v_enabled
  FROM public.profiles WHERE user_id = p_viewer FOR SHARE;
  IF v_enabled IS DISTINCT FROM true OR NOT public.can_match_users(p_viewer, p_target) THEN
    RETURN;
  END IF;

  INSERT INTO public.profile_learning_evidence (viewer_id, target_id, signal, traits, interests)
  SELECT p_viewer, p_target, p_signal,
    coalesce((SELECT jsonb_object_agg(trait_key, score) FROM public.user_traits
      WHERE user_id = p_target), '{}'::jsonb),
    ARRAY(SELECT interest.slug FROM public.user_interests ui
      JOIN public.interests interest ON interest.id = ui.interest_id
      WHERE ui.user_id = p_target ORDER BY interest.slug)
  ON CONFLICT (viewer_id, target_id, signal) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_profile_learning_action()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.profile_learning_evidence
    WHERE viewer_id = OLD.viewer_id AND target_id = OLD.target_user_id AND signal = 'save';
  ELSIF TG_TABLE_NAME = 'match_requests' THEN
    PERFORM public.capture_profile_learning(NEW.sender_id, NEW.recipient_id, 'request');
  ELSE
    PERFORM public.capture_profile_learning(NEW.viewer_id, NEW.target_user_id, 'save');
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS learn_from_profile_save ON public.profile_browse_actions;
CREATE TRIGGER learn_from_profile_save AFTER INSERT ON public.profile_browse_actions
FOR EACH ROW WHEN (NEW.action = 'saved') EXECUTE FUNCTION public.capture_profile_learning_action();
DROP TRIGGER IF EXISTS undo_profile_save_evidence ON public.profile_browse_actions;
CREATE TRIGGER undo_profile_save_evidence AFTER DELETE ON public.profile_browse_actions
FOR EACH ROW WHEN (OLD.action = 'saved') EXECUTE FUNCTION public.capture_profile_learning_action();
DROP TRIGGER IF EXISTS learn_from_profile_request ON public.match_requests;
CREATE TRIGGER learn_from_profile_request AFTER INSERT ON public.match_requests
FOR EACH ROW WHEN (NEW.status = 'pending') EXECUTE FUNCTION public.capture_profile_learning_action();

-- Consent changes invalidate any saved personalized order that could have used this actor's evidence.
CREATE OR REPLACE FUNCTION public.clear_profile_learning(p_viewer uuid)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- Serialize reset and opt-out against the creation of personalized snapshots.
  PERFORM pg_advisory_xact_lock(612834, 1);
  DELETE FROM public.profile_learning_evidence WHERE viewer_id = p_viewer;
  DELETE FROM public.ranking_snapshots
  WHERE mode = 'for-you' AND (viewer_id = p_viewer OR item_ids @> ARRAY[p_viewer]);
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_profile_learning_on_opt_out()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.clear_profile_learning(NEW.user_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS clear_learning_on_opt_out ON public.profiles;
CREATE TRIGGER clear_learning_on_opt_out AFTER UPDATE OF allow_behavioural_personalization
ON public.profiles FOR EACH ROW
WHEN (OLD.allow_behavioural_personalization AND NOT NEW.allow_behavioural_personalization)
EXECUTE FUNCTION public.clear_profile_learning_on_opt_out();

CREATE OR REPLACE FUNCTION public.manage_profile_learning(p_enabled boolean, p_reset boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_viewer uuid := auth.uid(); v_enabled boolean;
BEGIN
  IF p_enabled IS NOT NULL OR p_reset THEN
    SELECT allow_behavioural_personalization INTO v_enabled
    FROM public.profiles WHERE user_id = v_viewer FOR UPDATE;
  ELSE
    SELECT allow_behavioural_personalization INTO v_enabled
    FROM public.profiles WHERE user_id = v_viewer;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile learning is unavailable.' USING ERRCODE = 'LV403'; END IF;

  IF p_enabled IS DISTINCT FROM v_enabled AND p_enabled IS NOT NULL THEN
    UPDATE public.profiles SET allow_behavioural_personalization = p_enabled WHERE user_id = v_viewer;
    v_enabled := p_enabled;
  END IF;
  IF p_reset THEN PERFORM public.clear_profile_learning(v_viewer); END IF;
  RETURN v_enabled;
END;
$$;

-- Build one learning model per consented actor using their strongest signal per target.
CREATE OR REPLACE FUNCTION public.profile_learning_models(p_actors uuid[])
RETURNS TABLE (actor uuid, window_days integer, confidence double precision, traits jsonb, interests jsonb)
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH signals AS MATERIALIZED (
    SELECT DISTINCT ON (e.viewer_id, e.target_id) e.*,
      extract(epoch FROM statement_timestamp() - e.recorded_at)::double precision / 86400 AS age_days,
      CASE e.signal WHEN 'request' THEN 1.0 ELSE 0.20 END AS weight
    FROM public.profile_learning_evidence e
    JOIN public.profiles p ON p.user_id = e.viewer_id AND p.allow_behavioural_personalization
    WHERE e.viewer_id = ANY(p_actors) AND e.recorded_at <= statement_timestamp()
      AND (e.traits <> '{}'::jsonb OR cardinality(e.interests) > 0)
      AND public.profile_is_matchable(e.target_id)
      AND NOT EXISTS (
        SELECT FROM public.blocks b
        WHERE (b.blocker_id, b.blocked_id) IN ((e.viewer_id, e.target_id), (e.target_id, e.viewer_id))
      )
      AND NOT EXISTS (
        SELECT FROM public.profile_browse_actions h
        WHERE h.viewer_id = e.viewer_id AND h.target_user_id = e.target_id AND h.action = 'hidden'
      )
    ORDER BY e.viewer_id, e.target_id, weight DESC
  ), windows AS MATERIALIZED (
    SELECT signals.*, half_life, weight * power(2.0, -age_days / half_life) AS mass
    FROM signals CROSS JOIN (VALUES (30), (120)) AS decay(half_life)
  ), confidence AS (
    SELECT viewer_id, half_life,
      least(1, sum(mass) / 5) * least(1, count(*) FILTER (WHERE age_days <= 3 * half_life) / 4.0)
        * least(1, count(DISTINCT (recorded_at AT TIME ZONE 'UTC')::date)
            FILTER (WHERE age_days <= 3 * half_life) / 3.0) AS value
    FROM windows GROUP BY viewer_id, half_life
  ), numeric_features AS (
    SELECT viewer_id, half_life, key, sum(mass * (value::numeric / 50 - 1)) / (sum(mass) + 2) AS affinity
    FROM windows CROSS JOIN LATERAL jsonb_each(traits)
    GROUP BY viewer_id, half_life, key
  ), interest_features AS (
    SELECT viewer_id, half_life, interest, tanh(sum(mass) / 3) AS affinity
    FROM windows CROSS JOIN LATERAL unnest(interests) AS interest
    GROUP BY viewer_id, half_life, interest
  )
  SELECT c.viewer_id, c.half_life, c.value, n.features, i.features
  FROM confidence c
  LEFT JOIN (SELECT viewer_id, half_life, jsonb_object_agg(key, affinity) AS features
    FROM numeric_features GROUP BY viewer_id, half_life) n USING (viewer_id, half_life)
  LEFT JOIN (SELECT viewer_id, half_life, jsonb_object_agg(interest, affinity) AS features
    FROM interest_features GROUP BY viewer_id, half_life) i USING (viewer_id, half_life);
$$;

CREATE OR REPLACE FUNCTION public.profile_learning_fit(
  p_traits jsonb, p_interests text[], p_trait_affinity jsonb, p_interest_affinity jsonb
)
RETURNS double precision LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT 0.45 * coalesce((
      SELECT avg(coalesce((p_trait_affinity->>key)::double precision, 0) * (value::numeric / 50 - 1))
      FROM jsonb_each(p_traits)
    ), 0) + 0.55 * coalesce((
      SELECT avg(coalesce((p_interest_affinity->>interest)::double precision, 0))
      FROM unnest(p_interests) AS interest
    ), 0);
$$;

CREATE OR REPLACE FUNCTION public.reciprocal_profile_fit(p_forward numeric, p_reverse numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_forward IS NULL AND p_reverse IS NULL THEN NULL
    WHEN p_forward = 0 OR p_reverse = 0 THEN 0
    ELSE 2 * coalesce(p_forward, 0.5) * coalesce(p_reverse, 0.5)
      / (coalesce(p_forward, 0.5) + coalesce(p_reverse, 0.5))
  END;
$$;

CREATE OR REPLACE FUNCTION public.rank_profile_feed(
  p_order text, p_min_score integer, p_shared_only boolean, p_min_age integer, p_max_age integer,
  p_personalize boolean
)
RETURNS TABLE (user_id uuid, alignment integer, shared_count integer)
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH eligible AS MATERIALIZED (
    SELECT candidate AS profile, viewer AS viewer
    FROM public.discoverable_profiles viewer
    CROSS JOIN public.discoverable_profiles candidate
    WHERE viewer.user_id = auth.uid()
      AND candidate.age_years BETWEEN p_min_age AND p_max_age
      AND (NOT p_shared_only OR candidate.interests && viewer.interests)
      AND public.can_match_users(viewer.user_id, candidate.user_id)
      AND NOT EXISTS (
        SELECT FROM public.profile_browse_actions hidden
        WHERE hidden.viewer_id = viewer.user_id AND hidden.target_user_id = candidate.user_id
          AND hidden.action = 'hidden'
      )
  ), fits AS MATERIALIZED (
    SELECT (profile).user_id AS user_id, (profile).interests AS interests,
      (viewer).interests AS viewer_interests,
      public.directional_preference_fit(viewer, profile) AS forward,
      public.directional_preference_fit(profile, viewer) AS reverse,
      (SELECT count(*)::integer FROM (
        SELECT unnest((viewer).interests) INTERSECT SELECT unnest((profile).interests)
      ) AS shared) AS shared_count
    FROM eligible
  ), alignment AS MATERIALIZED (
    SELECT f.*, public.reciprocal_profile_fit(f.forward, f.reverse) AS score
    FROM fits f
  ), filtered AS MATERIALIZED (
    SELECT a.*, (round(a.score * 20) * 5)::integer AS displayed_score
    FROM alignment a
    WHERE p_min_score = 0 OR round(a.score * 20) * 5 >= p_min_score
  ), actors AS MATERIALIZED (
    SELECT auth.uid() AS id WHERE p_personalize
    UNION ALL
    SELECT f.user_id FROM filtered f WHERE p_personalize
  ), models AS MATERIALIZED (
    SELECT * FROM public.profile_learning_models(ARRAY(SELECT id FROM actors))
  ), traits AS MATERIALIZED (
    SELECT t.user_id, jsonb_object_agg(t.trait_key, t.score) AS values
    FROM public.user_traits t JOIN actors a ON a.id = t.user_id GROUP BY t.user_id
  ), learning AS (
    SELECT f.user_id, d.is_forward,
      sum(w.share * m.confidence) AS confidence,
      0.5 + 0.5 * sum(w.share * public.profile_learning_fit(t.values, d.interests, m.traits, m.interests)) AS fit
    FROM filtered f
    CROSS JOIN LATERAL (VALUES
      (true, auth.uid(), f.user_id, f.interests, f.forward),
      (false, f.user_id, auth.uid(), f.viewer_interests, f.reverse)
    ) AS d(is_forward, actor, target, interests, base_score)
    JOIN models m ON m.actor = d.actor
    JOIN (VALUES (30, 0.65), (120, 0.35)) AS w(half_life, share) ON w.half_life = m.window_days
    LEFT JOIN traits t ON t.user_id = d.target
    WHERE d.base_score IS NOT NULL AND (t.values IS NOT NULL OR cardinality(d.interests) > 0)
    GROUP BY f.user_id, d.is_forward
  )
  SELECT f.user_id, f.displayed_score, f.shared_count
  FROM filtered f
  LEFT JOIN learning a ON a.user_id = f.user_id AND a.is_forward
  LEFT JOIN learning b ON b.user_id = f.user_id AND NOT b.is_forward
  ORDER BY CASE WHEN p_order = 'shared' THEN f.shared_count END DESC,
    CASE WHEN coalesce(a.confidence, 0) = 0 AND coalesce(b.confidence, 0) = 0 THEN f.score
      ELSE public.reciprocal_profile_fit(
        f.forward + coalesce(0.30 * a.confidence * (a.fit - f.forward), 0)::numeric,
        f.reverse + coalesce(0.30 * b.confidence * (b.fit - f.reverse), 0)::numeric
      ) END DESC NULLS LAST, f.user_id;
$$;

CREATE OR REPLACE FUNCTION public.rank_compatible_profiles(
  p_order text, p_min_score integer, p_shared_only boolean, p_min_age integer, p_max_age integer
)
RETURNS TABLE (user_id uuid, alignment integer, shared_count integer)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT * FROM public.rank_profile_feed(p_order, p_min_score, p_shared_only, p_min_age, p_max_age, false);
$$;

-- Both modes use the existing cursor contract and live visibility checks.
CREATE OR REPLACE FUNCTION public.list_compatible_profiles(
  p_snapshot_id uuid, p_after integer, p_options jsonb
)
RETURNS TABLE (
  profile public.discoverable_profiles, is_saved boolean, snapshot_id uuid, item_position integer,
  alignment integer, shared_count integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_viewer uuid := auth.uid();
  v_snapshot_id uuid := p_snapshot_id;
  v_items uuid[];
  v_scores jsonb;
  v_mode text := coalesce(p_options->>'mode', 'compatibility');
  v_order text := coalesce(p_options->>'order', 'alignment');
  v_min_score text := coalesce(p_options->>'minScore', '0');
  v_shared_only text := coalesce(p_options->>'sharedOnly', 'false');
  v_min_age text := coalesce(p_options->>'minAge', '18');
  v_max_age text := coalesce(p_options->>'maxAge', '120');
  v_version text;
  v_personalize boolean := false;
BEGIN
  IF public.profile_browsing_state() <> 'available' THEN
    RAISE EXCEPTION 'Single-profile browsing is unavailable.' USING ERRCODE = 'LV403';
  END IF;
  IF p_after IS NULL OR p_after < 0 OR (v_snapshot_id IS NULL AND p_after <> 0)
     OR v_mode NOT IN ('compatibility', 'for-you') OR v_order NOT IN ('alignment', 'shared')
     OR v_min_score !~ '^(0|[1-9]?[05]|100)$' OR v_shared_only NOT IN ('true', 'false')
     OR v_min_age !~ '^[1-9][0-9]{1,2}$' OR v_max_age !~ '^[1-9][0-9]{1,2}$' THEN
    RAISE EXCEPTION 'Choose valid profile filters.' USING ERRCODE = 'LV400';
  END IF;
  IF v_min_age::integer < 18 OR v_max_age::integer > 120 OR v_min_age::integer > v_max_age::integer THEN
    RAISE EXCEPTION 'Choose a valid age range from 18 to 120.' USING ERRCODE = 'LV400';
  END IF;

  v_version := CASE WHEN v_mode = 'for-you' THEN 'learning-v1' ELSE 'structured-v2' END;
  IF v_mode = 'for-you' THEN
    PERFORM pg_advisory_xact_lock_shared(612834, 1);
    v_personalize := coalesce((SELECT allow_behavioural_personalization
      FROM public.profiles WHERE user_id = v_viewer), false);
  END IF;

  IF v_snapshot_id IS NULL THEN
    DELETE FROM public.ranking_snapshots
    WHERE viewer_id = v_viewer AND mode = v_mode AND expires_at <= now();

    SELECT array_agg(r.user_id ORDER BY r.ordinality),
      jsonb_agg(jsonb_build_object('alignment', r.alignment, 'shared', r.shared_count) ORDER BY r.ordinality)
    INTO v_items, v_scores
    FROM public.rank_profile_feed(
      v_order, v_min_score::integer, v_shared_only::boolean, v_min_age::integer, v_max_age::integer,
      v_personalize
    ) WITH ORDINALITY AS r;
    IF v_items IS NULL THEN RETURN; END IF;

    IF cardinality(v_items) > 30 THEN
      INSERT INTO public.ranking_snapshots (viewer_id, mode, algorithm_version, expires_at, item_ids, scores)
      VALUES (v_viewer, v_mode, v_version, now() + interval '15 minutes', v_items, v_scores)
      RETURNING id INTO v_snapshot_id;
    END IF;
  ELSE
    SELECT item_ids, scores INTO v_items, v_scores FROM public.ranking_snapshots
    WHERE id = v_snapshot_id AND viewer_id = v_viewer AND mode = v_mode
      AND algorithm_version = v_version AND expires_at > now();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'This profile list has expired. Reload it to continue.' USING ERRCODE = 'LV410';
    END IF;
  END IF;

  RETURN QUERY
  SELECT candidate, saved.target_user_id IS NOT NULL, v_snapshot_id, item.ordinality::integer,
    (v_scores->(item.ordinality::integer - 1)->>'alignment')::integer,
    (v_scores->(item.ordinality::integer - 1)->>'shared')::integer
  FROM unnest(v_items) WITH ORDINALITY AS item(user_id, ordinality)
  JOIN public.discoverable_profiles candidate ON candidate.user_id = item.user_id
  LEFT JOIN public.profile_browse_actions saved ON saved.viewer_id = v_viewer
    AND saved.target_user_id = candidate.user_id AND saved.action = 'saved'
  WHERE item.ordinality > p_after
    AND public.can_match_users(v_viewer, candidate.user_id)
    AND NOT EXISTS (
      SELECT FROM public.profile_browse_actions hidden
      WHERE hidden.viewer_id = v_viewer AND hidden.target_user_id = candidate.user_id
        AND hidden.action = 'hidden'
    )
  ORDER BY item.ordinality
  LIMIT 31;
END;
$$;

REVOKE ALL ON FUNCTION
  public.capture_profile_learning(uuid, uuid, text), public.capture_profile_learning_action(),
  public.clear_profile_learning(uuid), public.clear_profile_learning_on_opt_out(),
  public.profile_learning_models(uuid[]), public.profile_learning_fit(jsonb, text[], jsonb, jsonb),
  public.reciprocal_profile_fit(numeric, numeric),
  public.rank_profile_feed(text, integer, boolean, integer, integer, boolean),
  public.rank_compatible_profiles(text, integer, boolean, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.manage_profile_learning(boolean, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.manage_profile_learning(boolean, boolean) TO authenticated;

COMMIT;
