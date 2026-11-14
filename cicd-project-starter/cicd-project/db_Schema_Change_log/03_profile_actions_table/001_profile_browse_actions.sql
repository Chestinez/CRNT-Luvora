-- Apply after the Luvora Supabase schema. Safe to rerun.
-- A row represents an active bookmark or hide. Removing it reverses the action.
BEGIN;

CREATE TABLE IF NOT EXISTS public.profile_browse_actions (
  viewer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('saved', 'hidden')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (viewer_id, action, target_user_id),
  CHECK (viewer_id <> target_user_id)
);

CREATE INDEX IF NOT EXISTS profile_browse_actions_target_idx
  ON public.profile_browse_actions (target_user_id);

ALTER TABLE public.profile_browse_actions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.profile_browse_actions FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON TABLE public.profile_browse_actions TO authenticated;
GRANT INSERT (viewer_id, target_user_id, action) ON TABLE public.profile_browse_actions TO authenticated;

DROP POLICY IF EXISTS profile_browse_actions_read_own ON public.profile_browse_actions;
CREATE POLICY profile_browse_actions_read_own ON public.profile_browse_actions
  FOR SELECT TO authenticated USING (viewer_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS profile_browse_actions_insert_own ON public.profile_browse_actions;
CREATE POLICY profile_browse_actions_insert_own ON public.profile_browse_actions
  FOR INSERT TO authenticated WITH CHECK (
    viewer_id = (SELECT auth.uid()) AND public.can_view_profile(target_user_id)
  );

DROP POLICY IF EXISTS profile_browse_actions_delete_own ON public.profile_browse_actions;
CREATE POLICY profile_browse_actions_delete_own ON public.profile_browse_actions
  FOR DELETE TO authenticated USING (viewer_id = (SELECT auth.uid()));

COMMIT;
