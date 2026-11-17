jest.mock("../../src/db/with-viewer", () => jest.fn());
const express = require("express");
const request = require("supertest");
const withViewer = require("../../src/db/with-viewer");
const router = require("../../src/routes/chat/chat.routes");
const viewer = "11111111-1111-4111-8111-111111111111";
const chat = "22222222-2222-4222-8222-222222222222";
const message = "33333333-3333-4333-8333-333333333333";
function app(identity = viewer) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (identity) req.user = { id: identity };
    next();
  });
  app.use("/api/chat", router);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) =>
    res.status(err.status || 500).json({ error: err.message }),
  );
  return app;
}
beforeEach(() => jest.resetAllMocks());
test("requires trusted sign-in rather than a submitted viewer ID", async () => {
  await request(app(null)).get(`/api/chat?viewer_id=${viewer}`).expect(401);
  expect(withViewer).not.toHaveBeenCalled();
});
test("rejects invalid conversation and message input before querying", async () => {
  await request(app()).get("/api/chat/no/messages").expect(400);
  for (const body of ["", "  ", "x".repeat(10001), 5]) {
    await request(app())
      .post(`/api/chat/${chat}/messages`)
      .send({ id: message, body })
      .expect(400);
  }
  expect(withViewer).not.toHaveBeenCalled();
});
test("inbox includes ended conversations and returns the trusted identity", async () => {
  const conversations = [{ id: chat, status: "ended", can_send: false }];
  withViewer.mockResolvedValue(conversations);
  const result = await request(app()).get("/api/chat").expect(200);
  expect(result.body).toEqual({ viewer_id: viewer, conversations });
  expect(result.headers["cache-control"]).toBe("no-store");
});
test("outsiders cannot fetch a conversation", async () => {
  withViewer.mockImplementation((id, run) =>
    run({ query: jest.fn().mockResolvedValue({ rows: [] }) }),
  );
  await request(app()).get(`/api/chat/${chat}/messages`).expect(404);
});
test("ended conversation history is readable, ordered and paginated", async () => {
  const rows = Array.from({ length: 51 }, (_, i) => ({
    id: String(51 - i),
    body: "old message",
  }));
  const query = jest
    .fn()
    .mockResolvedValueOnce({
      rows: [{ id: chat, status: "ended", can_send: false }],
    })
    .mockResolvedValueOnce({ rows });
  withViewer.mockImplementation((id, run) => run({ query }));
  const result = await request(app())
    .get(`/api/chat/${chat}/messages`)
    .expect(200);
  expect(result.body.messages).toHaveLength(50);
  expect(result.body.next_cursor).toBe("2");
  expect(result.body.conversation.can_send).toBe(false);
});
test("sending uses the trusted actor transaction and retry ID", async () => {
  const query = jest
    .fn()
    .mockResolvedValue({ rows: [{ id: message, body: "hello" }] });
  withViewer.mockImplementation((id, run) => run({ query }));
  await request(app())
    .post(`/api/chat/${chat}/messages`)
    .send({ id: message, body: " hello ", sender_id: chat })
    .expect(201);
  expect(withViewer.mock.calls[0][0]).toBe(viewer);
  expect(query).toHaveBeenCalledWith(
    "SELECT * FROM public.send_chat_message($1, $2, $3)",
    [chat, message, "hello"],
  );
});
test("a concurrent unmatch becomes a clear conflict response", async () => {
  withViewer.mockRejectedValue(
    Object.assign(new Error("Connection ended"), { code: "LV409" }),
  );
  await request(app())
    .post(`/api/chat/${chat}/messages`)
    .send({ id: message, body: "hello" })
    .expect(409);
});
test("invalid cursors are rejected", async () => {
  await request(app())
    .get(`/api/chat/${chat}/messages?before=invalid`)
    .expect(400);
  expect(withViewer).not.toHaveBeenCalled();
});
