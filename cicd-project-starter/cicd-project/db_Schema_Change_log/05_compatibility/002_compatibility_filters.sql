-- Apply after 001_structured_compatibility.sql.
BEGIN;

CREATE OR REPLACE FUNCTION public.rank_compatible_profiles(
  p_order text, p_min_score integer, p_shared_only boolean, p_min_age integer, p_max_age integer
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
    SELECT (profile).user_id AS user_id,
      public.directional_preference_fit(viewer, profile) AS forward,
      public.directional_preference_fit(profile, viewer) AS reverse,
      (SELECT count(*)::integer FROM (
        SELECT unnest((viewer).interests) INTERSECT SELECT unnest((profile).interests)
      ) AS shared) AS shared_count
    FROM eligible
  ), ranked AS (
    SELECT fits.user_id, fits.shared_count,
      CASE
        WHEN forward IS NULL AND reverse IS NULL THEN NULL
        WHEN forward = 0 OR reverse = 0 THEN 0
        ELSE 2 * coalesce(forward, 0.5) * coalesce(reverse, 0.5)
          / (coalesce(forward, 0.5) + coalesce(reverse, 0.5))
      END AS score
    FROM fits
  ), display_scores AS (
    SELECT ranked.*, (round(score * 20) * 5)::integer AS alignment
    FROM ranked
  )
  SELECT d.user_id, d.alignment, d.shared_count FROM display_scores d
  WHERE p_min_score = 0 OR d.alignment >= p_min_score
  ORDER BY CASE WHEN p_order = 'shared' THEN d.shared_count END DESC,
    d.score DESC NULLS LAST, d.user_id;
$$;

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
  v_order text := coalesce(p_options->>'order', 'alignment');
  v_min_score text := coalesce(p_options->>'minScore', '0');
  v_shared_only text := coalesce(p_options->>'sharedOnly', 'false');
  v_min_age text := coalesce(p_options->>'minAge', '18');
  v_max_age text := coalesce(p_options->>'maxAge', '120');
BEGIN
  IF public.profile_browsing_state() <> 'available' THEN
    RAISE EXCEPTION 'Single-profile browsing is unavailable.' USING ERRCODE = 'LV403';
  END IF;
  IF p_after IS NULL OR p_after < 0 OR (v_snapshot_id IS NULL AND p_after <> 0)
     OR v_order NOT IN ('alignment', 'shared')
     OR v_min_score !~ '^(0|[1-9]?[05]|100)$'
     OR v_shared_only NOT IN ('true', 'false')
     OR v_min_age !~ '^[1-9][0-9]{1,2}$' OR v_max_age !~ '^[1-9][0-9]{1,2}$' THEN
    RAISE EXCEPTION 'Choose valid Compatibility filters.' USING ERRCODE = 'LV400';
  END IF;
  IF v_min_age::integer < 18 OR v_max_age::integer > 120 OR v_min_age::integer > v_max_age::integer THEN
    RAISE EXCEPTION 'Choose a valid age range from 18 to 120.' USING ERRCODE = 'LV400';
  END IF;

  IF v_snapshot_id IS NULL THEN
    DELETE FROM public.ranking_snapshots
    WHERE viewer_id = v_viewer AND mode = 'compatibility' AND expires_at <= now();

    SELECT array_agg(r.user_id ORDER BY r.ordinality),
      jsonb_agg(jsonb_build_object('alignment', r.alignment, 'shared', r.shared_count) ORDER BY r.ordinality)
    INTO v_items, v_scores
    FROM public.rank_compatible_profiles(
      v_order, v_min_score::integer, v_shared_only::boolean, v_min_age::integer, v_max_age::integer
    ) WITH ORDINALITY AS r;
    IF v_items IS NULL THEN RETURN; END IF;

    IF cardinality(v_items) > 30 THEN
      INSERT INTO public.ranking_snapshots (viewer_id, mode, algorithm_version, expires_at, item_ids, scores)
      VALUES (v_viewer, 'compatibility', 'structured-v2', now() + interval '15 minutes', v_items, v_scores)
      RETURNING id INTO v_snapshot_id;
    END IF;
  ELSE
    SELECT item_ids, scores INTO v_items, v_scores FROM public.ranking_snapshots
    WHERE id = v_snapshot_id AND viewer_id = v_viewer AND mode = 'compatibility'
      AND algorithm_version = 'structured-v2' AND expires_at > now();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'This Compatibility list has expired. Reload it to continue.' USING ERRCODE = 'LV410';
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

REVOKE ALL ON FUNCTION public.rank_compatible_profiles(text, integer, boolean, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_compatible_profiles(uuid, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_compatible_profiles(uuid, integer, jsonb) TO authenticated;

COMMIT;
