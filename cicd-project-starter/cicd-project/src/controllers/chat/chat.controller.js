const createError = require("http-errors");
const { getViewerId, uuid } = require("../viewer");
const model = require("../../models/chat/chat.model");
const events = require("../../services/chat/chat.events");
function requireId(id) {
  if (typeof id !== "string" || !uuid.test(id))
    throw createError(400, "Invalid conversation ID.");
  return id;
}
async function sendMessage(viewerId, conversationId, payload) {
  const message = await model.send(
    viewerId,
    requireId(conversationId),
    payload,
  );
  events.emit("changed");
  return message;
}
async function list(req, res) {
  const viewerId = getViewerId(req);
  res.json({ viewer_id: viewerId, conversations: await model.list(viewerId) });
}
async function history(req, res) {
  res.json(
    await model.history(
      getViewerId(req),
      requireId(req.params.id),
      req.query.before,
    ),
  );
}
async function send(req, res) {
  res
    .status(201)
    .json(await sendMessage(getViewerId(req), req.params.id, req.body));
}
module.exports = { list, history, send, sendMessage };
