-- Luvora Discovery seed expansion | development Supabase project only.
-- Run Luvora_Demo_Seed.sql first. This expansion keeps the original six demo
-- accounts, block fixture, private profile, and approval draft available.
--
-- Optional: create these four confirmed email/password accounts through Auth
-- before running this file. Use passwords you choose. If an account is
-- absent, its profile is skipped. Rerun once the account exists.
--   luvora-leila@example.com  Leila | photography, coffee, art
--   luvora-jonah@example.com  Jonah | hiking, photography, cooking
--   luvora-nora@example.com   Nora  | reading, art, coffee
--   luvora-ravi@example.com   Ravi  | cooking, hiking, music
--
-- This adds two published Maya/Ethan stories and one Leila/Jonah story when
-- both optional partner accounts exist. Every story has topics and both
-- partners' approval on the same revision. Reruns preserve existing stories
-- and their edits. The optional profiles refresh their fixture fields.
-- Run this entire DO block as postgres with RLS enabled.

DO $luvora_discovery_expansion$
DECLARE
  fixture record;
  account_id uuid;
  maya_id uuid;
  ethan_id uuid;
  leila_id uuid;
  jonah_id uuid;
  maya_pair_id uuid;
  leila_pair_id uuid;
  extra_profiles integer := 0;
  extra_stories integer := 0;
  inserted_post_id uuid;
