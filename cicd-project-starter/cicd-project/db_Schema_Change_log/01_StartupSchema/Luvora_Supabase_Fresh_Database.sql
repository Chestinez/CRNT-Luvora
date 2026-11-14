-- ============================================================================
-- LUVORA  |  FRESH SUPABASE DATABASE SCHEMA  |  v1.0  (2026-11-13)
-- ============================================================================
-- HOW TO INSTALL
-- 1. Create a NEW Supabase project (with its default auth/storage schemas).
-- 2. Dashboard > SQL Editor > New query > paste this WHOLE file > Run.
--    Alternatively: psql -v ON_ERROR_STOP=1 -f Luvora_Supabase_Fresh_Database.sql
-- 3. Create accounts with Supabase Auth signUp() (NEVER insert into public.users).
-- 4. The auth.users trigger creates public.users/profiles/preferences/settings.
-- 5. Use the service-role ONLY from a trusted backend for verification, ranking,
--    moderation, embeddings, and issuing signed private-media URLs.
--
-- This is a full fresh-install PROPOSED baseline. Earlier discussions supplied
-- exact fields for 12 matching/discovery tables + additions to profiles,
-- user_preferences, posts. The ORIGINAL full onboarding/chat table definitions
-- were not attached, so those baseline entities are implemented here as an
-- explicit, coherent proposal (not asserted to be the team's original schema).
--
-- Key choices:
-- * UUID primary keys, except the ordered discovery_events.seq bigint identity.
-- * public.users.id references auth.users.id (Supabase manages passwords/email).
-- * ON DELETE CASCADE on the additional schema's FKs except
--   posts.relationship_id ON DELETE RESTRICT (as requested).
-- * Additional domain-specific SET NULL is used for optional reply/source links.
-- * The two pgvector 384-dimensional experiments are INCLUDED but service-only.
-- * Sensitive user data is self-only by default; discoverable profile fields are
--   exposed via a narrowly filtered view. Client never changes verified status.
-- * Storage buckets are PRIVATE; app backend issues signed URLs only after auth.
-- * Realtime Postgres Changes is enabled for chat messages and match requests.
-- * All public tables have RLS. RLS tests with real accounts are still required.
--
-- NOT IMPLEMENTED BY SQL ALONE: camera liveness/identity checks, MBTI scoring,
-- two-sided algorithm ranking, moderation, secure signed-URL authorization,
-- push notifications, encryption of uploaded media, and scheduled snapshot GC.
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ---------- DOMAIN HELPERS (immutable SQL for generated values/checks) --------
CREATE OR REPLACE FUNCTION public.zodiac_from_dob(p_date date)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_date IS NULL THEN NULL
    WHEN (extract(month FROM p_date)::int * 100 + extract(day FROM p_date)::int) BETWEEN 321 AND 419 THEN 'Aries'
    WHEN (extract(month FROM p_date)::int * 100 + extract(day FROM p_date)::int) BETWEEN 420 AND 520 THEN 'Taurus'
    WHEN (extract(month FROM p_date)::int * 100 + extract(day FROM p_date)::int) BETWEEN 521 AND 620 THEN 'Gemini'
    WHEN (extract(month FROM p_date)::int * 100 + extract(day FROM p_date)::int) BETWEEN 621 AND 722 THEN 'Cancer'
    WHEN (extract(month FROM p_date)::int * 100 + extract(day FROM p_date)::int) BETWEEN 723 AND 822 THEN 'Leo'
    WHEN (extract(month FROM p_date)::int * 100 + extract(day FROM p_date)::int) BETWEEN 823 AND 922 THEN 'Virgo'
    WHEN (extract(month FROM p_date)::int * 100 + extract(day FROM p_date)::int) BETWEEN 923 AND 1022 THEN 'Libra'
    WHEN (extract(month FROM p_date)::int * 100 + extract(day FROM p_date)::int) BETWEEN 1023 AND 1121 THEN 'Scorpio'
    WHEN (extract(month FROM p_date)::int * 100 + extract(day FROM p_date)::int) BETWEEN 1122 AND 1221 THEN 'Sagittarius'
    WHEN (extract(month FROM p_date)::int * 100 + extract(day FROM p_date)::int) >= 1222
      OR (extract(month FROM p_date)::int * 100 + extract(day FROM p_date)::int) <= 119 THEN 'Capricorn'
    WHEN (extract(month FROM p_date)::int * 100 + extract(day FROM p_date)::int) BETWEEN 120 AND 218 THEN 'Aquarius'
    ELSE 'Pisces'
  END;
$$;

CREATE OR REPLACE FUNCTION public.valid_nonblank_text_array(p_values text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_values IS NOT NULL
     AND array_position(p_values, NULL) IS NULL
     AND NOT EXISTS (SELECT 1 FROM unnest(p_values) AS x WHERE btrim(x) = '');
$$;

CREATE OR REPLACE FUNCTION public.valid_topic_array(p_values text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_values IS NOT NULL
     AND array_position(p_values, NULL) IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM unnest(p_values) AS x
       WHERE x !~ '^[a-z][a-z0-9_]{0,47}$'
     );
$$;

-- ================================ ACCOUNTS ==================================
CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  account_status text NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active','suspended','deactivated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT 'Luvora member'
    CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80),
  date_of_birth date,
  zodiac_sign text GENERATED ALWAYS AS (public.zodiac_from_dob(date_of_birth)) STORED,
  gender text CHECK (gender IS NULL OR char_length(btrim(gender)) BETWEEN 1 AND 40),
  pronouns text CHECK (pronouns IS NULL OR char_length(btrim(pronouns)) BETWEEN 1 AND 40),
  mbti_type text CHECK (mbti_type IS NULL OR mbti_type IN
    ('INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP',
     'ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP')),
  bio text CHECK (bio IS NULL OR char_length(bio) <= 2000),
  region_code text CHECK (region_code IS NULL OR btrim(region_code) <> ''),
  relationship_goal text CHECK (relationship_goal IS NULL OR btrim(relationship_goal) <> ''),
  is_discoverable boolean NOT NULL DEFAULT false,
  allow_behavioural_personalization boolean NOT NULL DEFAULT false,
  onboarding_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_adults_only CHECK (
    date_of_birth IS NULL OR date_of_birth <= (current_date - INTERVAL '18 years')::date
  )
);

CREATE TABLE public.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  min_age integer NOT NULL DEFAULT 18 CHECK (min_age BETWEEN 18 AND 120),
  max_age integer NOT NULL DEFAULT 100 CHECK (max_age BETWEEN 18 AND 120),
  preferred_genders text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (public.valid_nonblank_text_array(preferred_genders)),
  max_distance_km integer CHECK (max_distance_km IS NULL OR max_distance_km BETWEEN 1 AND 20000),
  preferred_regions text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (public.valid_nonblank_text_array(preferred_regions)),
  preferred_relationship_goals text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (public.valid_nonblank_text_array(preferred_relationship_goals)),
  hard_age boolean NOT NULL DEFAULT true,
  hard_region boolean NOT NULL DEFAULT false,
  hard_goal boolean NOT NULL DEFAULT false,
  use_shared_interests boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT preference_age_order CHECK (min_age <= max_age),
  CONSTRAINT hard_region_requires_choice CHECK (NOT hard_region OR cardinality(preferred_regions) > 0),
  CONSTRAINT hard_goal_requires_choice CHECK (NOT hard_goal OR cardinality(preferred_relationship_goals) > 0)
);

