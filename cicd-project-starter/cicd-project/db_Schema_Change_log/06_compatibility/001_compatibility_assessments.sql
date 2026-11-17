BEGIN;

CREATE TABLE public.compatibility_assessments (
  user_id uuid PRIMARY KEY
    REFERENCES public.users(id) ON DELETE CASCADE,

  questionnaire_version text NOT NULL
    DEFAULT 'compatibility-v1'
    CHECK (questionnaire_version = 'compatibility-v1'),

  answers jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(answers) = 'object'),

  partner_preferences jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(partner_preferences) = 'object'),

  skipped_question_ids jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(skipped_question_ids) = 'array'),

  core_completed_at timestamptz,

  revision integer NOT NULL DEFAULT 1
    CHECK (revision > 0),

  created_at timestamptz NOT NULL DEFAULT now(),

  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.compatibility_assessments IS
  'Private compatibility answers and partner preferences; one assessment per user.';

COMMENT ON COLUMN public.compatibility_assessments.answers IS
  'Question IDs mapped to arrays of option values. Validated by the application.';

COMMENT ON COLUMN public.compatibility_assessments.partner_preferences IS
  'Question IDs mapped to accepted option values, importance and dealbreaker settings.';

COMMENT ON COLUMN public.compatibility_assessments.revision IS
  'Used for optimistic concurrency to prevent stale saves overwriting newer answers.';

-- Maintain timestamps and revisions for every update.
CREATE FUNCTION public.touch_compatibility_assessment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.created_at := OLD.created_at;
  NEW.updated_at := now();
  NEW.revision := OLD.revision + 1;

  RETURN NEW;
END;
$$;

CREATE TRIGGER compatibility_assessment_before_update
BEFORE UPDATE ON public.compatibility_assessments
FOR EACH ROW
EXECUTE FUNCTION public.touch_compatibility_assessment();

ALTER TABLE public.compatibility_assessments
  ENABLE ROW LEVEL SECURITY;

-- Anonymous visitors cannot read or change assessments.
REVOKE ALL ON public.compatibility_assessments FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.compatibility_assessments
  TO authenticated;

CREATE POLICY compatibility_select_self
  ON public.compatibility_assessments
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY compatibility_insert_self
  ON public.compatibility_assessments
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY compatibility_update_self
  ON public.compatibility_assessments
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY compatibility_delete_self
  ON public.compatibility_assessments
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

COMMIT;