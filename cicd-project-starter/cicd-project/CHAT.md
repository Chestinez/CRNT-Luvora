# Chat

## Setup

1. Apply `db_Schema_Change_log/05_chat/001_chat.sql` in the Supabase SQL editor after migration 04. This preserves existing messages and backfills conversations for older relationships.
2. Run `npm install` to install Socket.IO, then start the existing local demo with `npm run demo`. Open two demo accounts on their respective localhost ports (see `luvora-demo-runner.md`).
3. Accept a connection in Discovery. Use the **Messages** link or open `/chat/` on each account's port.
4. Send messages in both directions. The other account updates immediately through Socket.IO events.
5. End the connection from Connections. Both participants retain the inbox entry and paginated history; sending is disabled and the database rejects new sends.
6. Reconnecting the same pair reuses their existing conversation and history.

## Team integration

The `/api/chat` endpoints use the existing `req.user.id` contract and `withViewer` transaction helper. Your authentication middleware must set `req.user.id` from a verified session before these routes. Socket.IO also requires the same trusted identity. Pass your verified session middleware as `attachChat(server, { authenticate: sessionMiddleware })`; setting `req.user` only inside Express does not authenticate a WebSocket upgrade. Never trust a socket handshake user ID. The normal server currently has no authentication middleware; it will return 401 until the team integrates login. The existing demo runner supplies fixed local identities for development only. Never accept a viewer ID from a query parameter or browser storage as authentication.

- `GET /api/chat`: inbox, including active and ended connections.
- `GET /api/chat/:id/messages`: latest 50 messages, chronological order, conversation state and `next_cursor`.
- `GET /api/chat/:id/messages?before=<message UUID>`: previous page.
- `POST /api/chat/:id/messages`: `{ "id": "client-generated UUID", "body": "message text" }`. Reuse the ID when retrying the same send.

Existing RLS enforces membership and blocks. Blocking either member continues to hide the conversation under the existing project policy. Unmatching alone does not hide history. Account/relationship deletion still follows the existing database cascade rules.

The migration routes authenticated message inserts through `send_chat_message` so sending and unmatching take the same participant locks. Any other team's direct message insert must use this function too. No changes to matching behavior are required.

Messages use text-only rendering and parameterized SQL. Socket.IO is a runtime dependency; socket.io-client is a test dependency. Socket.IO uses WebSocket transport, with no periodic polling. History and inbox reads remain authenticated HTTP requests, triggered by socket change notifications, selection, tab visibility, and reconnection. Sending uses `chat:send` with a ten-second acknowledgement timeout and preserves the message ID for safe retries. No Supabase client keys are required. Keep Supabase credentials server-side.

## Verification

Run `npm run test:unit -- --runInBand` for the route regression tests. They mock the database and do not replace the two-account checks above. Apply and test the migration on a development database before production. No database credentials or remote database changes are needed for unit tests.

## Files and socket events

- src/models/chat/chat.model.js: SQL and database transactions.
- src/controllers/chat/chat.controller.js: HTTP handlers and shared send operation.
- src/controllers/chat/chat.socket.js: socket authentication, send handler, and notifications.
- src/routes/chat/chat.routes.js: HTTP route declarations.
- src/services/chat/chat.events.js: event bridge between the app and local demo servers.

Client sends `chat:send` with `{ conversation_id, id, body }`; server acknowledges `{ ok, message }` or `{ ok: false, error }`. The server broadcasts a content-free `chat:changed` signal after a committed send or a successful Discovery mutation. Pages reload their own permitted data through RLS, so the signal exposes no message content or conversation IDs. This simple notification bridge supports multiple demo ports in one Node process. Deployments with multiple Node processes need a shared event adapter/broker. Out-of-band database changes do not emit events through this bridge.

Restart the demo/server after installing the changes. The existing 05_chat migration is still required; no additional migration is needed for Socket.IO.

## Chat profile pictures

The chat list and conversation header show the other member's profile photo, with initials when the photo is missing or cannot load. Discovery currently renders initials; it does not yet download photos itself. This feature reuses the existing profile_photos table and private profile-photos storage bucket. It does not add a separate photo-upload flow.

To enable uploaded photos:

1. Apply db_Schema_Change_log/05_chat/002_chat_photos.sql in the Supabase SQL editor after 001_chat.sql.
2. Set SUPABASE_URL (your project HTTPS URL) and SUPABASE_SERVICE_ROLE_KEY (your server-only legacy service_role key) in .env.dev. Keep the key out of browser code, screenshots, and Git.
3. The profile owner uploads their photo to profile-photos and saves its user-prefixed storage_path in profile_photos through the team's profile feature. Chat prefers is_primary, then falls back to the first photo by sort_order.
4. Restart the app/demo. Without storage configuration, chat continues to work with initials.

GET /api/chat/:id/photo checks the signed-in viewer and uses a narrowly scoped database function to find only the other member's photo. Current and ended conversations may show photos while can_read_conversation allows access; blocking still denies access. The server proxies the image and sends Cache-Control: no-store; it never sends storage credentials or signed URLs to the browser. A missing photo or inaccessible conversation returns 404. JPEG, PNG and WebP up to 8 MiB are supported.

Photo-access unit tests mock storage; the browser smoke check verified avatars and missing-image fallback. Live storage and the new SQL migration still need testing against the team's development Supabase project.
