# Luvora sign-up and login

This feature uses the existing Supabase PostgreSQL schema and Supabase Auth.
No SQL files, schema, migrations, seeds, database connections, or social feature
files were changed. `src/app.js` mounts the new auth routes and passes verified
`req.user.id` to the existing posts/discovery routes, as their handoff requires.
The existing home page is unchanged.

## Run locally

From this directory (the one containing `package.json`):

```powershell
npm.cmd ci
npm.cmd start
```

Before starting, add these values to your local, git-ignored `.env.dev`.
Preserve any existing `DATABASE_URL` and other settings.

```dotenv
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
APP_ORIGIN=http://localhost:3000
PORT=3000
```

`SUPABASE_ANON_KEY` is also supported for projects using a legacy anon key.
Use the URL and publishable/anon key from the **same Supabase project** as
`DATABASE_URL`. A database URL alone does not configure Auth. Do not use a
service-role or secret key. No extra npm dependencies are required (Node 22+).

Open:

- Sign up: <http://localhost:3000/signup>
- Login: <http://localhost:3000/login>
- Account and logout: <http://localhost:3000/auth/account.html>

In Supabase Authentication URL Configuration, allow
`http://localhost:3000/auth/login.html` as a redirect URL. Keep email confirmation
enabled. Use your deployed HTTPS origin and corresponding login URL when hosting.
`APP_ORIGIN` must exactly match the browser origin, without a trailing slash.
Use `NODE_ENV=production` and HTTPS in production so session cookies are Secure.

## How registration works

1. Both browser and server validate name, email, password, matching passwords,
   and a real date of birth for someone aged 18+ (UTC calendar boundary).
   Passwords require 12–128 characters, uppercase, lowercase, a number and a symbol.
2. The server calls Supabase Auth with email/password and name/DOB metadata.
   Passwords are never written to an application table or browser storage.
3. Your existing `luvora_on_auth_signup` trigger creates the public user,
   profile, preferences, and discovery settings. The app never inserts users.
4. With email confirmation enabled, the page asks the user to check their inbox.
   The email link confirms the address and returns to login. URL tokens are
   discarded; the user logs in with their password to establish the app session.
5. On successful login (or immediate signup if confirmation is disabled), the
   server fills an unset profile DOB using the user's access token under RLS.
   It does not overwrite an existing DOB or change discovery/onboarding flags.
   If that write fails, the account page explains it and the next login retries.
6. The account page links to the existing Discovery page. Completing profile
   onboarding and becoming discoverable remain the profile feature's responsibility.

## Sessions and safeguards

- The access token is in an HttpOnly, SameSite=Lax cookie, never localStorage.
- Sessions expire at the provider expiry or one hour, whichever is sooner.
  This implementation deliberately does not retain refresh tokens; log in again
  after expiry. Logout clears the cookie and asks Supabase to revoke the session.
  As with Supabase JWT sessions generally, an already copied access token can
  remain valid until its expiry.
- Supabase verifies the token before the server sets `req.user`. The browser
  cannot supply another member's ID to impersonate them.
- Auth POSTs require JSON and a custom request header. Origin checks also apply
  to authenticated social mutations. No permissive CORS is enabled.
- Signup/login are limited to 20 requests per IP per 15 minutes in one server
  process, in addition to Supabase limits. For multiple server instances use a
  shared rate-limit store; configure trusted proxies only for known infrastructure.
- Provider/network errors are sanitized. Duplicate signup gets a neutral
  confirmation response where Supabase reports an existing account.
- DOB checking is self-reported age gating, not identity/age verification.
- Password recovery, social login, and MFA are outside this feature.

## Safe checks

```powershell
npm.cmd run test:unit -- --runInBand
npx.cmd eslint -c configs/eslint.config.mjs src/auth src/public/auth/auth.js src/app.js __tests__/unit/auth.test.js
npx.cmd playwright install chromium --only-shell
npx.cmd playwright test --config=configs/playwright-auth.config.js
```

Auth API tests mock the Supabase network boundary. Browser tests stub auth
responses and use a dedicated server. Neither creates accounts nor touches your
database. Do not use the existing database-reset integration/E2E setup for these
checks against the shared database.

For a real connection check after configuration, register a test account you
own, confirm its email, log in, open Discovery, and log out. This creates normal
account records through the existing trigger; no schema changes are needed.

Provider references: [Supabase signup](https://supabase.com/docs/reference/javascript/auth-signup),
[Auth endpoints](https://github.com/supabase/auth/blob/master/README.md#endpoints),
and [session lifecycle](https://supabase.com/docs/guides/auth/sessions).
