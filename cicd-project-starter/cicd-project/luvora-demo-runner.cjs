// Standalone development runner. Run this file from the Luvora app directory.
// Each loopback port supplies one fixed, seeded demo identity to the existing app.
const path = require('node:path');
const { createRequire } = require('node:module');

const appDirectory = process.cwd();
const fromApp = createRequire(path.join(appDirectory, 'package.json'));
const demoAccounts = [
  { name: 'Maya', email: 'luvora-maya@example.com', port: 3101 },
  { name: 'Ethan', email: 'luvora-ethan@example.com', port: 3102 },
  { name: 'Aisha', email: 'luvora-aisha@example.com', port: 3103 },
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The demo runner is for local development.');
  }

  const dotenv = fromApp('dotenv');
  dotenv.config({ path: ['.env.dev', '.env'], quiet: true });
  if (!process.env.DATABASE_URL) {
    throw new Error('Set DATABASE_URL in .env.dev beside package.json.');
  }

  const app = fromApp('./src/app.js');
  const pool = fromApp('./src/db/pool.js');
  const withViewer = fromApp('./src/db/with-viewer.js');
  const servers = [];
  try {
    const emails = demoAccounts.map(({ email }) => email);
    const { rows } = await pool.query(
      "SELECT id, lower(email) AS email FROM public.users WHERE lower(email) = ANY($1::text[]) AND account_status = 'active'",
      [emails]
    );
    const users = new Map(rows.map(({ id, email }) => [email, id]));
    const missing = emails.filter((email) => !users.has(email));
    if (missing.length) {
      throw new Error(`Missing seeded users in this database: ${missing.join(', ')}`);
    }

    // Check that the pool can use the same identity and RLS role as a social request.
    const maya = users.get(demoAccounts[0].email);
    const { rows: [identity] } = await withViewer(maya, (client) =>
      client.query('SELECT auth.uid()::text AS id, current_user AS role')
    );
    if (identity?.id !== maya || identity.role !== 'authenticated') {
      throw new Error('The database connection could not establish the demo viewer role.');
    }

    const http = require('node:http');
    for (const { name, email, port } of demoAccounts) {
      const host = `127.0.0.1:${port}`;
      const server = http.createServer((req, res) => {
        const origin = req.headers.origin;
        if (req.headers.host !== host || (origin && origin !== `http://${host}`) ||
            req.headers['sec-fetch-site'] === 'cross-site') {
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
      console.log(`${name.padEnd(5)}  http://${host}${name === 'Aisha' ? '/discovery/' : '/discovery/my-posts.html'}`);
    }
  } catch (error) {
    servers.forEach((server) => server.close());
    await pool.end();
    throw error;
  }
}

main().catch((error) => {
  console.error(`Demo runner: ${error.message}`);
  process.exitCode = 1;
});
