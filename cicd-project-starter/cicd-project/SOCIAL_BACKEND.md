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

For local demo accounts and npm commands, see [Run the Luvora demo](luvora-demo-runner.md).

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
| GET /api/discovery/profiles | Up to 30 eligible profiles, excluding the viewer and hidden profiles |
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

## Profile browsing actions

Run `db_Schema_Change_log/03_profile_actions_table/001_profile_browse_actions.sql` in the existing
Supabase database before starting this version. It adds a private state table.
No extra seed is needed. The demo accounts start with empty lists.

| Method and route | Purpose |
| --- | --- |
| GET /api/discovery/profiles/saved | List currently visible bookmarked profiles |
| GET /api/discovery/profiles/hidden | List currently visible profiles hidden from For You |
| PUT /api/discovery/profiles/:profileId/:action | Add a bookmark or hide |
| DELETE /api/discovery/profiles/:profileId/:action | Remove a bookmark or restore a hidden profile |

Use `saved` or `hidden` for `:action` and send an empty JSON object for mutations.
The server gets the viewer from `req.user.id`. Adding an action for an unavailable
profile returns 404. Repeat writes for a visible profile and repeat deletes
return 204. Hidden profiles are excluded only from For You. Both lists apply
the same visibility rules as For You. Saves and hides are independent.

The table records which actions are active now. Historical feedback and
ranking are separate work. The feature does not write `interaction_events`.
