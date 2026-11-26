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

| Layer                               | Responsibility                                               |
| ----------------------------------- | ------------------------------------------------------------ |
| `src/routes/{posts,discovery}`      | HTTP methods and paths                                       |
| `src/controllers/{posts,discovery}` | Trusted viewer ID, input validation, and response status     |
| `src/services/{posts,discovery}`    | Feature behavior, transaction scope, and expected errors     |
| `src/models/{posts,discovery}`      | Parameterized SQL                                            |
| `src/db`                            | Shared PostgreSQL pool and transaction-scoped viewer context |

| Method and route                          | Purpose                                                      |
| ----------------------------------------- | ------------------------------------------------------------ |
| GET /api/discovery/profiles               | Up to 30 mutually eligible singles in alphabetical order     |
| GET /api/discovery/profiles/compatibility | Ranked catalogue of mutually eligible singles                |
| GET /api/discovery/couple-stories         | Up to 30 visible published couple stories, newest first      |
| GET /api/posts/relationships              | Relationships the viewer can use to create a draft           |
| GET /api/posts                            | View the viewer's 50 most recently updated couple stories    |
| POST /api/posts                           | Create a draft with `relationshipId`, `title`, and `caption` |
| GET /api/posts/review                     | Draft revisions awaiting the viewer's approval               |
| PATCH /api/posts/:id                      | Edit with `revision`, `title`, and `caption`                 |
| POST /api/posts/:id/approve               | Approve the supplied `revision`                              |
| POST /api/posts/:id/publish               | Publish the approved `revision`                              |
| DELETE /api/posts/:id                     | Delete the viewer's story at the supplied `revision`         |

Send mutation bodies as JSON. The database trigger moves an edited published
story back to draft and advances its content revision. Both partners approve
the new revision before the author publishes again.

Profile cards read the existing `discoverable_profiles` view. Couple stories
read the existing `posts` table under its RLS policy.

## Profile browsing actions

Run `db_Schema_Change_log/03_profile_actions_table/001_profile_browse_actions.sql` in the existing
Supabase database before starting this version. It adds a private state table.
No extra seed is needed. The demo accounts start with empty lists.

| Method and route                                  | Purpose                                             |
| ------------------------------------------------- | --------------------------------------------------- |
| GET /api/discovery/profiles/saved                 | List currently visible bookmarked profiles          |
| GET /api/discovery/profiles/hidden                | List currently visible profiles hidden from For You |
| PUT /api/discovery/profiles/:profileId/:action    | Add a bookmark or hide                              |
| DELETE /api/discovery/profiles/:profileId/:action | Remove a bookmark or restore a hidden profile       |

Use `saved` or `hidden` for `:action` and send an empty JSON object for mutations.
The server gets the viewer from `req.user.id`. Adding an action for an unavailable
profile returns 404. Repeat writes for a visible profile and repeat deletes
return 204. Hidden profiles are excluded from For You and Compatibility.
Saved and Hidden lists apply the profile visibility rules. Saves and hides are independent.

## Compatibility

Apply `db_Schema_Change_log/05_compatibility/001_structured_compatibility.sql`
after Connections. It uses the existing preference, trait, interest, and
ranking snapshot tables.

Eligibility checks verification, visibility, blocks and connection state.
Age, region and relationship goal filter both ways when flagged as hard.
A configured gender list is a hard requirement. A required numerical trait
uses exact equality with its stored target. A missing field fails a configured
requirement. Empty lists and missing preference rows add no restrictions.
Distance needs location data, so this version uses the available region codes.

For each direction, PostgreSQL averages the available soft categories. Soft
age fit drops to zero 10 years outside the preferred range. Regions and goals
use normalized exact matching. Shared interests use intersection over union,
and numeric traits use their saved importance weights. The harmonic mean
combines the two directions. An unknown direction uses a neutral 0.5 if the
other direction has evidence. Pairs with no soft evidence sort last. The
UUID breaks ties. Invite creation and acceptance use the same hard filters.

Apply `05_compatibility/002_compatibility_filters.sql` to enable the
Compatibility controls. The first request accepts `order` (`alignment`
or `shared`), `minScore` (0–100 in steps of 5), `sharedOnly`
(`true` or `false`), and `minAge`/`maxAge` (18–120). These
options operate within the eligible pool and do not update stored preferences.
`shared` sorts by shared interest count and breaks ties by mutual fit.
Round aggregate alignment to the nearest 5 points for display. The minimum
alignment filter uses the same rounded value, and an unknown score only passes
when no minimum is set.