-- MBTI questions and scored answers: app/service computes profiles.mbti_type.
CREATE TABLE public.mbti_questions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  prompt text NOT NULL CHECK (btrim(prompt) <> ''),
  dimension text NOT NULL CHECK (dimension IN ('EI','SN','TF','JP')),
  display_order integer NOT NULL UNIQUE CHECK (display_order > 0),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.user_mbti_answers (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  question_id bigint NOT NULL REFERENCES public.mbti_questions(id) ON DELETE CASCADE,
  answer smallint NOT NULL CHECK (answer BETWEEN 1 AND 5),
  answered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);

-- Face photos are stored only in a PRIVATE Supabase Storage bucket.
-- Verification results must be set by trusted server using service role.
CREATE TABLE public.face_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL CHECK (btrim(storage_path) <> ''
     AND split_part(storage_path,'/',1)=user_id::text
     AND position('/' IN storage_path)>0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  provider text,
  provider_reference text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CONSTRAINT reviewed_status_has_time CHECK (
    (status = 'pending' AND reviewed_at IS NULL)
    OR (status IN ('approved','rejected') AND reviewed_at IS NOT NULL)
  )
);

CREATE TABLE public.interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9_]{0,47}$'),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 80)
);

CREATE TABLE public.user_interests (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  interest_id uuid NOT NULL REFERENCES public.interests(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, interest_id)
);

CREATE TABLE public.profile_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL CHECK (btrim(storage_path) <> ''
     AND split_part(storage_path,'/',1)=user_id::text
     AND position('/' IN storage_path)>0),
  is_primary boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, storage_path)
);
CREATE UNIQUE INDEX profile_photos_one_primary_per_user
  ON public.profile_photos(user_id) WHERE is_primary;

-- =============================== MATCHING ===================================
CREATE TABLE public.blocks (
  blocker_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE public.user_traits (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  trait_key text NOT NULL CHECK (btrim(trait_key) <> ''),
  score numeric(5,2) NOT NULL CHECK (score BETWEEN 0 AND 100),
  source text NOT NULL DEFAULT 'manual' CHECK (btrim(source) <> ''),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, trait_key)
);

CREATE TABLE public.preference_items (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  feature_key text NOT NULL CHECK (btrim(feature_key) <> ''),
  desired_value numeric(5,2) NOT NULL CHECK (desired_value BETWEEN 0 AND 100),
  importance_weight numeric(5,2) NOT NULL DEFAULT 1
    CHECK (importance_weight BETWEEN 0.01 AND 999.99),
  is_required boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, feature_key)
);

CREATE TABLE public.learned_preference_features (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  model_context text NOT NULL DEFAULT 'romantic' CHECK (model_context = 'romantic'),
  feature_key text NOT NULL CHECK (btrim(feature_key) <> ''),
  long_term_value numeric(7,3) NOT NULL DEFAULT 0 CHECK (long_term_value BETWEEN -1 AND 1),
  short_term_value numeric(7,3) NOT NULL DEFAULT 0 CHECK (short_term_value BETWEEN -1 AND 1),
  evidence_count integer NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, model_context, feature_key)
);

CREATE TABLE public.match_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  pair_low uuid GENERATED ALWAYS AS (least(sender_id,recipient_id)) STORED,
  pair_high uuid GENERATED ALWAYS AS (greatest(sender_id,recipient_id)) STORED,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','rejected','cancelled','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CHECK (sender_id <> recipient_id),
  CHECK ((status = 'pending' AND responded_at IS NULL)
     OR (status <> 'pending' AND responded_at IS NOT NULL))
);
CREATE UNIQUE INDEX match_requests_only_one_pending_per_pair
  ON public.match_requests(pair_low, pair_high) WHERE status = 'pending';

CREATE TABLE public.relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_low uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_high uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source_request_id uuid UNIQUE REFERENCES public.match_requests(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  UNIQUE (user_low, user_high),
  CHECK (user_low < user_high),
  CHECK ((status = 'active' AND ended_at IS NULL)
      OR (status = 'ended' AND ended_at IS NOT NULL))
);

-- Profile action events, NOT social post interactions.
CREATE TABLE public.interaction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'impression','profile_opened','profile_saved','profile_dismissed',
    'not_my_type','connection_requested','connection_accepted'
  )),
  event_context text NOT NULL DEFAULT 'romantic' CHECK (event_context = 'romantic'),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  target_bio_hash text,
  UNIQUE (viewer_id, idempotency_key),
  CHECK (viewer_id <> target_user_id),
  CHECK (target_bio_hash IS NULL OR (
    event_type IN ('profile_saved','connection_requested')
    AND target_bio_hash ~ '^[0-9a-f]{64}$'
  ))
);

CREATE TABLE public.ranking_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('compatibility','for-you')),
  algorithm_version text NOT NULL CHECK (btrim(algorithm_version) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  item_ids uuid[] NOT NULL,
  scores jsonb NOT NULL,
  CHECK (expires_at > created_at),
  CHECK (array_position(item_ids, NULL) IS NULL),
  CHECK (jsonb_typeof(scores) = 'array'),
  CHECK (jsonb_array_length(scores) = cardinality(item_ids))
);

-- ============================ CHAT / RELATIONSHIPS ===========================
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL UNIQUE
    REFERENCES public.relationships(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.conversation_members (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000),
  reply_to_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

CREATE TABLE public.message_reads (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

-- ============================== SOCIAL POSTS ================================
CREATE TABLE public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  caption text NOT NULL DEFAULT '' CHECK (char_length(caption) <= 10000),
  title text CHECK (title IS NULL OR btrim(title) <> ''),
  post_type text CHECK (post_type IS NULL OR post_type IN ('single','dating','relationship')),
  relationship_id uuid REFERENCES public.relationships(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  published_at timestamptz,
  content_revision bigint NOT NULL DEFAULT 1 CHECK (content_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_relationship_type_rule CHECK (
    (post_type IS DISTINCT FROM 'single' OR relationship_id IS NULL)
    AND (post_type IS DISTINCT FROM 'relationship' OR relationship_id IS NOT NULL)
  ),
  CONSTRAINT post_publication_consistency CHECK (
    (status = 'published' AND published_at IS NOT NULL)
    OR (status <> 'published' AND published_at IS NULL)
  )
);

CREATE TABLE public.post_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  storage_path text NOT NULL CHECK (btrim(storage_path) <> ''),
  media_type text NOT NULL CHECK (media_type IN ('image','video')),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, storage_path)
);

CREATE TABLE public.post_topics (
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  topic_key text NOT NULL CHECK (topic_key ~ '^[a-z][a-z0-9_]{0,47}$'),
  PRIMARY KEY (post_id, topic_key)
);

CREATE TABLE public.post_participant_approvals (
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  post_revision bigint NOT NULL CHECK (post_revision > 0),
  approval_status text NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending','approved','declined')),
  approved_at timestamptz,
  allow_pair_ranking boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id, post_revision),
  CHECK ((approval_status = 'approved' AND approved_at IS NOT NULL)
      OR (approval_status <> 'approved' AND approved_at IS NULL)),
  CHECK (NOT allow_pair_ranking OR approval_status = 'approved')
);

CREATE TABLE public.post_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ========================== STORY / TOPIC DISCOVERY ==========================
CREATE TABLE public.discovery_settings (
  viewer_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  reset_through bigint NOT NULL DEFAULT 0 CHECK (reset_through >= 0),
  muted_post_types text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (array_position(muted_post_types, NULL) IS NULL
       AND muted_post_types <@ ARRAY['single','dating','relationship']::text[]),
  muted_tags text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (public.valid_topic_array(muted_tags))
);