BEGIN
  -- Use the same lock as the original seed so demo changes run in order.
  PERFORM pg_advisory_xact_lock(1279546185, 1);

  SELECT r.id, a.id, b.id INTO maya_pair_id, maya_id, ethan_id
  FROM public.relationships r
  JOIN public.users a ON lower(a.email) = 'luvora-maya@example.com'
  JOIN public.users b ON lower(b.email) = 'luvora-ethan@example.com'
  WHERE r.user_low = least(a.id, b.id)
    AND r.user_high = greatest(a.id, b.id)
    AND r.status = 'active';

  IF maya_pair_id IS NULL THEN
    RAISE EXCEPTION 'Run the original Luvora demo seed and confirm Maya and Ethan have an active relationship.';
  END IF;

  -- Canonical interest tags feed the profile card's interest chips.
  INSERT INTO public.interests (slug, label)
  VALUES ('photography', 'Photography'), ('reading', 'Reading'), ('music', 'Music'),
         ('cooking', 'Cooking'), ('hiking', 'Hiking'), ('coffee', 'Coffee'), ('art', 'Art')
  ON CONFLICT (slug) DO NOTHING;

  FOR fixture IN
    SELECT * FROM (VALUES
      ('luvora-leila@example.com', 'Leila', DATE '1998-06-11', 'woman', 'she/her', 'ISFP', 'long-term',
       'I bring a film camera on rainy walks and remember cafés by their playlists.',
       ARRAY['photography', 'coffee', 'art']),
      ('luvora-jonah@example.com', 'Jonah', DATE '1998-01-20', 'man', 'he/him', 'ENFP', 'long-term',
       'I like weekend trails and the kind of dinner that turns into a three-hour conversation.',
       ARRAY['hiking', 'photography', 'cooking']),
      ('luvora-nora@example.com', 'Nora', DATE '2001-08-07', 'woman', 'she/her', 'INTJ', 'getting to know people',
       'Quiet bookshops, gallery afternoons, and an oat latte are my ideal Saturday.',
       ARRAY['reading', 'art', 'coffee']),
      ('luvora-ravi@example.com', 'Ravi', DATE '1999-12-03', 'man', 'he/him', 'ISTP', 'long-term',
       'I trade recipes with friends and make a playlist for every trip.',
       ARRAY['cooking', 'hiking', 'music'])
    ) AS people(email, display_name, dob, gender, pronouns, mbti, goal, bio, interests)
  LOOP
    SELECT a.id INTO account_id
    FROM auth.users a
    JOIN public.users u ON u.id = a.id AND u.account_status = 'active'
    JOIN public.profiles p ON p.user_id = a.id
    JOIN public.user_preferences pref ON pref.user_id = a.id
    WHERE lower(a.email) = fixture.email AND a.email_confirmed_at IS NOT NULL;

    IF account_id IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE public.profiles
    SET display_name = fixture.display_name, date_of_birth = fixture.dob, gender = fixture.gender,
        pronouns = fixture.pronouns, mbti_type = fixture.mbti, bio = fixture.bio,
        region_code = 'SG', relationship_goal = fixture.goal, is_discoverable = true,
        onboarding_completed_at = coalesce(onboarding_completed_at, now())
    WHERE user_id = account_id;

    UPDATE public.user_preferences
    SET min_age = 23, max_age = 34, preferred_regions = ARRAY['SG'],
        preferred_relationship_goals = ARRAY['long-term', 'getting to know people']
    WHERE user_id = account_id;

    -- Synthetic development fixture needed by discoverable_profiles.
    -- This path has no uploaded photo. Existing verification rows are kept.
    INSERT INTO public.face_verifications
      (user_id, storage_path, status, provider, submitted_at, reviewed_at)
    SELECT account_id, account_id::text || '/demo-fixture.jpg', 'approved',
           'luvora_discovery_seed', now(), now()
    WHERE NOT EXISTS (SELECT 1 FROM public.face_verifications WHERE user_id = account_id);

    INSERT INTO public.user_interests (user_id, interest_id)
    SELECT account_id, id FROM public.interests WHERE slug = ANY(fixture.interests)
    ON CONFLICT DO NOTHING;

    IF fixture.email = 'luvora-leila@example.com' THEN
      leila_id := account_id;
    ELSIF fixture.email = 'luvora-jonah@example.com' THEN
      jonah_id := account_id;
    END IF;
    extra_profiles := extra_profiles + 1;
  END LOOP;

  -- The second couple uses the real relationship relation. The existing
  -- trigger provisions its conversation and members. Existing pairs are kept.
  IF leila_id IS NOT NULL AND jonah_id IS NOT NULL THEN
    INSERT INTO public.relationships (user_low, user_high)
    VALUES (least(leila_id, jonah_id), greatest(leila_id, jonah_id))
    ON CONFLICT (user_low, user_high) DO NOTHING;

    SELECT id INTO leila_pair_id
    FROM public.relationships
    WHERE user_low = least(leila_id, jonah_id) AND user_high = greatest(leila_id, jonah_id)
      AND status = 'active';
  END IF;

  FOR fixture IN
    SELECT * FROM (VALUES
      ('dc200000-0000-4000-8000-000000000021'::uuid, maya_id, ethan_id, maya_pair_id,
       'Our Sunday market ritual',
       'We each choose an ingredient from the market and make something with both. This week, ginger and pears became a surprisingly good crumble.',
       interval '3 days', ARRAY['cooking', 'quality_time']),
      ('dc200000-0000-4000-8000-000000000022'::uuid, ethan_id, maya_id, maya_pair_id,
       'The route we nearly skipped',
       'The path looked too quiet on the map. It turned out to have a shady bench and the best view of the morning.',
       interval '2 days', ARRAY['hiking', 'outdoors']),
      ('dc200000-0000-4000-8000-000000000023'::uuid, leila_id, jonah_id, leila_pair_id,
       'A photo walk in the rain',
       'We took one roll of film and a single umbrella. When the rain got heavier, we traded the photo walk for coffee and talked until closing.',
       interval '1 day', ARRAY['photography', 'coffee'])
    ) AS stories(id, author_id, partner_id, relationship_id, title, caption, age, topics)
    WHERE relationship_id IS NOT NULL
  LOOP
    -- Start as a draft and use the approval trigger before publishing.
    INSERT INTO public.posts (id, author_id, relationship_id, title, caption, post_type, created_at)
    VALUES (fixture.id, fixture.author_id, fixture.relationship_id, fixture.title, fixture.caption,
            'relationship', now() - fixture.age)
    ON CONFLICT (id) DO NOTHING
    RETURNING id INTO inserted_post_id;

    IF inserted_post_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.post_topics (post_id, topic_key)
    SELECT inserted_post_id, topic FROM unnest(fixture.topics) AS t(topic);

    INSERT INTO public.post_participant_approvals (post_id, user_id, post_revision, approval_status)
    SELECT p.id, member.id, p.content_revision, 'approved'
    FROM public.posts p
    CROSS JOIN (VALUES (fixture.author_id), (fixture.partner_id)) AS member(id)
    WHERE p.id = inserted_post_id;

    UPDATE public.posts SET status = 'published', published_at = created_at + interval '1 hour'
    WHERE id = inserted_post_id;
    extra_stories := extra_stories + 1;
  END LOOP;

  RAISE NOTICE 'Discovery seed expansion: % optional profiles prepared, % new published stories.',
    extra_profiles, extra_stories;
END;
$luvora_discovery_expansion$;
