const createError = require("http-errors");
const withViewer = require("../../db/with-viewer");
const { uuid } = require("../../controllers/viewer");
const conversationSql = `SELECT c.id, r.status, r.stage,
  public.connection_member_name(CASE WHEN r.user_low = $1 THEN r.user_high ELSE r.user_low END) AS name,
  public.can_send_conversation(c.id, $1) AS can_send,
  latest.body AS last_message, latest.created_at AS last_message_at
  FROM public.conversations c JOIN public.relationships r ON r.id = c.relationship_id
  LEFT JOIN LATERAL (
    SELECT CASE WHEN deleted_at IS NULL THEN body ELSE 'Message deleted' END AS body, created_at
    FROM public.messages WHERE conversation_id = c.id ORDER BY created_at DESC, id DESC LIMIT 1
  ) latest ON true
  WHERE $1 IN (r.user_low, r.user_high)`;

async function list(viewerId) {
  const conversations = await withViewer(
    viewerId,
    async (db) =>
      (
        await db.query(
          `${conversationSql} ORDER BY coalesce(latest.created_at, c.created_at) DESC, c.id`,
          [viewerId],
        )
      ).rows,
  );
  return conversations;
}
async function history(viewerId, conversationId, before) {
  if (
    before !== undefined &&
    (typeof before !== "string" || !uuid.test(before))
  ) {
    throw createError(400, "Invalid message cursor.");
  }
  const result = await withViewer(viewerId, async (db) => {
    const {
      rows: [conversation],
    } = await db.query(`${conversationSql} AND c.id = $2`, [
      viewerId,
      conversationId,
    ]);
    if (!conversation) throw createError(404, "Conversation not found.");
    if (before) {
      const cursor = await db.query(
        "SELECT id FROM public.messages WHERE id = $1 AND conversation_id = $2",
        [before, conversationId],
      );
      if (!cursor.rowCount) throw createError(400, "Message cursor not found.");
    }
    const { rows } = await db.query(
      `SELECT id, sender_id,
      CASE WHEN deleted_at IS NULL THEN body ELSE 'Message deleted' END AS body, created_at
      FROM public.messages WHERE conversation_id = $1
      AND ($2::uuid IS NULL OR (created_at, id) < (SELECT created_at, id FROM public.messages WHERE id = $2))
      ORDER BY created_at DESC, id DESC LIMIT 51`,
      [conversationId, before || null],
    );
    const more = rows.length > 50;
    const messages = rows.slice(0, 50).reverse();
    return {
      conversation,
      messages,
      next_cursor: more ? messages[0].id : null,
    };
  });
  return result;
}
async function send(viewerId, conversationId, payload) {
  const { body, id } = payload || {};
  if (
    typeof body !== "string" ||
    !body.trim() ||
    Array.from(body.trim()).length > 10000 ||
    typeof id !== "string" ||
    !uuid.test(id)
  ) {
    throw createError(
      400,
      "Provide a message ID and a message of 1–10,000 characters.",
    );
  }
  try {
    const message = await withViewer(
      viewerId,
      async (db) =>
        (
          await db.query("SELECT * FROM public.send_chat_message($1, $2, $3)", [
            conversationId,
            id,
            body.trim(),
          ])
        ).rows[0],
    );
    return message;
  } catch (error) {
    const statuses = { LV404: 404, LV409: 409, LV400: 400 };
    if (statuses[error.code])
      throw createError(statuses[error.code], error.message);
    throw error;
  }
}
async function photo(viewerId, conversationId) {
  return withViewer(viewerId, async (db) => {
    const {
      rows: [result],
    } = await db.query("SELECT public.chat_member_photo($1) AS path", [
      conversationId,
    ]);
    return result?.path || null;
  });
}
module.exports = { list, history, send, photo };
