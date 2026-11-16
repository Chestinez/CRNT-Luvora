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
- Password recovery and social login are outside this feature.

## Two-factor authentication (2FA)

Supabase's built-in TOTP MFA is used; no SQL, tables, schema, or dependencies
are added. In the Supabase Auth MFA settings, ensure **TOTP enrollment and
verification** are enabled. The existing URL and publishable/anon key are sufficient.
No service-role key is used.

1. Start the app, log in, and select **Add two-factor authentication** on the
   account page (or open `/auth/security.html`).
2. Select **Set up authenticator**, scan the QR in a TOTP authenticator app, or
   enter the setup key manually. Keep access to the app or its secure backup.
3. Enter the current six-digit code to activate 2FA. Until verified, setup is
   pending and does not lock the account out. Cancel removes the pending factor;
   restarting after a reload replaces only Luvora's unfinished enrollment.
4. Log out, then log in again. A verified code is now required before accessing
   the account page, posts, or discovery APIs. Password-only sessions may only
   inspect their identity/security status, verify the existing factor, or log out.
5. To remove an authenticator, open Account security, choose **Remove an
   authenticator**, and enter a fresh code. Removal signs out this browser.

The server validates each session with Supabase before reading its JWT assurance
claim. Enrolled accounts require `aal2`; unverified enrollments cannot be used to
bypass an existing factor. The elevated token replaces the HttpOnly cookie.
Secrets and codes are not logged, persisted in browser storage, or placed in URLs.
MFA mutations are limited to 10 per account per 10 minutes in this server process,
in addition to Supabase limits. Multiple app instances need a shared limiter.

Enforcement covers this Express app's authenticated routes. Existing database RLS
policies remain unchanged: they do not add an `aal2` requirement for direct
Supabase Data API callers. Database-wide MFA enforcement must be coordinated with
the team separately. The local demo runner still uses its existing simulated
identity; test real 2FA through `npm.cmd start`, not `npm.cmd run demo`.

If an authenticator is lost, there is no password-only disable button or recovery
bypass. Use the authenticator's backup, or have the project owner verify the
account holder before removing the lost factor through Supabase's administrative
tools. Recovery codes, SMS and email OTP are not implemented in this feature.
The UI supports TOTP; an account with only a different verified factor is blocked
with recovery guidance rather than allowed through.

Reference: [Supabase authenticator MFA](https://supabase.com/docs/guides/auth/auth-mfa/totp).

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
