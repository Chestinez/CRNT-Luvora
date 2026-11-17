-- Apply after 04_connections/001_connections.sql. Does not remove any chat history.
BEGIN;

-- Backfill older relationships that predate the existing conversation trigger.
INSERT INTO public.conversations(relationship_id)
SELECT id FROM public.relationships ON CONFLICT (relationship_id) DO NOTHING;
INSERT INTO public.conversation_members(conversation_id, user_id)
SELECT c.id, members.user_id FROM public.conversations c
JOIN public.relationships r ON r.id = c.relationship_id
CROSS JOIN LATERAL (VALUES (r.user_low), (r.user_high)) members(user_id)
ON CONFLICT DO NOTHING;

-- Use the same participant locks as matching/unmatching, then recheck permissions.
-- A caller-generated ID makes retries safe when a response is lost.
CREATE OR REPLACE FUNCTION public.send_chat_message(p_conversation uuid, p_id uuid, p_body text)
RETURNS public.messages LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pair public.relationships; v_message public.messages; v_actor uuid := auth.uid();
BEGIN
  SELECT r.* INTO v_pair FROM public.relationships r
  JOIN public.conversations c ON c.relationship_id = r.id
  WHERE c.id = p_conversation AND v_actor IN (r.user_low, r.user_high);
  IF NOT FOUND OR NOT public.can_read_conversation(p_conversation, v_actor) THEN
    RAISE EXCEPTION 'Conversation not found.' USING ERRCODE = 'LV404';
  END IF;
  PERFORM public.lock_connection_members(v_pair.user_low, v_pair.user_high);
  IF p_id IS NULL OR p_body IS NULL OR char_length(btrim(p_body)) NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'Message must contain 1–10,000 characters.' USING ERRCODE = 'LV400';
  END IF;
  SELECT * INTO v_message FROM public.messages WHERE id = p_id;
  IF FOUND THEN
    IF v_message.sender_id = v_actor AND v_message.conversation_id = p_conversation AND v_message.body = p_body THEN
      RETURN v_message;
    END IF;
    RAISE EXCEPTION 'Message ID already used.' USING ERRCODE = 'LV409';
  END IF;
  IF NOT public.can_send_conversation(p_conversation, v_actor) THEN
    RAISE EXCEPTION 'This connection has ended. You can still read your history.' USING ERRCODE = 'LV409';
  END IF;
  INSERT INTO public.messages(id, conversation_id, sender_id, body)
  VALUES (p_id, p_conversation, v_actor, p_body) RETURNING * INTO v_message;
  RETURN v_message;
END;
$$;
REVOKE ALL ON FUNCTION public.send_chat_message(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_chat_message(uuid, uuid, text) TO authenticated;
-- Ensure direct inserts cannot bypass the serialized send check.
REVOKE INSERT ON public.messages FROM authenticated;
COMMIT;
