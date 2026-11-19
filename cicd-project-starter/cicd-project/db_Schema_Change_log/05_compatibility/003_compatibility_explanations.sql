-- Apply after 002_compatibility_filters.sql.
BEGIN;

CREATE OR REPLACE FUNCTION public.explain_profile_compatibility(p_candidate uuid)
RETURNS TABLE (
  alignment integer, fits_your_preferences text, fits_their_preferences text,
  shared_interests text[], shared_goal boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH eligible AS MATERIALIZED (
    SELECT viewer, candidate
    FROM public.discoverable_profiles viewer
    CROSS JOIN public.discoverable_profiles candidate
    WHERE viewer.user_id = auth.uid()
      AND candidate.user_id = p_candidate
      AND public.profile_browsing_state() = 'available'
      AND public.can_match_users(viewer.user_id, candidate.user_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.profile_browse_actions hidden
        WHERE hidden.viewer_id = viewer.user_id AND hidden.target_user_id = candidate.user_id
          AND hidden.action = 'hidden'
      )
  ), fits AS MATERIALIZED (
    SELECT viewer, candidate,
      public.directional_preference_fit(viewer, candidate) AS forward,
      public.directional_preference_fit(candidate, viewer) AS reverse
    FROM eligible
  )
  SELECT (
    round(20 * CASE
      WHEN forward IS NULL AND reverse IS NULL THEN NULL
      WHEN forward = 0 OR reverse = 0 THEN 0
      ELSE 2 * coalesce(forward, 0.5) * coalesce(reverse, 0.5)
        / (coalesce(forward, 0.5) + coalesce(reverse, 0.5))
    END) * 5
  )::integer,
  CASE WHEN forward >= 0.75 THEN 'strong' WHEN forward >= 0.5 THEN 'moderate'
    WHEN forward IS NOT NULL THEN 'low' END,
  CASE WHEN reverse >= 0.75 THEN 'strong' WHEN reverse >= 0.5 THEN 'moderate'
    WHEN reverse IS NOT NULL THEN 'low' END,
  ARRAY(
    SELECT unnest((viewer).interests)
    INTERSECT SELECT unnest((candidate).interests)
    ORDER BY 1
  ),
  coalesce(
    nullif(lower(btrim((viewer).relationship_goal)), '') =
    nullif(lower(btrim((candidate).relationship_goal)), ''), false
  )
  FROM fits;
$$;

REVOKE ALL ON FUNCTION public.explain_profile_compatibility(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.explain_profile_compatibility(uuid) TO authenticated;

COMMIT;
