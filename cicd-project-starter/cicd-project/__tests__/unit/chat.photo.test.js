jest.mock("../../src/models/chat/chat.model", () => ({ photo: jest.fn() }));
const express = require("express");
const request = require("supertest");
const router = require("../../src/routes/chat/chat.routes");
const model = require("../../src/models/chat/chat.model");
const { downloadPhoto } = require("../../src/services/chat/chat.photos");
const id = "22222222-2222-4222-8222-222222222222";
const originalFetch = global.fetch;
const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
function app(signedIn = true) {
  const app = express();
  app.use((req, res, next) => {
    if (signedIn) req.user = { id: "11111111-1111-4111-8111-111111111111" };
    next();
  });
  app.use("/api/chat", router);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) =>
    res.status(err.status || 500).json({ error: err.message }),
  );
  return app;
}
beforeEach(() => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "server-test-key";
  global.fetch = jest.fn();
});
afterEach(() => {
  global.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  jest.resetAllMocks();
});
test("photos require a signed-in viewer", async () => {
  await request(app(false)).get(`/api/chat/${id}/photo`).expect(401);
  expect(model.photo).not.toHaveBeenCalled();
});
test("missing storage setup gracefully allows an initials fallback", async () => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  await request(app()).get(`/api/chat/${id}/photo`).expect(404);
  expect(global.fetch).not.toHaveBeenCalled();
});
test("denied membership or missing photo never reads privileged storage", async () => {
  model.photo.mockResolvedValue(null);
  await request(app()).get(`/api/chat/${id}/photo`).expect(404);
  expect(global.fetch).not.toHaveBeenCalled();
});
test("authorized photo is proxied with private credentials kept server-side", async () => {
  model.photo.mockResolvedValue("member/photo one.png");
  global.fetch.mockResolvedValue(
    new Response(new Uint8Array([1, 2, 3]), {
      headers: { "Content-Type": "image/png" },
    }),
  );
  const result = await request(app()).get(`/api/chat/${id}/photo`).expect(200);
  expect(result.headers["content-type"]).toContain("image/png");
  expect(result.headers["cache-control"]).toBe("no-store");
  expect(result.headers["x-content-type-options"]).toBe("nosniff");
  expect(global.fetch.mock.calls[0][0].pathname).toBe(
    "/storage/v1/object/authenticated/profile-photos/member/photo%20one.png",
  );
  expect(result.body).toEqual(Buffer.from([1, 2, 3]));
});
test("non-image storage content is rejected", async () => {
  global.fetch.mockResolvedValue(
    new Response("<html>oops</html>", {
      headers: { "Content-Type": "text/html" },
    }),
  );
  await expect(downloadPhoto("member/photo.png")).rejects.toMatchObject({
    status: 404,
  });
});
test("path traversal is rejected before fetching", async () => {
  await expect(downloadPhoto("member/../private.png")).rejects.toMatchObject({
    status: 404,
  });
  expect(global.fetch).not.toHaveBeenCalled();
});
