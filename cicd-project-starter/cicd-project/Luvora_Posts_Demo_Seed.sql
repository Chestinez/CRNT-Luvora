-- Luvora demo seed | Run in a development Supabase project.
-- Create and confirm the six email/password accounts listed below in
-- Authentication > Users before running this file. Choose your own passwords.
-- Run the whole DO block in one go as postgres with RLS enabled.
--
-- Maya and Ethan: active couple with two published stories and a review draft.
-- Aisha and Daniel: discoverable singles who like cooking and hiking.
-- Mei: visible to Daniel; excluded from Aisha's results by a block.
-- Farah: a private profile that stays out of other users' Discovery results.
--
-- The seed restores demo profile fields and preferences on rerun. It preserves
-- existing story edits and publication state. The transaction rolls back on error.

DO $luvora_demo_seed$
DECLARE
  person record;
  story record;
  account_id uuid;
  missing_accounts text;
  maya_id uuid;
  ethan_id uuid;
  aisha_id uuid;
  mei_id uuid;
  pair_id uuid;
  pair_status text;
  inserted_story_id uuid;
  request_id constant uuid := 'dc200000-0000-4000-8000-000000000001';
BEGIN
  -- Serialize this demo seed if two people run it at once.
  PERFORM pg_advisory_xact_lock(1279546185, 1);

  -- Confirm the Auth accounts and the app rows created by the signup trigger.
  SELECT string_agg(required.email, ', ' ORDER BY required.email)
  INTO missing_accounts
  FROM unnest(ARRAY[
    'luvora-maya@example.com', 'luvora-ethan@example.com',
    'luvora-aisha@example.com', 'luvora-daniel@example.com',
    'luvora-mei@example.com', 'luvora-farah@example.com'
  ]) AS required(email)
  WHERE NOT EXISTS (
    SELECT 1
    FROM auth.users a
    JOIN public.users u ON u.id = a.id AND u.account_status = 'active'
    JOIN public.profiles p ON p.user_id = u.id
    JOIN public.user_preferences pref ON pref.user_id = u.id
    WHERE lower(a.email) = required.email AND a.email_confirmed_at IS NOT NULL
  );

  IF missing_accounts IS NOT NULL THEN
    RAISE EXCEPTION 'Missing confirmed demo accounts or signup-trigger records: %', missing_accounts;
  END IF;

  -- Store shared interest labels once, then attach them to individual profiles.
  INSERT INTO public.interests (slug, label)
  VALUES ('cooking', 'Cooking'), ('hiking', 'Hiking'), ('coffee', 'Coffee'), ('art', 'Art')
  ON CONFLICT (slug) DO NOTHING;

  -- Each fixture row resolves to the real UUID Supabase Auth assigned.
  FOR person IN
    SELECT * FROM (VALUES
      ('luvora-maya@example.com', 'Maya', DATE '1999-03-14', 'woman', 'ISFJ',
       'I make comfort food and collect recipes from the people I love.', true,
       ARRAY['cooking', 'coffee']),
      ('luvora-ethan@example.com', 'Ethan', DATE '1998-10-08', 'man', 'ENFP',
       'I like slow hikes, wet-market breakfasts, and trying new things with Maya.', true,
       ARRAY['hiking', 'cooking']),
      ('luvora-aisha@example.com', 'Aisha', DATE '2000-05-12', 'woman', 'INFJ',
       'A good weekend includes a trail, a new recipe, and time to recharge.', true,
       ARRAY['hiking', 'cooking']),
      ('luvora-daniel@example.com', 'Daniel', DATE '1999-07-23', 'man', 'ISTP',
       'I cook on Sundays and always pack extra snacks for a hike.', true,
       ARRAY['hiking', 'cooking', 'coffee']),
      ('luvora-mei@example.com', 'Mei', DATE '2000-02-10', 'woman', 'ENTP',
       'I like finding small galleries and talking about art over coffee.', true,
       ARRAY['art', 'coffee']),
      ('luvora-farah@example.com', 'Farah', DATE '2001-11-19', 'woman', 'INTJ',
       'My weekends are for sketching and reading.', false,
       ARRAY['art'])
    ) AS fixture(email, display_name, date_of_birth, gender, mbti_type, bio, discoverable, interest_slugs)
  LOOP
    SELECT id INTO STRICT account_id
    FROM auth.users
    WHERE lower(email) = person.email AND email_confirmed_at IS NOT NULL;

    UPDATE public.profiles
    SET display_name = person.display_name, date_of_birth = person.date_of_birth,
        gender = person.gender, mbti_type = person.mbti_type, bio = person.bio,
        region_code = 'SG', relationship_goal = 'long-term',
        is_discoverable = person.discoverable,
        onboarding_completed_at = coalesce(onboarding_completed_at, now())
    WHERE user_id = account_id;

    UPDATE public.user_preferences
    SET min_age = 23, max_age = 34, preferred_regions = ARRAY['SG'],
        preferred_relationship_goals = ARRAY['long-term'], use_shared_interests = true,
        preferred_genders = CASE person.gender WHEN 'woman' THEN ARRAY['man'] ELSE ARRAY['woman'] END
    WHERE user_id = account_id;

    -- This is synthetic verification evidence for the demo profile view.
    -- The placeholder path has no uploaded photo. Existing decisions are kept.
    INSERT INTO public.face_verifications
      (user_id, storage_path, status, provider, submitted_at, reviewed_at)
    SELECT account_id, account_id::text || '/demo-fixture.jpg', 'approved',
           'luvora_demo_seed', now(), now()
    WHERE NOT EXISTS (SELECT 1 FROM public.face_verifications WHERE user_id = account_id);

    INSERT INTO public.user_interests (user_id, interest_id)
    SELECT account_id, id FROM public.interests WHERE slug = ANY(person.interest_slugs)
    ON CONFLICT DO NOTHING;

    CASE person.email
      WHEN 'luvora-maya@example.com' THEN maya_id := account_id;
      WHEN 'luvora-ethan@example.com' THEN ethan_id := account_id;
      WHEN 'luvora-aisha@example.com' THEN aisha_id := account_id;
      WHEN 'luvora-mei@example.com' THEN mei_id := account_id;
      ELSE NULL;
    END CASE;
  END LOOP;

  -- Aisha and Mei should be filtered from each other's profile results.
  INSERT INTO public.blocks (blocker_id, blocked_id)
  VALUES (aisha_id, mei_id)
  ON CONFLICT DO NOTHING;

  -- An accepted request links the pair. The relationship trigger creates
  -- their conversation and adds both conversation members.
  SELECT id, status INTO pair_id, pair_status
  FROM public.relationships
  WHERE user_low = least(maya_id, ethan_id) AND user_high = greatest(maya_id, ethan_id);

  IF pair_id IS NULL THEN
    INSERT INTO public.match_requests (id, sender_id, recipient_id, status, created_at, responded_at)
    VALUES (request_id, maya_id, ethan_id, 'accepted', now() - interval '30 days', now() - interval '29 days')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.relationships (user_low, user_high, source_request_id, created_at)
    SELECT least(maya_id, ethan_id), greatest(maya_id, ethan_id), mr.id, mr.responded_at
    FROM public.match_requests mr
    WHERE mr.id = request_id AND mr.sender_id = maya_id AND mr.recipient_id = ethan_id
      AND mr.status = 'accepted'
    RETURNING id, status INTO pair_id, pair_status;
  END IF;

  IF pair_id IS NULL OR pair_status <> 'active' THEN
    RAISE EXCEPTION 'The Maya/Ethan demo pair needs an active relationship.';
  END IF;

  -- Create each story as a draft. Only newly inserted stories receive topics,
  -- approvals and publication so reruns preserve edits and approval state.
  FOR story IN
    SELECT * FROM (VALUES
      ('dc200000-0000-4000-8000-000000000011'::uuid, maya_id,
       'A recipe we finally got right', 'We burned the first batch, laughed about it, and tried again together.',
       interval '8 days', ARRAY['cooking', 'quality_time'], true),
      ('dc200000-0000-4000-8000-000000000012'::uuid, ethan_id,
       'A slow morning at the reservoir', 'We took the long route and stopped halfway for coffee.',
       interval '4 days', ARRAY['hiking', 'coffee'], true),
      ('dc200000-0000-4000-8000-000000000013'::uuid, maya_id,
       'Draft: our next weekend plan', 'We are choosing between a new trail and a cooking class.',
       interval '1 day', ARRAY['quality_time'], false)
    ) AS fixture(id, author_id, title, caption, age, topics, publish)
  LOOP
    INSERT INTO public.posts (id, author_id, relationship_id, title, caption, post_type, created_at)
    VALUES (story.id, story.author_id, pair_id, story.title, story.caption, 'relationship', now() - story.age)
    ON CONFLICT (id) DO NOTHING
    RETURNING id INTO inserted_story_id;

    IF inserted_story_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.post_topics (post_id, topic_key)
    SELECT inserted_story_id, topic FROM unnest(story.topics) AS t(topic);

    IF story.publish THEN
      -- Both partners approve the same current revision before publication.
      INSERT INTO public.post_participant_approvals (post_id, user_id, post_revision, approval_status)
      SELECT p.id, partner.id, p.content_revision, 'approved'
      FROM public.posts p
      CROSS JOIN (VALUES (maya_id), (ethan_id)) AS partner(id)
      WHERE p.id = inserted_story_id;

      UPDATE public.posts
      SET status = 'published', published_at = created_at + interval '1 day'
      WHERE id = inserted_story_id;
    END IF;
  END LOOP;

  RAISE NOTICE 'Luvora demo seed complete. Check public.posts for the demo stories.';
END;
$luvora_demo_seed$;
