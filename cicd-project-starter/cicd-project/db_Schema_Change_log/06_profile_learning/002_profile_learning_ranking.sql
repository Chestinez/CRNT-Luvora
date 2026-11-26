-- Apply after 001_profile_learning.sql.

BEGIN;

-- Serialize the ranking change and cursor invalidation against For You requests.
SELECT pg_advisory_xact_lock(612834, 1);

-- Compare signals at their effective weight in each window before counting a target once.

CREATE OR REPLACE FUNCTION public.profile_learning_models(p_actors uuid[])
RETURNS TABLE (actor uuid, window_days integer, confidence double precision, traits jsonb, interests jsonb)
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH signals AS MATERIALIZED (
    SELECT e.*,
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
  ), decayed AS (
    SELECT signals.*, half_life, weight * power(2.0, -age_days / half_life) AS mass
    FROM signals CROSS JOIN (VALUES (30), (120)) AS decay(half_life)
  ), windows AS MATERIALIZED (
    SELECT DISTINCT ON (viewer_id, target_id, half_life) *
    FROM decayed
    ORDER BY viewer_id, target_id, half_life, mass DESC, recorded_at DESC, weight DESC
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

-- NULL marks a window with no learned traits or interests in common with the candidate.

CREATE OR REPLACE FUNCTION public.profile_learning_fit(
  p_traits jsonb, p_interests text[], p_trait_affinity jsonb, p_interest_affinity jsonb
)
RETURNS double precision LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN trait_fit IS NOT NULL OR interest_fit IS NOT NULL
    THEN 0.45 * coalesce(trait_fit, 0) + 0.55 * coalesce(interest_fit, 0) END
  FROM (
    SELECT (
      SELECT avg((p_trait_affinity->>key)::double precision * (value::numeric / 50 - 1))
      FROM jsonb_each(p_traits)
      WHERE p_trait_affinity ? key
    ) AS trait_fit, (
      SELECT avg((p_interest_affinity->>interest)::double precision)
      FROM unnest(p_interests) AS interest
      WHERE p_interest_affinity ? interest
    ) AS interest_fit
  ) AS overlap;
$$;

-- Each relevant window contributes a confidence-weighted delta from stated fit.

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
      sum(w.share * m.confidence * (0.5 + 0.5 * public.profile_learning_fit(
        t.values, d.interests, m.traits, m.interests
      ) - d.base_score)) AS adjustment
    FROM filtered f
    CROSS JOIN LATERAL (VALUES
      (true, auth.uid(), f.user_id, f.interests, f.forward),
      (false, f.user_id, auth.uid(), f.viewer_interests, f.reverse)
    ) AS d(is_forward, actor, target, interests, base_score)
    JOIN models m ON m.actor = d.actor
    JOIN (VALUES (30, 0.65), (120, 0.35)) AS w(half_life, share) ON w.half_life = m.window_days
    LEFT JOIN traits t ON t.user_id = d.target
    WHERE d.base_score IS NOT NULL
    GROUP BY f.user_id, d.is_forward
  )
  SELECT f.user_id, f.displayed_score, f.shared_count
  FROM filtered f
  LEFT JOIN learning a ON a.user_id = f.user_id AND a.is_forward
  LEFT JOIN learning b ON b.user_id = f.user_id AND NOT b.is_forward
  ORDER BY CASE WHEN p_order = 'shared' THEN f.shared_count END DESC,
    CASE WHEN a.adjustment IS NULL AND b.adjustment IS NULL THEN f.score
      ELSE public.reciprocal_profile_fit(
        f.forward + coalesce(0.30 * a.adjustment, 0)::numeric,
        f.reverse + coalesce(0.30 * b.adjustment, 0)::numeric
      ) END DESC NULLS LAST, f.user_id;
$$;

DELETE FROM public.ranking_snapshots WHERE mode = 'for-you';

COMMIT;
