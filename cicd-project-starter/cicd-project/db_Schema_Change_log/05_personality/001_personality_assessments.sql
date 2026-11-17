BEGIN;

CREATE TABLE public.personality_assessments (
  user_id uuid PRIMARY KEY
    REFERENCES public.users(id) ON DELETE CASCADE,

  questionnaire_version text NOT NULL
    CHECK (questionnaire_version = 'luvora-v1'),

  answers jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(answers) = 'object'),

  resolutions jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(resolutions) = 'object'),

  result jsonb,

  published boolean NOT NULL DEFAULT false,

  revision integer NOT NULL DEFAULT 1
    CHECK (revision > 0),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CHECK (NOT published OR result IS NOT NULL)
);

ALTER TABLE public.personality_assessments
  ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.personality_assessments
  TO authenticated;

CREATE POLICY personality_select_self
  ON public.personality_assessments
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY personality_insert_self
  ON public.personality_assessments
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY personality_update_self
  ON public.personality_assessments
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY personality_delete_self
  ON public.personality_assessments
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

COMMIT;