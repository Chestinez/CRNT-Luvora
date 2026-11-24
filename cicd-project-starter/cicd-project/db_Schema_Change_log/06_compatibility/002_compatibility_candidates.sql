BEGIN;

-- Retire the five optional questions if an earlier prototype saved them.
-- The update trigger preserves concurrency by advancing affected revisions.
UPDATE public.compatibility_assessments
SET answers = answers - ARRAY['goals-04','communication-04','lifestyle-04','interests-04','values-02'],
    partner_preferences = partner_preferences - ARRAY['goals-04','communication-04','lifestyle-04','interests-04','values-02'],
    skipped_question_ids = '[]'::jsonb
WHERE answers ?| ARRAY['goals-04','communication-04','lifestyle-04','interests-04','values-02']
   OR partner_preferences ?| ARRAY['goals-04','communication-04','lifestyle-04','interests-04','values-02']
   OR skipped_question_ids <> '[]'::jsonb;


-- Server-only bridge. Raw answers must never be exposed through browser RPCs.
CREATE FUNCTION public.compatibility_candidate_snapshots()
RETURNS TABLE (viewer jsonb, candidate jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    jsonb_build_object('profile', to_jsonb(me), 'preferences', to_jsonb(mp), 'assessment', to_jsonb(ma)),
    jsonb_build_object('profile', to_jsonb(other), 'is_saved', EXISTS (SELECT 1 FROM public.profile_browse_actions saved WHERE saved.viewer_id = me.user_id AND saved.target_user_id = other.user_id AND saved.action = 'saved'), 'preferences', to_jsonb(op), 'assessment', to_jsonb(oa))
  FROM public.discoverable_profiles me
  LEFT JOIN public.user_preferences mp ON mp.user_id = me.user_id
  LEFT JOIN public.compatibility_assessments ma ON ma.user_id = me.user_id
  JOIN public.discoverable_profiles other ON other.user_id <> me.user_id
  LEFT JOIN public.user_preferences op ON op.user_id = other.user_id
  LEFT JOIN public.compatibility_assessments oa ON oa.user_id = other.user_id
  WHERE me.user_id = auth.uid()
    AND public.profile_browsing_state() = 'available'
    AND public.can_match_users(me.user_id, other.user_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.profile_browse_actions hidden
      WHERE hidden.action = 'hidden'
        AND ((hidden.viewer_id = me.user_id AND hidden.target_user_id = other.user_id)
          OR (hidden.viewer_id = other.user_id AND hidden.target_user_id = me.user_id))
    )
  ORDER BY other.user_id
  LIMIT 500;
$$;

REVOKE ALL ON FUNCTION public.compatibility_candidate_snapshots() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compatibility_candidate_snapshots() TO service_role;

COMMIT;
