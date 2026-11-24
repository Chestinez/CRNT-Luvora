# Compatibility onboarding: setup, tests and team handoff

## Implemented flow

15 required questions (3 in each category) → enhancement choices → optional existing MBTI or discovery.
There is no additional five-question step. Partner preferences appear alongside the same 15 questions.
Question IDs remain stable; gaps in numbering are deliberate because the optional questions were retired.
The existing skipped_question_ids database column stays for migration compatibility but new submissions send [].

Entry point: `/compatibility/`. Editing/deletion: `/compatibility/enhance.html`.
The home page and discovery header link to this flow.
The signup, face verification and basic profile screens are not present on this branch. Their owner should
redirect to `/compatibility/` after those steps and install real authentication middleware before `/api/*`.
Never take req.user.id from a browser-supplied header or body. The demo runner's fixed identities are local only.
No production authentication or deployment pipeline is introduced by this patch.

## Apply database migrations

Use the development Supabase project. Existing base schema, profile actions, connections and MBTI migrations
must already be applied. Never run migration:reset on the shared database.

1. If not already applied, run `db_Schema_Change_log/06_compatibility/001_compatibility_assessments.sql` once.
2. Run `db_Schema_Change_log/06_compatibility/002_compatibility_candidates.sql` once.

The second migration installs a server-only function for reading eligible candidate snapshots. It also
removes retired optional-question answers/preferences if any were saved by a previous prototype; keep an
export first if those prototype answers matter. The current repo did not have the optional-question UI.
The backend connection must be able to SET ROLE authenticated (existing CRUD) and service_role (recommendations).
Do not grant authenticated or anon execution on compatibility_candidate_snapshots, or expose DATABASE_URL.
The function enforces existing verification, blocked-user, hidden-user and relationship-state eligibility.
Browser responses contain only public profile fields and aggregate category scores, never private answer snapshots.

## Automated checks (from cicd-project)

```sh
npm run test:compatibility
npm run test:unit -- --runInBand
npx playwright install chromium
npm run test:compatibility:ui
```

Unit/API tests use an in-memory database stub; they do not prove PostgreSQL RLS or SQL correctness.
Browser tests intercept requests with deterministic fixtures and do not modify Supabase. They check autosaving,
resuming, editing preferences, completion, deletion, mobile width, missing answers and stale-tab conflicts.
The new repository-root `.github/workflows/compatibility.yml` runs unit and browser tests on pushes/PRs.
No new npm dependencies are required. The package lock is unchanged.

### Real development database checks

Find two existing demo account UUIDs in Supabase:

```sql
SELECT id, email FROM public.users
WHERE email IN ('luvora-maya@example.com', 'luvora-ethan@example.com');
```

With DATABASE_URL in your existing `.env.dev`, substitute those UUIDs:

```sh
npm run test:compatibility:db -- FIRST_DEMO_USER_UUID SECOND_DEMO_USER_UUID
```

This verifies schema, private function permissions, insert/read/update/delete, revision trigger, cross-account
read/delete/insert denial, and executes the candidate SQL. All test writes are in one transaction rolled back
at the end. It briefly locks the first account's assessment: run while that demo account is idle.
It does not fabricate eligible pairs or verify recommendations with every live profile combination.

## Manual acceptance checklist

Start `npm run demo` (restart if already running).

1. Open `http://127.0.0.1:3101/compatibility/` (Maya). Expect 15 questions and no Skip/extra-five option.
2. Select an answer. Wait for Saved. Refresh: resume at the next unanswered question. Back restores the answer.
3. Enable a partner preference, select accepted answers, importance and a dealbreaker. Wait for Saved.
   Reopen editing and verify all controls persist. Turn the preference off and confirm it is removed after saving.
4. Select four interests: an error must appear and no invalid answer must be saved. Select at most three to recover.
5. Complete all 15. Expect enhancement choices for MBTI and discovery, plus edit/delete controls.
6. Open two edit tabs. Save in tab A; save in stale tab B. B must show a conflict and disable saving until reloaded.
7. Open Ethan's port 3102. He must have his own assessment, not Maya's. Complete his questionnaire too if testing recommendations.
8. In discovery, choose Compatibility. Eligible, verified, single members with complete questionnaires and
   reciprocal preferences appear with alignment scores and category breakdowns. Different answers should change scores.
   Unmet dealbreakers exclude a candidate. Saved/hidden actions remain available; hiding removes a recommendation.
9. Use My preferences to edit again. Return to Compatibility to refresh scores. MBTI completion is not required.
10. On a disposable demo assessment, delete with confirmation. GET /api/compatibility/assessment must return null.
    The account and MBTI assessment must remain intact.

These actions change demo account answers. Use only demo accounts for testing.

## Scoring contract and current limits

- Goals 30%, values 25%, communication 20%, lifestyle 15%, interests 10%.
- Default comparison: identical option 1, different nominal option 0, flexible option 0.75, ordered partial
  credit for supported scales, Jaccard overlap for multi-select interests.
- Explicit partner preference replaces default similarity in that direction. Weight 0/1/3 means ignore/normal/high.
  Both directions are combined. Dealbreakers require all selected partner values to be in the accepted set.
- No score without two valid completed questionnaires, >=10 contributing questions, and >=2 in each category.
- Percentages describe preference alignment, not scientifically validated relationship-success probabilities.
  MBTI and zodiac do not add arbitrary compatibility bonuses.
- Recommendations enforce reciprocal gender, hard age, hard region and hard goal filters. Empty gender selections
  mean no gender restriction. Existing can_match_users also enforces adult/verified/discoverable/unblocked/single.
- Coordinates do not exist in this schema. If either member sets max_distance_km, this implementation excludes
  the pair from Compatibility because it cannot verify the limit. The existing For You feed is unchanged.
  Do not advertise working distance matching until the matching teammate adds a location-aware implementation.
- Up to 500 visible candidates (stable UUID order) are scored, returning the best 30 of that pool. This is a
  bounded student-project implementation, not global ranking over an unlimited population.
- For You is still your teammate's existing feed. Compatibility is a separate dropdown choice. Coordinate before
  replacing the team's general matching algorithm or making compatibility a default filter.

## Suggested commits

Review `git diff` before staging; never add .env files or the unrelated parent package-lock.json.
You may commit this cohesive feature as one commit after acceptance checks, or split:

1. Question retirement + UI + validation updates.
2. Scoring + candidate migration/service + routes + discovery integration + tests.
3. CI workflow + test scripts + documentation.

Run the full compatibility tests after all files are applied before pushing. Avoid committing an intermediate
state that registers the recommendations route before its service exists.
