const { Server } = require("socket.io");
const { getViewerId } = require("../viewer");
const { sendMessage } = require("./chat.controller");
const events = require("../../services/chat/chat.events");

// authenticate must establish req.user from a verified server-side session.
// The demo runner supplies a fixed identity on each loopback port instead.
function attachChat(server, { authenticate } = {}) {
  const io = new Server(server, {
    transports: ["websocket"],
    maxHttpBufferSize: 64 * 1024,
    allowRequest(req, done) {
      const origin = req.headers.origin;
      done(
        null,
        !origin ||
          origin === `http://${req.headers.host}` ||
          origin === `https://${req.headers.host}`,
      );
    },
  });
  if (authenticate) io.engine.use(authenticate);
  io.use((socket, next) => {
    try {
      socket.data.viewerId = getViewerId(socket.request);
      next();
    } catch {
      next(new Error("A signed-in Luvora account is required."));
    }
  });
  // No chat content or IDs are broadcast. Each client reloads through RLS-protected
  // HTTP reads; revoked/blocked membership cannot receive private message bodies.
  const changed = () => io.emit("chat:changed");
  events.on("changed", changed);
  server.once("close", () => events.off("changed", changed));
  io.on("connection", (socket) => {
    socket.on("chat:send", async (payload, acknowledge) => {
      if (typeof acknowledge !== "function") return;
      try {
        const message = await sendMessage(
          socket.data.viewerId,
          payload?.conversation_id,
          payload,
        );
        acknowledge({ ok: true, message });
      } catch (error) {
        acknowledge({
          ok: false,
          error: error.expose ? error.message : "Could not send the message.",
        });
      }
    });
  });
  return io;
}
module.exports = attachChat;
