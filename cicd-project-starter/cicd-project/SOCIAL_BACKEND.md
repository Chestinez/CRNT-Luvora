# Luvora social backend

## Middleware handoff

In `src/app.js`, mount the team's identity middleware ahead of both social
routers. The middleware must verify the request and populate
`req.user.id` with the UUID in `public.users.id`. A request with no identity
receives 401. Browser calls use same-origin fetch and its default cookie behavior.
If the team uses bearer tokens, supply them through the team's fetch client.

```js
app.use('/api/posts', teamAuthMiddleware, postRouter);
app.use('/api/discovery', teamAuthMiddleware, discoveryRouter);
```

## PostgreSQL setup

From Supabase **Connect**, choose **Session pooler** and copy the PostgreSQL
URI on port 5432. Replace the password placeholder with the database password.
Percent-encode reserved characters in the password. Put the URI in
`DATABASE_URL` in `.env.dev` beside `package.json`, then run `npm run start`.
Use SSL verification, for example `sslmode=verify-full` with the Supabase root
certificate as `sslrootcert` if needed. Keep the connection string on the server.

The connection role must be allowed to `SET ROLE authenticated`. The pool
borrows one client per operation. In a transaction it switches to the
authenticated role and sets the viewer claim from `req.user.id`. Existing RLS
and SQL triggers apply during the query. The role and claim expire when the
transaction ends.

## Request flow

| Layer | Responsibility |
| --- | --- |
| `src/routes/{posts,discovery}` | HTTP methods and paths |
| `src/controllers/{posts,discovery}` | Trusted viewer ID, input validation, and response status |
| `src/services/{posts,discovery}` | Feature behavior, transaction scope, and expected errors |
| `src/models/{posts,discovery}` | Parameterized SQL |
| `src/db` | Shared PostgreSQL pool and transaction-scoped viewer context |

| Method and route | Purpose |
| --- | --- |
| GET /api/discovery/profiles | Up to 30 eligible profiles, excluding the viewer |
| GET /api/discovery/couple-stories | Up to 30 visible published couple stories, newest first |
| GET /api/posts/relationships | Relationships the viewer can use to create a draft |
| GET /api/posts | View the viewer's 50 most recently updated couple stories |
| POST /api/posts | Create a draft with `relationshipId`, `title`, and `caption` |
| GET /api/posts/review | Draft revisions awaiting the viewer's approval |
| PATCH /api/posts/:id | Edit with `revision`, `title`, and `caption` |
| POST /api/posts/:id/approve | Approve the supplied `revision` |
| POST /api/posts/:id/publish | Publish the approved `revision` |
| DELETE /api/posts/:id | Delete the viewer's story at the supplied `revision` |

Send mutation bodies as JSON. The database trigger moves an edited published
story back to draft and advances its content revision. Both partners approve
the new revision before the author publishes again.

Profile cards read the existing `discoverable_profiles` view. Couple stories
read the existing `posts` table under its RLS policy. The first version uses
separate lists and fixed limits. Ranking can consume these content sources once
the matching and story-ranking rules are implemented.
