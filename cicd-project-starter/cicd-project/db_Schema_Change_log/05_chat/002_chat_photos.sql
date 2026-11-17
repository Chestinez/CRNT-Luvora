-- Apply after 05_chat/001_chat.sql. Photos remain in the PRIVATE bucket.
BEGIN;
CREATE OR REPLACE FUNCTION public.chat_member_photo(p_conversation uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT pp.storage_path
  FROM public.conversations c
  JOIN public.relationships r ON r.id = c.relationship_id
  JOIN public.profile_photos pp ON pp.user_id =
    CASE WHEN r.user_low = auth.uid() THEN r.user_high ELSE r.user_low END
  WHERE c.id = p_conversation
    AND auth.uid() IN (r.user_low, r.user_high)
    AND public.can_read_conversation(c.id, auth.uid())
  ORDER BY pp.is_primary DESC, pp.sort_order, pp.created_at, pp.id
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.chat_member_photo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_member_photo(uuid) TO authenticated;
COMMIT;
