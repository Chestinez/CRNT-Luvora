-- Optional dev-only fixtures. Apply after the existing demo setup.
-- These Auth rows have no credentials and cannot be used for sign-in.
BEGIN;

INSERT INTO public.interests (slug, label) VALUES
  ('cooking', 'Cooking'), ('hiking', 'Hiking'), ('coffee', 'Coffee'),
  ('art', 'Art'), ('music', 'Music'), ('reading', 'Reading'),
  ('cycling', 'Cycling'), ('photography', 'Photography')
ON CONFLICT (slug) DO NOTHING;

DO $$
DECLARE
  n integer;
  fixture_id uuid;
  fixture_gender text;
  fixture_age integer;
  fixture_name text;
  goal text;
  hobbies text[];
  given_names text[] := ARRAY[
    'Adrian','Amina','Benedict','Brenda','Caleb','Chloe','Darren','Devi',
    'Elias','Enya','Farid','Fiona','Gavin','Grace','Harith','Hui Min',
    'Isaac','Iris','Jovan','Jia En','Kai','Kavya','Leon','Leah'
  ];
  surnames text[] := ARRAY['Tan','Lim','Wong','Raman'];
  goals text[] := ARRAY['long-term','long-term','getting to know people'];
BEGIN
  FOR n IN 1..80 LOOP
    fixture_id := ('f1400000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
    fixture_gender := CASE WHEN n % 2 = 1 THEN 'man' ELSE 'woman' END;
    fixture_name := given_names[1 + (n - 1) % 24] || ' ' || surnames[1 + (n - 1) / 24];
    fixture_age := CASE WHEN n > 76 THEN 36 ELSE 23 + (n * 7 - n / 7) % 12 END;
    goal := goals[1 + n % 3];
    hobbies := CASE n % 6
      WHEN 0 THEN ARRAY['cooking','hiking','coffee']
      WHEN 1 THEN ARRAY['cooking','photography']
      WHEN 2 THEN ARRAY['hiking','cycling']
      WHEN 3 THEN ARRAY['art','coffee','music']
      WHEN 4 THEN ARRAY['reading','music']
      ELSE ARRAY['photography','cycling']
    END;

    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (fixture_id, 'luvora-compat-' || n || '@example.test',
      jsonb_build_object('display_name', fixture_name, 'luvora_demo', 'compatibility'))
    ON CONFLICT (id) DO NOTHING;
    -- The signup trigger creates the profile; reruns leave existing fixtures as edited.
    IF NOT FOUND THEN CONTINUE; END IF;

    UPDATE public.profiles
    SET date_of_birth = (current_date - make_interval(years => fixture_age))::date,
        gender = fixture_gender, region_code = CASE WHEN n % 8 = 0 THEN 'MY' ELSE 'SG' END,
        relationship_goal = goal, onboarding_completed_at = now(), is_discoverable = true,
        bio = 'On a free weekend you’ll find me enjoying ' || array_to_string(hobbies, ', ') || '.'
    WHERE user_id = fixture_id;

    UPDATE public.user_preferences
    SET min_age = 23, max_age = 34, hard_age = true,
        preferred_genders = ARRAY[CASE WHEN fixture_gender = 'man' THEN 'woman' ELSE 'man' END],
        preferred_regions = ARRAY[CASE WHEN n % 9 = 0 THEN 'MY' ELSE 'SG' END],
        preferred_relationship_goals = ARRAY[goals[1 + (n / 4) % 3]]
    WHERE user_id = fixture_id;

    INSERT INTO public.user_interests (user_id, interest_id)
    SELECT fixture_id, id FROM public.interests WHERE slug = ANY(hobbies);

    INSERT INTO public.user_traits (user_id, trait_key, score)
    VALUES (fixture_id, 'sociability', 20 + n * 13 % 61);
    INSERT INTO public.preference_items (user_id, feature_key, desired_value)
    VALUES (fixture_id, 'sociability', 20 + n * 17 % 61);

    INSERT INTO public.face_verifications
      (user_id, storage_path, status, provider, submitted_at, reviewed_at)
    VALUES (fixture_id, fixture_id::text || '/demo-fixture.jpg',
      'approved', 'luvora_compatibility_demo', now(), now());
  END LOOP;
END;
$$;

COMMIT;
