// Start with npm run demo. Setup and SQL order are in luvora-demo-runner.md.
// Each loopback port supplies one fixed, seeded demo identity to the existing app.
const path = require('node:path');
const { createRequire } = require('node:module');

const appDirectory = __dirname;
const fromApp = createRequire(path.join(appDirectory, 'package.json'));
const demoAccounts = [
  { name: 'Maya', email: 'luvora-maya@example.com', port: 3101 },
  { name: 'Ethan', email: 'luvora-ethan@example.com', port: 3102 },
  { name: 'Aisha', email: 'luvora-aisha@example.com', port: 3103 },
];

async function main() {
  const dotenv = fromApp('dotenv');
  dotenv.config({ path: path.join(appDirectory, '.env.dev'), quiet: true });
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The demo runner is for local development.');
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('Set DATABASE_URL in .env.dev beside package.json.');
  }

  const checkOnly = process.argv.includes('--check');
  const pool = fromApp('./src/db/pool.js');
  const withViewer = fromApp('./src/db/with-viewer.js');
  const servers = [];
  try {
    const {
      rows: [schema],
    } = await pool.query(
      `SELECT to_regclass('public.users') IS NOT NULL AS users,
              to_regclass('public.discoverable_profiles') IS NOT NULL AS profiles,
              to_regclass('public.posts') IS NOT NULL AS posts,
              to_regclass('public.profile_browse_actions') IS NOT NULL AS actions`,
    );
    if (!schema.users || !schema.profiles || !schema.posts) {
      throw new Error('Luvora schema missing. Follow the Supabase setup in luvora-demo-runner.md.');
    }
    if (!schema.actions) {
      throw new Error('Run 001_profile_browse_actions.sql from db_Schema_Change_log.');
    }

    const emails = demoAccounts.map(({ email }) => email);
    const { rows } = await pool.query(
      "SELECT id, lower(email) AS email FROM public.users WHERE lower(email) = ANY($1::text[]) AND account_status = 'active'",
      [emails],
    );
    const users = new Map(rows.map(({ id, email }) => [email, id]));
    const missing = emails.filter((email) => !users.has(email));
    if (missing.length) {
      throw new Error(
        `Run the posts seed after creating the Auth accounts. Missing active demo users: ${missing.join(', ')}`,
      );
    }

    // Check that the pool can use the same identity and RLS role as a social request.
    const maya = users.get(demoAccounts[0].email);
    const {
      rows: [identity],
    } = await withViewer(maya, (client) =>
      client.query('SELECT auth.uid()::text AS id, current_user AS role'),
    );
    if (identity?.id !== maya || identity.role !== 'authenticated') {
      throw new Error('The database connection could not establish the demo viewer role.');
    }

    await withViewer(maya, async (client) => {
      await client.query('SELECT user_id FROM public.discoverable_profiles LIMIT 0');
      await client.query('SELECT id FROM public.posts LIMIT 0');
      await client.query('SELECT viewer_id FROM public.profile_browse_actions LIMIT 0');
    });

    if (checkOnly) {
      await pool.end();
      console.log('Demo check passed. Start the demo with npm run demo.');
      return;
    }

    const app = fromApp('./src/app.js');
    const http = require('node:http');
    for (const { name, email, port } of demoAccounts) {
      const host = `127.0.0.1:${port}`;
      const server = http.createServer((req, res) => {
        const origin = req.headers.origin;
        if (
          req.headers.host !== host ||
          (origin && origin !== `http://${host}`) ||
          req.headers['sec-fetch-site'] === 'cross-site'
        ) {
          res.writeHead(403).end('Open the printed local URL.');
          return;
        }
        req.user = { id: users.get(email) };
        app(req, res);
      });

      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
      servers.push(server);
      console.log(
        `${name.padEnd(5)}  http://${host}${name === 'Aisha' ? '/discovery/' : '/discovery/my-posts.html'}`,
      );
    }
  } catch (error) {
    servers.forEach((server) => server.close());
    await pool.end();
    throw error;
  }
}

main().catch((error) => {
  const hints = {
    '28P01': 'Check the database password and Session pooler username in DATABASE_URL.',
    42501: 'Check that the database role can switch to authenticated and read the demo tables.',
    ENOTFOUND: 'Check the Session pooler hostname in DATABASE_URL.',
    ECONNREFUSED: 'Could not connect to the pooler. Check the host, port and network.',
    ERR_INVALID_URL:
      'DATABASE_URL is invalid. Copy the Session pooler URI and encode the password.',
  };
  console.error(`Demo runner: ${hints[error.code] ?? error.message}`);
  process.exitCode = 1;
});
