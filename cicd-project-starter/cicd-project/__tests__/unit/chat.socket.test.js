jest.mock("../../src/models/chat/chat.model", () => ({ send: jest.fn() }));
const http = require("node:http");
const { io: connect } = require("socket.io-client");
const attachChat = require("../../src/controllers/chat/chat.socket");
const model = require("../../src/models/chat/chat.model");
const events = require("../../src/services/chat/chat.events");
const createError = require("http-errors");
const viewer = "11111111-1111-4111-8111-111111111111";
const conversation = "22222222-2222-4222-8222-222222222222";
const sockets = [];
const servers = [];
const ios = [];
function once(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out: ${event}`)),
      3000,
    );
    socket.once(event, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}
async function start(identity) {
  const server = http.createServer();
  const io = attachChat(server, {
    authenticate(req, res, next) {
      if (identity) req.user = { id: identity };
      next();
    },
  });
  ios.push(io);
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
function client(url, options = {}) {
  const socket = connect(url, {
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    ...options,
  });
  sockets.push(socket);
  return socket;
}
afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.disconnect());
  await Promise.all(
    ios.splice(0).map((io) => new Promise((resolve) => io.close(resolve))),
  );
  servers.length = 0;
  jest.resetAllMocks();
});
test("a handshake cannot impersonate a user with client-supplied auth", async () => {
  const socket = client(await start(null), { auth: { userId: viewer } });
  const error = await once(socket, "connect_error");
  expect(error.message).toContain("signed-in");
  expect(model.send).not.toHaveBeenCalled();
});
test("messages are acknowledged after save and notify clients across demo ports", async () => {
  const sender = client(await start(viewer));
  const recipient = client(await start("33333333-3333-4333-8333-333333333333"));
  await Promise.all([once(sender, "connect"), once(recipient, "connect")]);
  model.send.mockResolvedValue({ id: "saved", body: "hello" });
  const changed = once(recipient, "chat:changed");
  const payload = {
    conversation_id: conversation,
    id: "retry-id",
    body: "hello",
    sender_id: "forged",
  };
  const response = await sender.timeout(3000).emitWithAck("chat:send", payload);
  await changed;
  expect(response).toEqual({
    ok: true,
    message: { id: "saved", body: "hello" },
  });
  expect(model.send).toHaveBeenCalledWith(viewer, conversation, payload);
});
test("an unmatch conflict is acknowledged without a new-message notification", async () => {
  const socket = client(await start(viewer));
  await once(socket, "connect");
  const changed = jest.fn();
  events.on("changed", changed);
  model.send.mockRejectedValue(createError(409, "Connection ended"));
  try {
    const response = await socket
      .timeout(3000)
      .emitWithAck("chat:send", { conversation_id: conversation, body: "hi" });
    expect(response).toEqual({ ok: false, error: "Connection ended" });
    expect(changed).not.toHaveBeenCalled();
  } finally {
    events.off("changed", changed);
  }
});
test("malformed conversation IDs never reach the model", async () => {
  const socket = client(await start(viewer));
  await once(socket, "connect");
  const response = await socket
    .timeout(3000)
    .emitWithAck("chat:send", { conversation_id: "bad", body: "hi" });
  expect(response.ok).toBe(false);
  expect(model.send).not.toHaveBeenCalled();
});
test("reconnecting clients receive subsequent events", async () => {
  const socket = client(await start(viewer));
  await once(socket, "connect");
  socket.disconnect();
  const connected = once(socket, "connect");
  socket.connect();
  await connected;
  const changed = once(socket, "chat:changed");
  events.emit("changed");
  await changed;
});
