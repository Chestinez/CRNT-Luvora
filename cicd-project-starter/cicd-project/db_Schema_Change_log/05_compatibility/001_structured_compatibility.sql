-- Apply after 04_connections. Uses the existing profiles and preference tables.
BEGIN;

CREATE OR REPLACE FUNCTION public.meets_matching_requirements(p_seeker uuid, p_candidate uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.user_preferences pref
    JOIN public.profiles candidate ON candidate.user_id = p_candidate
    WHERE pref.user_id = p_seeker AND (
      (pref.hard_age AND NOT coalesce(
        extract(year FROM age(current_date, candidate.date_of_birth))
          BETWEEN pref.min_age AND pref.max_age, false))
      OR (cardinality(pref.preferred_genders) > 0 AND NOT EXISTS (
        SELECT FROM unnest(pref.preferred_genders) AS allowed(value)
        WHERE lower(btrim(allowed.value)) = lower(btrim(candidate.gender))))
      OR (pref.hard_region AND NOT EXISTS (
        SELECT FROM unnest(pref.preferred_regions) AS allowed(value)
        WHERE lower(btrim(allowed.value)) = lower(btrim(candidate.region_code))))
      OR (pref.hard_goal AND NOT EXISTS (
        SELECT FROM unnest(pref.preferred_relationship_goals) AS allowed(value)
        WHERE lower(btrim(allowed.value)) = lower(btrim(candidate.relationship_goal))))
    )
  ) AND NOT EXISTS (
    SELECT 1 FROM public.preference_items required
    LEFT JOIN public.user_traits trait
      ON trait.user_id = p_candidate AND trait.trait_key = required.feature_key
    WHERE required.user_id = p_seeker AND required.is_required
      AND trait.score IS DISTINCT FROM required.desired_value
  );
$$;