The first request returns `{ profiles, next }` with up to 30 cards. Pass
`next.snapshot` and `next.after` as query parameters to load the next page.
Each page rechecks live eligibility and hides, while its order follows the
15-minute snapshot. The snapshot also stores the rounded alignment and shared
interest count, so both stay consistent with the sort. Apply filters or reload
to calculate a new list. Expired or foreign snapshots return 410. The API returns
public card fields, the viewer's saved state, and these aggregate details.
The UI combines Discovery ranking in Compatibility and reveals the controls
with **Show scores and filters**. The older `/profiles` endpoint remains
available to existing callers.

## For You learning

Apply `db_Schema_Change_log/06_profile_learning/001_profile_learning.sql` after
the Compatibility migrations, followed by `06_profile_learning/002_profile_learning_ranking.sql`.
Applying `002` expires existing For You cursors so the next refresh computes
the corrected order. Discovery uses the profile's existing
`allow_behavioural_personalization` setting, which defaults to off.

| Request                                                  | Behavior                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| `GET /api/discovery/profiles/learning`                   | Read the current `{ enabled }` setting                             |
| `PUT /api/discovery/profiles/learning`                   | Set consent with `{ "enabled": true }` or `{ "enabled": false }`   |
| `DELETE /api/discovery/profiles/learning`                | Clear learned evidence with an empty JSON object                   |
| `GET /api/discovery/profiles/compatibility?mode=for-you` | Rank and page For You. Include the mode with every cursor request. |

Each new Like or sent request captures the target's interests and numeric
traits at the time of the action. Requests weigh `1.0` and Likes weigh `0.20`.
Each window decays both actions by age, then counts only the strongest one
per target. A fresh Like can outweigh an older request in the short window
while the request still leads in the long window. Unliking removes the Like's
evidence. Hiding suppresses that target's evidence until restored. The learner
uses actions recorded after opting in. Opens and searches carry zero weight.

The 30- and 120-day windows contribute 65% and 35% of the learned estimate.
Confidence grows with decayed evidence, distinct profiles, and distinct action
days. A window adjusts stated directional fit only when the candidate shares
a learned trait key or interest. A window with no overlap keeps its share of
the stated fit. Learning can supply up to 30% of each directional score before
the harmonic mean combines the pair. Each person supplies learned evidence
only while opted in. Displayed compatibility and score filters use stated
alignment. With no usable learning evidence, For You uses the compatibility
order.

Refresh starts a new snapshot. Reset and opt-out clear the viewer's evidence
and expire any For You snapshot that could have used it. Likes, hides, and
connection records are independent of the learned evidence.

Run `npm run test:sql` to verify the ranking on an isolated migrated database.
See the [integration test setup](README.md#integration-database) for configuration.

## Connections

Apply `db_Schema_Change_log/04_connections/001_connections.sql` after the
profile actions migration. Existing pair rows are treated as established
relationships (`stage = 'dating'`). An accepted invitation sets
`stage = 'talking'`. The existing `status` column indicates whether the
pair is active or ended.

| Method and route                                     | Purpose                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| GET /api/discovery/connections                       | Browsing state, active pair, pending invitations, and recent closed invitations |
| POST /api/discovery/connections/requests             | Send `{ "targetId": "<profile UUID>" }`                                         |
| POST /api/discovery/connections/requests/:id/:action | Accept, decline, or withdraw with an empty JSON object                          |
| POST /api/discovery/connections/:id/end              | End a Talking connection with `{ "requestId": "<accepted request UUID>" }`      |

Either user can send an invitation. Only the recipient can accept or decline.
Only the sender can withdraw. A repeat send returns the pending invitation. A
crossed send returns that same request as received so the recipient can
explicitly accept it. Accepting closes all other pending invitations involving
either participant and leaves their saved and hidden rows intact. Ended
connections reopen browsing for both members without restoring closed
invitations. A block cancels pending invitations between the two users and
ends an active Talking connection.

The accepted invitation ID is required when ending a Talking connection so a
request from an old tab cannot end a later connection between the same people.
The existing `end_relationship` RPC applies to established relationships.

Both `talking` and `dating` pause profile browsing and hide the pair from
other people's single-profile lists. The app returns 403 from the profile
routes during the pause. Couple stories are still available.

Chat can use the existing `conversations.relationship_id` and
`conversation_members` rows created when a pair first connects. A repeat
connection between the same users reuses the pair and conversation IDs.
Chat send access follows the existing active-pair and block checks. The
chat feature owns the later transition from `talking` to `dating`. The
current couple-story composer is available to established relationships.