CREATE TABLE public.discovery_events (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  viewer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  topic text CHECK (topic IS NULL OR topic ~ '^[a-z][a-z0-9_]{0,47}$'),
  event_type text NOT NULL CHECK (event_type IN (
    'IMPRESSION','OPEN','LIKE','UNLIKE','SAVE','UNSAVE','MORE_LIKE_THIS',
    'NOT_INTERESTED','HIDE','FOLLOW_TOPIC','UNFOLLOW_TOPIC',
    'LESS_TOPIC','CLEAR_LESS_TOPIC'
  )),
  request_id uuid,
  position integer,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (viewer_id, event_id),
  CHECK ((post_id IS NOT NULL) <> (topic IS NOT NULL)),
  CHECK ((post_id IS NOT NULL AND event_type IN (
    'IMPRESSION','OPEN','LIKE','UNLIKE','SAVE','UNSAVE',
    'MORE_LIKE_THIS','NOT_INTERESTED','HIDE'
  )) OR (topic IS NOT NULL AND event_type IN (
    'FOLLOW_TOPIC','UNFOLLOW_TOPIC','LESS_TOPIC','CLEAR_LESS_TOPIC'
  ))),
  CHECK ((event_type = 'IMPRESSION' AND request_id IS NOT NULL AND position > 0)
     OR (event_type <> 'IMPRESSION' AND request_id IS NULL AND position IS NULL))
);
CREATE UNIQUE INDEX discovery_one_impression_per_delivery
  ON public.discovery_events(viewer_id,request_id,post_id)
  WHERE event_type = 'IMPRESSION';

CREATE TABLE public.discovery_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE TABLE public.discovery_deliveries (
  snapshot_id uuid NOT NULL REFERENCES public.discovery_snapshots(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position > 0),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  PRIMARY KEY (snapshot_id, position),
  UNIQUE (snapshot_id, post_id)
);

-- ======================= OPTIONAL ALGORITHM EMBEDDINGS =======================
-- Included for convenience but NOT accessible to ordinary client roles.
CREATE TABLE public.discovery_post_embeddings (
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  model text NOT NULL CHECK (btrim(model) <> ''),
  version text NOT NULL CHECK (btrim(version) <> ''),
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  embedding extensions.vector(384) NOT NULL,
  PRIMARY KEY (post_id, model, version)
);

CREATE TABLE public.user_embeddings (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  text_category text NOT NULL CHECK (btrim(text_category) <> ''),
  text_role text NOT NULL DEFAULT 'self' CHECK (text_role = 'self'),
  embedding_model text NOT NULL CHECK (btrim(embedding_model) <> ''),
  embedding_version text NOT NULL CHECK (btrim(embedding_version) <> ''),
  embedding extensions.vector(384) NOT NULL,
  source_text_hash text NOT NULL CHECK (source_text_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, text_category, text_role, embedding_model, embedding_version)
);

-- ============================ AUTHORIZATION HELPERS ==========================
-- SECURITY DEFINER helpers are deliberately schema-qualified and return only
-- booleans. They avoid RLS recursion while checking private supporting rows.
CREATE OR REPLACE FUNCTION public.is_relationship_member(p_relationship_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT p_user_id IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.relationships r
   WHERE r.id = p_relationship_id AND p_user_id IN (r.user_low, r.user_high)
     AND (auth.uid() IS NULL OR p_user_id = auth.uid())
 );
$$;