-- Use the same reciprocal requirements for invitations and profile feeds.
CREATE OR REPLACE FUNCTION public.can_match_users(p_sender uuid, p_recipient uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_sender IS NOT NULL AND p_recipient IS NOT NULL AND p_sender <> p_recipient
    AND (auth.uid() IS NULL OR auth.uid() IN (p_sender, p_recipient))
    AND public.profile_is_matchable(p_sender) AND public.profile_is_matchable(p_recipient)
    AND NOT public.is_blocked_either_way(p_sender, p_recipient)
    AND public.meets_matching_requirements(p_sender, p_recipient)
    AND public.meets_matching_requirements(p_recipient, p_sender);
$$;

-- Each available category contributes once. Unknown soft inputs are omitted.
CREATE OR REPLACE FUNCTION public.directional_preference_fit(
  p_seeker public.discoverable_profiles, p_candidate public.discoverable_profiles
)
RETURNS numeric LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT avg(category.fit)
  FROM (SELECT 1) AS input
  LEFT JOIN public.user_preferences pref ON pref.user_id = p_seeker.user_id
  CROSS JOIN LATERAL (VALUES
    (CASE WHEN NOT pref.hard_age AND p_candidate.age_years IS NOT NULL THEN
      greatest(0, 1 - greatest(pref.min_age - p_candidate.age_years,
        p_candidate.age_years - pref.max_age, 0) / 10.0) END),
    (CASE WHEN NOT pref.hard_region AND cardinality(pref.preferred_regions) > 0
        AND p_candidate.region_code IS NOT NULL THEN
      EXISTS (SELECT FROM unnest(pref.preferred_regions) AS wanted(value)
        WHERE lower(btrim(wanted.value)) = lower(btrim(p_candidate.region_code)))::integer END),
    (CASE WHEN NOT pref.hard_goal AND cardinality(pref.preferred_relationship_goals) > 0
        AND p_candidate.relationship_goal IS NOT NULL THEN
      EXISTS (SELECT FROM unnest(pref.preferred_relationship_goals) AS wanted(value)
        WHERE lower(btrim(wanted.value)) = lower(btrim(p_candidate.relationship_goal)))::integer END),
    (CASE WHEN coalesce(pref.use_shared_interests, true) AND cardinality(p_seeker.interests) > 0
        AND cardinality(p_candidate.interests) > 0 THEN
      (SELECT count(*)::numeric FROM (
        SELECT unnest(p_seeker.interests) INTERSECT SELECT unnest(p_candidate.interests)
      ) AS shared) /
      (SELECT count(*) FROM (
        SELECT unnest(p_seeker.interests) UNION SELECT unnest(p_candidate.interests)
      ) AS combined) END),
    ((SELECT sum(item.importance_weight * (1 - abs(item.desired_value - trait.score) / 100))
             / sum(item.importance_weight)
      FROM public.preference_items item
      JOIN public.user_traits trait
        ON trait.user_id = p_candidate.user_id AND trait.trait_key = item.feature_key
      WHERE item.user_id = p_seeker.user_id AND NOT item.is_required))
  ) AS category(fit);
$$;

CREATE OR REPLACE FUNCTION public.rank_compatible_profiles()
RETURNS uuid[] LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH eligible AS MATERIALIZED (
    SELECT candidate AS profile, viewer AS viewer
    FROM public.discoverable_profiles viewer
    CROSS JOIN public.discoverable_profiles candidate
    WHERE viewer.user_id = auth.uid()
      AND public.can_match_users(viewer.user_id, candidate.user_id)
      AND NOT EXISTS (
        SELECT FROM public.profile_browse_actions hidden
        WHERE hidden.viewer_id = viewer.user_id AND hidden.target_user_id = candidate.user_id
          AND hidden.action = 'hidden'
      )
  ), directional AS MATERIALIZED (
    SELECT (eligible.profile).user_id AS user_id,
      public.directional_preference_fit(eligible.viewer, eligible.profile) AS forward,
      public.directional_preference_fit(eligible.profile, eligible.viewer) AS reverse
    FROM eligible
  ), ranked AS (
    SELECT directional.user_id,
      CASE
        WHEN forward IS NULL AND reverse IS NULL THEN -1
        WHEN forward = 0 OR reverse = 0 THEN 0
        ELSE 2 * coalesce(forward, 0.5) * coalesce(reverse, 0.5)
          / (coalesce(forward, 0.5) + coalesce(reverse, 0.5))
      END AS sort_score
    FROM directional
  )
  SELECT coalesce(array_agg(user_id ORDER BY sort_score DESC, user_id), '{}'::uuid[])
  FROM ranked;
$$;

-- Compatibility pages return live, eligible cards from a fixed ranking order.
-- The public RPC never returns the stored list or internal score components.
CREATE OR REPLACE FUNCTION public.list_compatible_profiles(p_snapshot_id uuid, p_after integer)
RETURNS TABLE (
  profile public.discoverable_profiles, is_saved boolean, snapshot_id uuid, item_position integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_viewer uuid := auth.uid();
  v_snapshot_id uuid := p_snapshot_id;
  v_items uuid[];
BEGIN
  IF public.profile_browsing_state() <> 'available' THEN
    RAISE EXCEPTION 'Single-profile browsing is unavailable.' USING ERRCODE = 'LV403';
  END IF;
  IF p_after IS NULL OR p_after < 0 OR (v_snapshot_id IS NULL AND p_after <> 0) THEN
    RAISE EXCEPTION 'Choose a valid Compatibility page.' USING ERRCODE = 'LV400';
  END IF;

  IF v_snapshot_id IS NULL THEN
    DELETE FROM public.ranking_snapshots
    WHERE viewer_id = v_viewer AND mode = 'compatibility' AND expires_at <= now();

    v_items := public.rank_compatible_profiles();
    IF cardinality(v_items) = 0 THEN RETURN; END IF;

    IF cardinality(v_items) > 30 THEN
      INSERT INTO public.ranking_snapshots (viewer_id, mode, algorithm_version, expires_at, item_ids, scores)
      VALUES (v_viewer, 'compatibility', 'structured-v1', now() + interval '15 minutes', v_items,
        to_jsonb(array_fill(NULL::numeric, ARRAY[cardinality(v_items)])))
      RETURNING id INTO v_snapshot_id;
    END IF;
  ELSE
    SELECT item_ids INTO v_items FROM public.ranking_snapshots
    WHERE id = v_snapshot_id AND viewer_id = v_viewer AND mode = 'compatibility' AND expires_at > now();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'This Compatibility list has expired. Reload it to continue.' USING ERRCODE = 'LV410';
    END IF;
  END IF;

  RETURN QUERY
  SELECT candidate, saved.target_user_id IS NOT NULL, v_snapshot_id, item.ordinality::integer
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

-- Keep cached item IDs behind the RPC so every page rechecks visibility.
DROP POLICY ranking_snapshot_read_owner ON public.ranking_snapshots;
CREATE POLICY ranking_snapshot_read_owner ON public.ranking_snapshots FOR SELECT TO authenticated
  USING (viewer_id = (SELECT auth.uid()) AND mode <> 'compatibility'
    AND (SELECT public.profile_browsing_state()) = 'available');

REVOKE ALL ON FUNCTION public.meets_matching_requirements(uuid, uuid),
  public.directional_preference_fit(public.discoverable_profiles, public.discoverable_profiles),
  public.rank_compatible_profiles()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_compatible_profiles(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_compatible_profiles(uuid, integer) TO authenticated;

COMMIT;
