# Run the Luvora demo

Open the app folder in PowerShell. It contains `package.json` and
`luvora-demo-runner.cjs`. The demo assigns an existing account to each local
port so you can test Discovery and approvals without entering a password in
the browser. Use the development Supabase project.

## Prepare Supabase

Open each SQL file below in **SQL Editor** and run the whole file as
`postgres`. Keep row-level security enabled.

1. For a fresh Supabase project, run
   `db_Schema_Change_log/01_StartupSchema/Luvora_Supabase_Fresh_Database.sql`.
   If your project already has the Luvora schema, start at the next step.
2. In **Authentication → Users**, create and confirm the six email/password
   accounts below. Use the same project as the SQL Editor. The schema's
   signup trigger creates the linked app rows. Reuse accounts that exist.

   ```text
   luvora-maya@example.com
   luvora-ethan@example.com
   luvora-aisha@example.com
   luvora-daniel@example.com
   luvora-mei@example.com
   luvora-farah@example.com
   ```

3. Run `Luvora_Posts_Demo_Seed.sql` under
   `db_Schema_Change_log/02_ImplementPostsandDiscoveryinSocialPlatform` if
   you have yet to seed this database. It adds the profiles, relationship,
   published stories, and approval draft.
4. Run
   `db_Schema_Change_log/03_profile_actions_table/001_profile_browse_actions.sql`.
   This creates the saved and hidden state table that For You queries.
5. For more stories, run `Luvora_Discovery_Expansion_Seed.sql` from the same
   folder as the posts seed. That file lists optional Auth accounts for extra
   profiles and a second couple.

## Set the database connection

Open **Supabase → Connect → Session pooler** and copy the PostgreSQL URI
on port `5432`. Replace the password placeholder with your database password.
Percent-encode URI special characters in the password, such as `@ → %40`.
In `.env.dev` beside `package.json`, set the following using your copied values:

```dotenv
DATABASE_URL="postgresql://postgres.PROJECT_REF:ENCODED_DB_PASSWORD@POOLER_HOST:5432/postgres?sslmode=verify-full"
```

For a certificate trust error, download the Supabase CA certificate from
Database Settings and add `&sslrootcert=C:/path/to/certificate.crt` to the URI.
Use forward slashes and encode spaces in the path as `%20`. The URI is a
server credential. `.env.dev` is ignored by Git. The runner uses PostgreSQL
directly, so the URI is the only connection setting it reads. Use a connection
role that can read the demo accounts and switch to `authenticated`.

## Start the demo

```powershell
Set-Location 'C:\Users\chest\Downloads\Luvora\cicd-project-starter\cicd-project'
npm ci
npm run demo:check
npm run demo
```

`npm ci` installs the locked dependencies. Run it for a fresh checkout or
after dependency changes. `demo:check` checks the connection, the three demo
accounts, and the tables and permissions used by the demo. It exits without
starting any listeners. `demo` runs the same checks and starts the app.

| Account | URL |
| --- | --- |
| Maya | [My couple stories](http://127.0.0.1:3101/discovery/my-posts.html) |
| Ethan | [My couple stories](http://127.0.0.1:3102/discovery/my-posts.html) |
| Aisha | [Discovery](http://127.0.0.1:3103/discovery/) |

Leave the terminal open while using the demo. Press **Ctrl+C** to stop it.
If a port is in use, stop the earlier demo process and rerun `npm run demo`.
If a database check fails, follow the terminal message and rerun `demo:check`.