CREATE OR REPLACE FUNCTION public.is_blocked_either_way(p_a uuid, p_b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT (auth.uid() IS NULL OR auth.uid() IN (p_a,p_b)) AND EXISTS (
   SELECT 1 FROM public.blocks b
   WHERE (b.blocker_id=p_a AND b.blocked_id=p_b)
      OR (b.blocker_id=p_b AND b.blocked_id=p_a)
 );
$$;

CREATE OR REPLACE FUNCTION public.can_view_profile(p_target_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT (SELECT auth.uid()) IS NOT NULL AND (
   p_target_user_id = (SELECT auth.uid())
   OR EXISTS (
     SELECT 1 FROM public.profiles p
     JOIN public.users u ON u.id = p.user_id
     JOIN public.users viewer ON viewer.id = (SELECT auth.uid())
     WHERE p.user_id = p_target_user_id
       AND p.user_id <> (SELECT auth.uid())
       AND viewer.account_status = 'active'
       AND u.account_status = 'active'
       AND p.is_discoverable
       AND p.onboarding_completed_at IS NOT NULL
       AND p.date_of_birth <= (current_date - INTERVAL '18 years')::date
       AND (SELECT fv.status FROM public.face_verifications fv
            WHERE fv.user_id=p.user_id ORDER BY fv.submitted_at DESC,fv.id DESC LIMIT 1)='approved'
       AND NOT public.is_blocked_either_way((SELECT auth.uid()),p.user_id)
   )
 );
$$;

CREATE OR REPLACE FUNCTION public.can_match_users(p_sender uuid, p_recipient uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT p_sender IS NOT NULL AND p_recipient IS NOT NULL AND p_sender <> p_recipient
 AND (auth.uid() IS NULL OR auth.uid() IN (p_sender,p_recipient))
 AND NOT public.is_blocked_either_way(p_sender,p_recipient)
 AND NOT EXISTS (SELECT 1 FROM public.relationships r
                 WHERE r.user_low=least(p_sender,p_recipient)
                   AND r.user_high=greatest(p_sender,p_recipient)
                   AND r.status='active')
 AND (SELECT count(*) = 2
      FROM public.profiles p JOIN public.users u ON u.id=p.user_id
      WHERE p.user_id IN (p_sender,p_recipient)
        AND p.is_discoverable AND p.onboarding_completed_at IS NOT NULL
        AND p.date_of_birth <= (current_date - INTERVAL '18 years')::date
        AND u.account_status='active'
        AND (SELECT fv.status FROM public.face_verifications fv
             WHERE fv.user_id=p.user_id ORDER BY fv.submitted_at DESC,fv.id DESC LIMIT 1)='approved');
$$;

CREATE OR REPLACE FUNCTION public.can_read_conversation(p_conversation_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT p_user_id IS NOT NULL AND (auth.uid() IS NULL OR p_user_id=auth.uid()) AND EXISTS (
   SELECT 1 FROM public.conversations c
   JOIN public.relationships r ON r.id=c.relationship_id
   JOIN public.conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=p_user_id
   WHERE c.id=p_conversation_id
     AND NOT public.is_blocked_either_way(r.user_low,r.user_high)
 );
$$;

CREATE OR REPLACE FUNCTION public.can_send_conversation(p_conversation_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT p_user_id IS NOT NULL AND (auth.uid() IS NULL OR p_user_id=auth.uid()) AND EXISTS (
   SELECT 1 FROM public.conversations c
   JOIN public.relationships r ON r.id=c.relationship_id
   JOIN public.conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=p_user_id
   JOIN public.users u ON u.id=p_user_id
   WHERE c.id=p_conversation_id AND r.status='active'
     AND u.account_status='active'
     AND NOT public.is_blocked_either_way(r.user_low,r.user_high)
 );
$$;

CREATE OR REPLACE FUNCTION public.can_view_post(p_post_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.posts p
   WHERE p.id=p_post_id AND (
      p.author_id=(SELECT auth.uid())
      OR (p.relationship_id IS NOT NULL
          AND public.is_relationship_member(p.relationship_id,(SELECT auth.uid()))
          AND NOT public.is_blocked_either_way(p.author_id,(SELECT auth.uid())))
      OR (p.status='published' AND p.post_type IS NOT NULL
          AND p.published_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.users u
                      WHERE u.id=p.author_id AND u.account_status='active')
          AND NOT public.is_blocked_either_way(p.author_id,(SELECT auth.uid())))
   )
 );
$$;

-- Separate safe projection. Do not grant SELECT on other people's profiles:
-- that would leak full DOB, private flags, and onboarding metadata.
CREATE VIEW public.discoverable_profiles
WITH (security_barrier = true)
AS SELECT
  p.user_id,
  p.display_name,
  date_part('year',age(current_date,p.date_of_birth))::integer AS age_years,
  p.gender,
  p.pronouns,
  p.mbti_type,
  p.zodiac_sign,
  p.bio,
  p.region_code,
  p.relationship_goal,
  photo.storage_path AS primary_photo_path,
  coalesce(i.interest_slugs, ARRAY[]::text[]) AS interests
FROM public.profiles p
LEFT JOIN LATERAL (
  SELECT pp.storage_path FROM public.profile_photos pp
  WHERE pp.user_id=p.user_id AND pp.is_primary
  LIMIT 1
) photo ON true
LEFT JOIN LATERAL (
  SELECT array_agg(interest.slug ORDER BY interest.slug) AS interest_slugs
  FROM public.user_interests ui
  JOIN public.interests interest ON interest.id=ui.interest_id
  WHERE ui.user_id=p.user_id
) i ON true
WHERE p.date_of_birth IS NOT NULL AND public.can_view_profile(p.user_id);

-- ========================= REQUIRED SERVER-SIDE TRIGGERS =====================
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Supabase Auth creates the public records; names are only initial metadata.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.users(id,email) VALUES (NEW.id,NEW.email);
  INSERT INTO public.profiles(user_id,display_name)
  VALUES (NEW.id, left(coalesce(nullif(btrim(NEW.raw_user_meta_data->>'display_name'),''),'Luvora member'),80));
  INSERT INTO public.user_preferences(user_id) VALUES (NEW.id);
  INSERT INTO public.discovery_settings(viewer_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER luvora_on_auth_signup
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

CREATE OR REPLACE FUNCTION public.sync_auth_user_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.users SET email=NEW.email, updated_at=now() WHERE id=NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER luvora_on_auth_email_change
AFTER UPDATE OF email ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_auth_user_email();

CREATE TRIGGER touch_users BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_profiles BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_user_preferences BEFORE UPDATE ON public.user_preferences
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_user_traits BEFORE UPDATE ON public.user_traits
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_learned_features BEFORE UPDATE ON public.learned_preference_features
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_post_comments BEFORE UPDATE ON public.post_comments
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_user_embeddings BEFORE UPDATE ON public.user_embeddings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- A newly accepted connection gets one conversation with exactly two members.
CREATE OR REPLACE FUNCTION public.create_relationship_conversation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_conversation_id uuid;
BEGIN
  INSERT INTO public.conversations(relationship_id) VALUES (NEW.id)
  ON CONFLICT (relationship_id) DO UPDATE
  SET relationship_id=EXCLUDED.relationship_id
  RETURNING id INTO v_conversation_id;
  INSERT INTO public.conversation_members(conversation_id,user_id)
  VALUES (v_conversation_id,NEW.user_low),(v_conversation_id,NEW.user_high)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER relationships_create_chat AFTER INSERT ON public.relationships
FOR EACH ROW EXECUTE FUNCTION public.create_relationship_conversation();

-- Requests created by clients are automatically logged in the SAME transaction.
CREATE OR REPLACE FUNCTION public.log_match_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.interaction_events(viewer_id,target_user_id,event_type,idempotency_key)
  VALUES (NEW.sender_id,NEW.recipient_id,'connection_requested','match-request:'||NEW.id::text)
  ON CONFLICT (viewer_id,idempotency_key) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER log_new_match_request AFTER INSERT ON public.match_requests
FOR EACH ROW EXECUTE FUNCTION public.log_match_request();

-- RPC for recipient accepting a pending request: eligibility rechecked under lock.
CREATE OR REPLACE FUNCTION public.accept_match_request(p_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_request public.match_requests%ROWTYPE; v_relationship_id uuid; v_actor uuid;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_request FROM public.match_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.recipient_id <> v_actor OR v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Pending request not found for recipient' USING ERRCODE='42501';
  END IF;
  IF NOT public.can_match_users(v_request.sender_id,v_request.recipient_id) THEN
    RAISE EXCEPTION 'Users are no longer eligible to connect' USING ERRCODE='42501';
  END IF;
  UPDATE public.match_requests SET status='accepted',responded_at=now()
  WHERE id=v_request.id;
  INSERT INTO public.relationships(user_low,user_high,source_request_id)
  VALUES (least(v_request.sender_id,v_request.recipient_id),
          greatest(v_request.sender_id,v_request.recipient_id),v_request.id)
  ON CONFLICT (user_low,user_high) DO UPDATE
    SET status='active', ended_at=NULL, source_request_id=EXCLUDED.source_request_id
  RETURNING id INTO v_relationship_id;
  INSERT INTO public.interaction_events(viewer_id,target_user_id,event_type,idempotency_key)
  VALUES (v_actor,v_request.sender_id,'connection_accepted','match-accepted:'||v_request.id::text)
  ON CONFLICT (viewer_id,idempotency_key) DO NOTHING;
  RETURN v_relationship_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_match_request(p_request_id uuid,p_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_request public.match_requests%ROWTYPE; v_actor uuid;
BEGIN
  v_actor := auth.uid();
  SELECT * INTO v_request FROM public.match_requests WHERE id=p_request_id FOR UPDATE;
  IF v_actor IS NULL OR NOT FOUND OR v_request.status <> 'pending' OR
      NOT ((p_action='rejected' AND v_actor=v_request.recipient_id)
        OR (p_action='cancelled' AND v_actor=v_request.sender_id)) THEN
    RAISE EXCEPTION 'Request cannot be changed' USING ERRCODE='42501';
  END IF;
  UPDATE public.match_requests SET status=p_action,responded_at=now() WHERE id=p_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_relationship(p_relationship_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_relationship_member(p_relationship_id,auth.uid()) THEN
    RAISE EXCEPTION 'Not a relationship participant' USING ERRCODE='42501';
  END IF;
  UPDATE public.relationships SET status='ended',ended_at=now()
  WHERE id=p_relationship_id AND status='active';
END;
$$;

-- Forbid pretending a message came from another user or moving it to another chat.
CREATE OR REPLACE FUNCTION public.protect_message_immutable_columns()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR
     NEW.sender_id IS DISTINCT FROM OLD.sender_id OR
     NEW.conversation_id IS DISTINCT FROM OLD.conversation_id OR
     NEW.created_at IS DISTINCT FROM OLD.created_at OR
     NEW.reply_to_message_id IS DISTINCT FROM OLD.reply_to_message_id THEN
    RAISE EXCEPTION 'Cannot change message identity or destination';
  END IF;
  IF NEW.body IS DISTINCT FROM OLD.body THEN NEW.edited_at := now(); END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER messages_immutable_fields BEFORE UPDATE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.protect_message_immutable_columns();

-- Posts are draft-first. Every body/title/type/partner edit bumps content revision
-- and invalidates approvals; pair publication requires both current approvals.
CREATE OR REPLACE FUNCTION public.validate_post_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_a uuid; v_b uuid; v_approved_count integer;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.author_id IS DISTINCT FROM OLD.author_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Cannot change post identity or original author';
    END IF;
    IF (NEW.caption,NEW.title,NEW.post_type,NEW.relationship_id)
       IS DISTINCT FROM (OLD.caption,OLD.title,OLD.post_type,OLD.relationship_id) THEN
      NEW.content_revision := OLD.content_revision + 1;
      NEW.status := 'draft';
      NEW.published_at := NULL;
    ELSIF NEW.content_revision < OLD.content_revision THEN
      RAISE EXCEPTION 'Cannot decrease post revision';
    END IF;
    NEW.updated_at := now();
  END IF;
  IF NEW.relationship_id IS NOT NULL THEN
    SELECT r.user_low,r.user_high INTO v_a,v_b
    FROM public.relationships r WHERE r.id=NEW.relationship_id;
    IF NEW.author_id NOT IN (v_a,v_b) THEN
      RAISE EXCEPTION 'Post author must belong to linked relationship';
    END IF;
  END IF;
  IF NEW.status='published' AND NEW.relationship_id IS NOT NULL THEN
    SELECT count(*) INTO v_approved_count
    FROM public.post_participant_approvals a
    WHERE a.post_id=NEW.id AND a.post_revision=NEW.content_revision
      AND a.approval_status='approved' AND a.user_id IN (v_a,v_b);
    IF v_approved_count <> 2 THEN
      RAISE EXCEPTION 'Both participants must approve the current post revision';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER posts_validate_before_write
BEFORE INSERT OR UPDATE ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.validate_post_write();

CREATE OR REPLACE FUNCTION public.media_changes_invalidate_approvals()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_post_id uuid;
BEGIN
  v_post_id := CASE WHEN TG_OP='DELETE' THEN OLD.post_id ELSE NEW.post_id END;
  UPDATE public.posts SET content_revision=content_revision+1,
    status='draft', published_at=NULL WHERE id=v_post_id;
  IF TG_OP='UPDATE' AND OLD.post_id IS DISTINCT FROM NEW.post_id THEN
    UPDATE public.posts SET content_revision=content_revision+1,
      status='draft',published_at=NULL WHERE id=OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER media_invalidate_post_revision
AFTER INSERT OR UPDATE OR DELETE ON public.post_media
FOR EACH ROW EXECUTE FUNCTION public.media_changes_invalidate_approvals();

CREATE OR REPLACE FUNCTION public.normalize_post_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_relationship_id uuid; v_revision bigint;
BEGIN
  SELECT p.relationship_id,p.content_revision INTO v_relationship_id,v_revision
  FROM public.posts p WHERE p.id=NEW.post_id;
  IF v_relationship_id IS NULL
     OR NOT public.is_relationship_member(v_relationship_id,NEW.user_id)
     OR NEW.post_revision <> v_revision THEN
    RAISE EXCEPTION 'Approval must be from a partner for current revision';
  END IF;
  NEW.approved_at := CASE WHEN NEW.approval_status='approved' THEN now() ELSE NULL END;
  NEW.updated_at := now();
  IF TG_OP='UPDATE' AND (NEW.post_id,NEW.user_id,NEW.post_revision)
         IS DISTINCT FROM (OLD.post_id,OLD.user_id,OLD.post_revision) THEN
    RAISE EXCEPTION 'Cannot transfer an approval';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER normalize_approvals_before_write
BEFORE INSERT OR UPDATE ON public.post_participant_approvals
FOR EACH ROW EXECUTE FUNCTION public.normalize_post_approval();

CREATE OR REPLACE FUNCTION public.recheck_shared_post_approvals()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_post_id uuid;
BEGIN
  v_post_id := CASE WHEN TG_OP='DELETE' THEN OLD.post_id ELSE NEW.post_id END;
  UPDATE public.posts p SET status='draft',published_at=NULL
  WHERE p.id=v_post_id AND p.status='published' AND p.relationship_id IS NOT NULL
    AND (SELECT count(*) FROM public.post_participant_approvals a
         JOIN public.relationships r ON r.id=p.relationship_id
         WHERE a.post_id=p.id AND a.post_revision=p.content_revision
           AND a.approval_status='approved' AND a.user_id IN (r.user_low,r.user_high)) <> 2;
  RETURN NULL;
END;
$$;
CREATE TRIGGER recheck_approvals_after_change
AFTER INSERT OR UPDATE OR DELETE ON public.post_participant_approvals
FOR EACH ROW EXECUTE FUNCTION public.recheck_shared_post_approvals();


-- Post media paths must belong to the author, not another user's private bucket.
CREATE OR REPLACE FUNCTION public.validate_post_media_owner_path()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_author uuid;
BEGIN
  SELECT p.author_id INTO v_author FROM public.posts p WHERE p.id=NEW.post_id;
  IF v_author IS NULL OR split_part(NEW.storage_path,'/',1) <> v_author::text
     OR position('/' IN NEW.storage_path)=0 THEN
    RAISE EXCEPTION 'Media path must begin with post author UUID/';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validate_post_media_path
BEFORE INSERT OR UPDATE ON public.post_media
FOR EACH ROW EXECUTE FUNCTION public.validate_post_media_owner_path();

CREATE OR REPLACE FUNCTION public.protect_comment_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.id,NEW.post_id,NEW.author_id,NEW.created_at)
     IS DISTINCT FROM (OLD.id,OLD.post_id,OLD.author_id,OLD.created_at) THEN
    RAISE EXCEPTION 'Cannot change comment author or destination';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_comment_identity_before_update
BEFORE UPDATE ON public.post_comments
FOR EACH ROW EXECUTE FUNCTION public.protect_comment_identity();

CREATE OR REPLACE FUNCTION public.protect_discovery_reset()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.reset_through < OLD.reset_through THEN
    RAISE EXCEPTION 'Discovery reset cutoff cannot move backwards';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_discovery_reset_before_update
BEFORE UPDATE ON public.discovery_settings
FOR EACH ROW EXECUTE FUNCTION public.protect_discovery_reset();

-- An impression must correspond to a snapshot item actually delivered to viewer.
CREATE OR REPLACE FUNCTION public.validate_discovery_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.event_type='IMPRESSION' AND NOT EXISTS (
    SELECT 1 FROM public.discovery_deliveries d
    JOIN public.discovery_snapshots s ON s.id=d.snapshot_id
    WHERE s.id=NEW.request_id AND s.viewer_id=NEW.viewer_id
      AND d.post_id=NEW.post_id AND d.position=NEW.position
  ) THEN
    RAISE EXCEPTION 'Impression does not match a delivered story';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER verify_discovery_impression
BEFORE INSERT ON public.discovery_events
FOR EACH ROW EXECUTE FUNCTION public.validate_discovery_event();

-- ================================ INDEXES ===================================
CREATE INDEX idx_profiles_region ON public.profiles(region_code) WHERE region_code IS NOT NULL;
CREATE INDEX idx_profiles_discoverable ON public.profiles(is_discoverable,user_id)
  WHERE is_discoverable;
CREATE INDEX idx_face_verifications_user_status ON public.face_verifications(user_id,status);
CREATE INDEX idx_user_interests_interest ON public.user_interests(interest_id,user_id);
CREATE INDEX idx_profile_photos_user ON public.profile_photos(user_id,sort_order);
CREATE INDEX idx_blocks_reverse ON public.blocks(blocked_id,blocker_id);
CREATE INDEX idx_match_requests_recipient_status ON public.match_requests(recipient_id,status,created_at DESC);
CREATE INDEX idx_match_requests_sender_created ON public.match_requests(sender_id,created_at DESC);
CREATE INDEX idx_interaction_events_history ON public.interaction_events(viewer_id,created_at DESC);
CREATE INDEX idx_interaction_events_target ON public.interaction_events(target_user_id);
CREATE INDEX idx_interaction_bio_evidence ON public.interaction_events(viewer_id,created_at DESC,target_user_id)
  WHERE event_type IN ('profile_saved','connection_requested') AND target_bio_hash IS NOT NULL;
CREATE INDEX idx_ranking_snapshots_history ON public.ranking_snapshots(viewer_id,created_at DESC);
CREATE INDEX idx_ranking_snapshots_expires ON public.ranking_snapshots(expires_at);
CREATE INDEX idx_conversation_members_user ON public.conversation_members(user_id,conversation_id);
CREATE INDEX idx_messages_conversation_date ON public.messages(conversation_id,created_at DESC,id DESC);
CREATE INDEX idx_messages_sender ON public.messages(sender_id);
CREATE INDEX idx_posts_publication ON public.posts(published_at DESC,id) WHERE published_at IS NOT NULL;
CREATE INDEX idx_posts_relationship ON public.posts(relationship_id) WHERE relationship_id IS NOT NULL;
CREATE INDEX idx_posts_author_date ON public.posts(author_id,created_at DESC);
CREATE INDEX idx_post_media_post_sort ON public.post_media(post_id,sort_order);
CREATE INDEX idx_post_topics_topic ON public.post_topics(topic_key,post_id);
CREATE INDEX idx_approvals_user ON public.post_participant_approvals(user_id);
CREATE INDEX idx_post_comments_post_date ON public.post_comments(post_id,created_at DESC);
CREATE INDEX idx_discovery_events_history ON public.discovery_events(viewer_id,seq);
CREATE INDEX idx_discovery_events_post ON public.discovery_events(post_id) WHERE post_id IS NOT NULL;
CREATE INDEX idx_discovery_snapshots_expiry ON public.discovery_snapshots(expires_at);
CREATE INDEX idx_discovery_snapshots_viewer ON public.discovery_snapshots(viewer_id);
CREATE INDEX idx_discovery_deliveries_post ON public.discovery_deliveries(post_id);

-- ============================== RLS & GRANTS ================================
-- LOCK DOWN every public table, including pgvector experiment tables.
DO $rls$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
   'users','profiles','user_preferences','mbti_questions','user_mbti_answers',
   'face_verifications','interests','user_interests','profile_photos','blocks',
   'user_traits','preference_items','learned_preference_features',
   'match_requests','relationships','interaction_events','ranking_snapshots',
   'conversations','conversation_members','messages','message_reads','posts',
   'post_media','post_topics','post_participant_approvals','post_comments',
   'discovery_settings','discovery_events','discovery_snapshots','discovery_deliveries',
   'discovery_post_embeddings','user_embeddings'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon,authenticated',v_table);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role',v_table);
  END LOOP;
END;
$rls$;

-- Anonymous access to app records is intentionally disabled.
GRANT SELECT ON public.users, public.profiles, public.user_preferences,
 public.mbti_questions, public.face_verifications, public.interests,
 public.user_mbti_answers, public.user_interests, public.profile_photos,
 public.blocks, public.user_traits, public.preference_items,
 public.learned_preference_features, public.match_requests,
 public.relationships, public.interaction_events, public.ranking_snapshots,
 public.conversations, public.conversation_members, public.messages,
 public.message_reads, public.posts, public.post_media, public.post_topics,
 public.post_participant_approvals, public.post_comments,
 public.discovery_settings, public.discovery_events,
 public.discovery_snapshots, public.discovery_deliveries TO authenticated;

GRANT UPDATE ON public.profiles,public.user_preferences,public.user_mbti_answers,
 public.user_traits,public.preference_items,public.messages,public.message_reads,
 public.posts,public.post_media,public.post_participant_approvals,
 public.post_comments,public.discovery_settings,public.profile_photos TO authenticated;
GRANT INSERT ON public.user_mbti_answers,public.face_verifications,
 public.user_interests,public.profile_photos,public.blocks,public.user_traits,
 public.preference_items,public.match_requests,public.interaction_events,
 public.messages,public.message_reads,public.posts,public.post_media,
 public.post_topics,public.post_participant_approvals,public.post_comments,
 public.discovery_events TO authenticated;
GRANT DELETE ON public.user_mbti_answers,public.user_interests,
 public.profile_photos,public.blocks,public.user_traits,public.preference_items,
 public.posts,public.post_media,public.post_topics,public.post_comments TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.discovery_events_seq_seq TO authenticated;
REVOKE ALL ON public.discoverable_profiles FROM anon,authenticated;
GRANT SELECT ON public.discoverable_profiles TO authenticated;

-- Prevent clients from invoking internal SECURITY DEFINER functions as RPCs
-- except deliberately exposed access-check helpers and match RPCs.
REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_auth_user_email() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_relationship_conversation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_match_request() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_post_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_post_approval() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recheck_shared_post_approvals() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.media_changes_invalidate_approvals() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_discovery_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_post_media_owner_path() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_relationship_member(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_blocked_either_way(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_profile(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_match_users(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_read_conversation(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_send_conversation(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_post(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_match_request(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_match_request(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.end_relationship(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_match_request(uuid),
  public.close_match_request(uuid,text), public.end_relationship(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_relationship_member(uuid,uuid),
 public.is_blocked_either_way(uuid,uuid),public.can_view_profile(uuid),
 public.can_match_users(uuid,uuid),public.can_read_conversation(uuid,uuid),
 public.can_send_conversation(uuid,uuid),public.can_view_post(uuid) TO authenticated, service_role;

-- Owner-only, including sensitive DOB & onboarding state.
CREATE POLICY users_select_self ON public.users FOR SELECT TO authenticated
 USING (id=(SELECT auth.uid()));
CREATE POLICY profiles_select_self ON public.profiles FOR SELECT TO authenticated
 USING (user_id=(SELECT auth.uid()));
CREATE POLICY profiles_update_self ON public.profiles FOR UPDATE TO authenticated
 USING (user_id=(SELECT auth.uid())) WITH CHECK (user_id=(SELECT auth.uid()));
CREATE POLICY user_preferences_select_self ON public.user_preferences FOR SELECT TO authenticated
 USING (user_id=(SELECT auth.uid()));
CREATE POLICY user_preferences_update_self ON public.user_preferences FOR UPDATE TO authenticated
 USING (user_id=(SELECT auth.uid())) WITH CHECK (user_id=(SELECT auth.uid()));
CREATE POLICY mbti_questions_read ON public.mbti_questions FOR SELECT TO authenticated USING (true);
CREATE POLICY mbti_answers_read ON public.user_mbti_answers FOR SELECT TO authenticated
 USING (user_id=(SELECT auth.uid()));
CREATE POLICY mbti_answers_insert ON public.user_mbti_answers FOR INSERT TO authenticated
 WITH CHECK (user_id=(SELECT auth.uid()));
CREATE POLICY mbti_answers_update ON public.user_mbti_answers FOR UPDATE TO authenticated
 USING (user_id=(SELECT auth.uid())) WITH CHECK (user_id=(SELECT auth.uid()));
CREATE POLICY mbti_answers_delete ON public.user_mbti_answers FOR DELETE TO authenticated
 USING (user_id=(SELECT auth.uid()));
CREATE POLICY face_verifications_read_self ON public.face_verifications FOR SELECT TO authenticated
 USING (user_id=(SELECT auth.uid()));
CREATE POLICY face_verifications_submit ON public.face_verifications FOR INSERT TO authenticated
 WITH CHECK (user_id=(SELECT auth.uid()) AND status='pending'
             AND reviewed_at IS NULL AND provider_reference IS NULL);
CREATE POLICY interests_read ON public.interests FOR SELECT TO authenticated USING (true);
CREATE POLICY user_interests_select_self ON public.user_interests FOR SELECT TO authenticated
 USING (user_id=(SELECT auth.uid()));
CREATE POLICY user_interests_insert_self ON public.user_interests FOR INSERT TO authenticated
 WITH CHECK (user_id=(SELECT auth.uid()));
CREATE POLICY user_interests_delete_self ON public.user_interests FOR DELETE TO authenticated
 USING (user_id=(SELECT auth.uid()));
CREATE POLICY profile_photos_read_self ON public.profile_photos FOR SELECT TO authenticated
 USING (user_id=(SELECT auth.uid()));
CREATE POLICY profile_photos_insert_self ON public.profile_photos FOR INSERT TO authenticated
 WITH CHECK (user_id=(SELECT auth.uid()));
CREATE POLICY profile_photos_update_self ON public.profile_photos FOR UPDATE TO authenticated
 USING (user_id=(SELECT auth.uid())) WITH CHECK (user_id=(SELECT auth.uid()));
CREATE POLICY profile_photos_delete_self ON public.profile_photos FOR DELETE TO authenticated
 USING (user_id=(SELECT auth.uid()));
CREATE POLICY blocks_read_own ON public.blocks FOR SELECT TO authenticated
 USING (blocker_id=(SELECT auth.uid()));
CREATE POLICY blocks_insert_own ON public.blocks FOR INSERT TO authenticated
 WITH CHECK (blocker_id=(SELECT auth.uid()));
CREATE POLICY blocks_delete_own ON public.blocks FOR DELETE TO authenticated
 USING (blocker_id=(SELECT auth.uid()));

-- Matching features and explicit preferences belong to their author.
CREATE POLICY traits_select_self ON public.user_traits FOR SELECT TO authenticated
 USING (user_id=(SELECT auth.uid()));
CREATE POLICY traits_insert_self ON public.user_traits FOR INSERT TO authenticated
 WITH CHECK (user_id=(SELECT auth.uid()) AND source='manual');
CREATE POLICY traits_update_self ON public.user_traits FOR UPDATE TO authenticated
 USING (user_id=(SELECT auth.uid()) AND source='manual')
 WITH CHECK (user_id=(SELECT auth.uid()) AND source='manual');
CREATE POLICY traits_delete_self ON public.user_traits FOR DELETE TO authenticated
 USING (user_id=(SELECT auth.uid()));
CREATE POLICY preference_items_select_self ON public.preference_items FOR SELECT TO authenticated
 USING (user_id=(SELECT auth.uid()));
CREATE POLICY preference_items_insert_self ON public.preference_items FOR INSERT TO authenticated
 WITH CHECK (user_id=(SELECT auth.uid()));
CREATE POLICY preference_items_update_self ON public.preference_items FOR UPDATE TO authenticated
 USING (user_id=(SELECT auth.uid())) WITH CHECK (user_id=(SELECT auth.uid()));
CREATE POLICY preference_items_delete_self ON public.preference_items FOR DELETE TO authenticated
 USING (user_id=(SELECT auth.uid()));
CREATE POLICY learned_features_select_self ON public.learned_preference_features FOR SELECT TO authenticated
 USING (user_id=(SELECT auth.uid()));
CREATE POLICY requests_read_parties ON public.match_requests FOR SELECT TO authenticated
 USING ((SELECT auth.uid()) IN (sender_id,recipient_id));
CREATE POLICY requests_send_only ON public.match_requests FOR INSERT TO authenticated
 WITH CHECK (sender_id=(SELECT auth.uid()) AND status='pending'
             AND responded_at IS NULL AND public.can_match_users(sender_id,recipient_id));
CREATE POLICY relationships_read_parties ON public.relationships FOR SELECT TO authenticated
 USING ((SELECT auth.uid()) IN (user_low,user_high));
CREATE POLICY interaction_events_read_self ON public.interaction_events FOR SELECT TO authenticated
 USING (viewer_id=(SELECT auth.uid()));
CREATE POLICY interaction_events_record_self ON public.interaction_events FOR INSERT TO authenticated
 WITH CHECK (viewer_id=(SELECT auth.uid())
  AND event_type IN ('impression','profile_opened','profile_saved','profile_dismissed','not_my_type')
  AND public.can_view_profile(target_user_id));
CREATE POLICY ranking_snapshot_read_owner ON public.ranking_snapshots FOR SELECT TO authenticated
 USING (viewer_id=(SELECT auth.uid()));

-- Chat access is through confirmed relationship membership and block checks.
CREATE POLICY conversations_read_member ON public.conversations FOR SELECT TO authenticated
 USING (public.can_read_conversation(id,(SELECT auth.uid())));
CREATE POLICY conversation_members_read_member ON public.conversation_members FOR SELECT TO authenticated
 USING (public.can_read_conversation(conversation_id,(SELECT auth.uid())));
CREATE POLICY messages_read_member ON public.messages FOR SELECT TO authenticated
 USING (public.can_read_conversation(conversation_id,(SELECT auth.uid())));
CREATE POLICY messages_send_member ON public.messages FOR INSERT TO authenticated
 WITH CHECK (sender_id=(SELECT auth.uid())
   AND public.can_send_conversation(conversation_id,(SELECT auth.uid()))
   AND (reply_to_message_id IS NULL OR EXISTS (
     SELECT 1 FROM public.messages parent WHERE parent.id=reply_to_message_id
       AND parent.conversation_id=messages.conversation_id)));
CREATE POLICY messages_edit_sender ON public.messages FOR UPDATE TO authenticated
 USING (sender_id=(SELECT auth.uid())
   AND public.can_read_conversation(conversation_id,(SELECT auth.uid())))
 WITH CHECK (sender_id=(SELECT auth.uid())
   AND public.can_read_conversation(conversation_id,(SELECT auth.uid())));
CREATE POLICY message_reads_select_chat ON public.message_reads FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM public.messages m WHERE m.id=message_id
   AND public.can_read_conversation(m.conversation_id,(SELECT auth.uid()))));
CREATE POLICY message_reads_insert_self ON public.message_reads FOR INSERT TO authenticated
 WITH CHECK (user_id=(SELECT auth.uid()) AND EXISTS (
   SELECT 1 FROM public.messages m WHERE m.id=message_id
   AND public.can_read_conversation(m.conversation_id,(SELECT auth.uid()))));
CREATE POLICY message_reads_update_self ON public.message_reads FOR UPDATE TO authenticated
 USING (user_id=(SELECT auth.uid())) WITH CHECK (user_id=(SELECT auth.uid()));

-- Posts/draft pair stories are readable by the author and the couple;
-- published stories additionally available to eligible non-blocked viewers.
CREATE POLICY posts_read_author_partner_or_public ON public.posts FOR SELECT TO authenticated
 USING (public.can_view_post(id));
CREATE POLICY posts_insert_author ON public.posts FOR INSERT TO authenticated
 WITH CHECK (author_id=(SELECT auth.uid())
   AND (relationship_id IS NULL OR public.is_relationship_member(relationship_id,author_id)));
CREATE POLICY posts_update_author ON public.posts FOR UPDATE TO authenticated
 USING (author_id=(SELECT auth.uid())) WITH CHECK (author_id=(SELECT auth.uid()));
CREATE POLICY posts_delete_author ON public.posts FOR DELETE TO authenticated
 USING (author_id=(SELECT auth.uid()));
CREATE POLICY post_media_read_visible ON public.post_media FOR SELECT TO authenticated
 USING (public.can_view_post(post_id));
CREATE POLICY post_media_insert_author ON public.post_media FOR INSERT TO authenticated
 WITH CHECK (EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.author_id=(SELECT auth.uid())));
CREATE POLICY post_media_update_author ON public.post_media FOR UPDATE TO authenticated
 USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.author_id=(SELECT auth.uid())))
 WITH CHECK (EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.author_id=(SELECT auth.uid())));
CREATE POLICY post_media_delete_author ON public.post_media FOR DELETE TO authenticated
 USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.author_id=(SELECT auth.uid())));
CREATE POLICY post_topics_read_visible ON public.post_topics FOR SELECT TO authenticated
 USING (public.can_view_post(post_id));
CREATE POLICY post_topics_insert_author ON public.post_topics FOR INSERT TO authenticated
 WITH CHECK (EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.author_id=(SELECT auth.uid())));
CREATE POLICY post_topics_delete_author ON public.post_topics FOR DELETE TO authenticated
 USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.author_id=(SELECT auth.uid())));
CREATE POLICY approvals_read_participants ON public.post_participant_approvals FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.relationship_id IS NOT NULL
   AND public.is_relationship_member(p.relationship_id,(SELECT auth.uid()))));
CREATE POLICY approvals_insert_own ON public.post_participant_approvals FOR INSERT TO authenticated
 WITH CHECK (user_id=(SELECT auth.uid()) AND EXISTS (
   SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.relationship_id IS NOT NULL
    AND public.is_relationship_member(p.relationship_id,(SELECT auth.uid()))));
CREATE POLICY approvals_update_own ON public.post_participant_approvals FOR UPDATE TO authenticated
 USING (user_id=(SELECT auth.uid())) WITH CHECK (user_id=(SELECT auth.uid()));
CREATE POLICY comments_read_visible ON public.post_comments FOR SELECT TO authenticated
 USING (public.can_view_post(post_id));
CREATE POLICY comments_insert_self ON public.post_comments FOR INSERT TO authenticated
 WITH CHECK (author_id=(SELECT auth.uid()) AND public.can_view_post(post_id));
CREATE POLICY comments_update_self ON public.post_comments FOR UPDATE TO authenticated
 USING (author_id=(SELECT auth.uid())) WITH CHECK (author_id=(SELECT auth.uid()));
CREATE POLICY comments_delete_self ON public.post_comments FOR DELETE TO authenticated
 USING (author_id=(SELECT auth.uid()));

-- Discovery history/settings are owner-only; generated snapshots are server-only.
CREATE POLICY discovery_settings_read_self ON public.discovery_settings FOR SELECT TO authenticated
 USING (viewer_id=(SELECT auth.uid()));
CREATE POLICY discovery_settings_update_self ON public.discovery_settings FOR UPDATE TO authenticated
 USING (viewer_id=(SELECT auth.uid())) WITH CHECK (viewer_id=(SELECT auth.uid()));
CREATE POLICY discovery_events_read_self ON public.discovery_events FOR SELECT TO authenticated
 USING (viewer_id=(SELECT auth.uid()));
CREATE POLICY discovery_events_insert_self ON public.discovery_events FOR INSERT TO authenticated
 WITH CHECK (viewer_id=(SELECT auth.uid())
  AND (post_id IS NULL OR public.can_view_post(post_id)));
CREATE POLICY discovery_snapshots_read_self ON public.discovery_snapshots FOR SELECT TO authenticated
 USING (viewer_id=(SELECT auth.uid()));
CREATE POLICY discovery_deliveries_read_owner ON public.discovery_deliveries FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM public.discovery_snapshots ds
   WHERE ds.id=snapshot_id AND ds.viewer_id=(SELECT auth.uid())));
-- discovery_post_embeddings + user_embeddings: intentionally NO client policies.

-- =========================== STORAGE CONFIGURATION ===========================
-- These are private buckets. Uploaded object names MUST begin with USER_UUID/.
-- Backend should issue signed URLs only when requester is eligible to see media.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES
 ('profile-photos','profile-photos',false,8388608,ARRAY['image/jpeg','image/png','image/webp']),
 ('post-media','post-media',false,20971520,ARRAY['image/jpeg','image/png','image/webp','video/mp4']),
 ('face-verifications','face-verifications',false,8388608,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY luvora_storage_owner_select ON storage.objects FOR SELECT TO authenticated
 USING (bucket_id IN ('profile-photos','post-media','face-verifications')
   AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
CREATE POLICY luvora_storage_owner_upload ON storage.objects FOR INSERT TO authenticated
 WITH CHECK (bucket_id IN ('profile-photos','post-media','face-verifications')
   AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
CREATE POLICY luvora_storage_owner_update ON storage.objects FOR UPDATE TO authenticated
 USING (bucket_id IN ('profile-photos','post-media')
   AND (storage.foldername(name))[1]=(SELECT auth.uid())::text)
 WITH CHECK (bucket_id IN ('profile-photos','post-media')
   AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
CREATE POLICY luvora_storage_owner_delete ON storage.objects FOR DELETE TO authenticated
 USING (bucket_id IN ('profile-photos','post-media')
   AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);

-- ============================= REALTIME CONFIG ==============================
-- Fresh Supabase normally has this publication already. Do not recreate it,
-- because Supabase may also use it for other application tables.
DO $publication$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='messages') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='match_requests') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.match_requests;
    END IF;
  END IF;
END;
$publication$;

-- A small invariant check provides immediate signal if a migration is partial.
DO $check$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN (
    'users','profiles','user_preferences','user_traits','preference_items','blocks',
    'interaction_events','learned_preference_features','ranking_snapshots',
    'match_requests','relationships','posts','post_topics','post_participant_approvals',
    'discovery_settings','discovery_events','discovery_snapshots','discovery_deliveries',
    'discovery_post_embeddings','user_embeddings','conversations','conversation_members','messages'
  );
  IF v_count <> 23 THEN RAISE EXCEPTION 'Core table installation incomplete: %/23',v_count; END IF;
END;
$check$;

COMMIT;

-- AFTER RUNNING:
-- * Add accounts using supabase.auth.signUp({ email,password,options:{data:{display_name}} }).
-- * Onboard: update profiles (DOB, MBTI, gender, bio, region), preferences,
--   interests, avatar. Only trusted service may approve face_verifications.
-- * Mark profiles.is_discoverable=true only once onboarding is complete.
-- * Client sends match_requests; recipient calls rpc('accept_match_request',{p_request_id}).
-- * Publish solo posts by setting status='published' and published_at;
--   ANY pair-linked post requires BOTH participants' current approvals.
-- * Use auth.uid() in app user-context; service role keys NEVER ship to browser.
-- * RLS still needs integration tests using at least two real authenticated users.
