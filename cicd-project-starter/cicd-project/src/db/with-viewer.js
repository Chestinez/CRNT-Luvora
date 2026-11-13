const createError = require('http-errors');
const pool = require('./pool');

async function withViewer(viewerId, run) {
  if (!process.env.DATABASE_URL) {
    throw createError(503, 'Set DATABASE_URL in .env.dev.');
  }

  const client = await pool.connect();
  let discardClient = false;
  try {
    await client.query('BEGIN');
    // Scope the trusted Express identity to this transaction and preserve Supabase RLS.
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(
      `SELECT set_config('request.jwt.claim.sub', $1, true),
              set_config('request.jwt.claims', $2, true)`,
      [viewerId, JSON.stringify({ sub: viewerId, role: 'authenticated' })],
    );
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      discardClient = true;
    }
    throw error;
  } finally {
    client.release(discardClient);
  }
}

module.exports = withViewer;
