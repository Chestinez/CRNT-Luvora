/* Read-only schema checks plus CRUD/RLS probes inside a rolled-back transaction.
 * Run against your development database with two existing demo account IDs.
 */
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const [first, second] = process.argv.slice(2);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!uuid.test(first || '') || !uuid.test(second || '') || first === second) {
  console.error(
    'Usage: npm run test:compatibility:db -- FIRST_DEMO_USER_UUID SECOND_DEMO_USER_UUID',
  );
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
async function run() {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SET LOCAL lock_timeout = '3s'");
    const {
      rows: [schema],
    } = await client.query(`SELECT
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.compatibility_assessments'::regclass) AS rls,
      has_function_privilege('authenticated', 'public.compatibility_candidate_snapshots()', 'EXECUTE') AS browser_rpc,
      has_function_privilege('anon', 'public.compatibility_candidate_snapshots()', 'EXECUTE') AS anonymous_rpc`);
    assert.equal(schema.rls, true);
    assert.equal(schema.browser_rpc, false);
    assert.equal(schema.anonymous_rpc, false);
    await client.query('SET LOCAL ROLE authenticated');
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [first]);
    await client.query(
      `INSERT INTO public.compatibility_assessments (user_id)
      VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [first],
    );
    const {
      rows: [before],
    } = await client.query(
      'SELECT revision FROM public.compatibility_assessments WHERE user_id=$1',
      [first],
    );
    assert.ok(before);
    const {
      rows: [after],
    } = await client.query(
      `UPDATE public.compatibility_assessments SET answers = '{"goals-01":["serious"]}'::jsonb
      WHERE user_id=$1 AND revision=$2 RETURNING revision`,
      [first, before.revision],
    );
    assert.equal(after.revision, before.revision + 1);
    const stale = await client.query(
      'UPDATE public.compatibility_assessments SET answers=answers WHERE user_id=$1 AND revision=$2',
      [first, before.revision],
    );
    assert.equal(stale.rowCount, 0);
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [second]);
    assert.equal(
      (
        await client.query('SELECT * FROM public.compatibility_assessments WHERE user_id=$1', [
          first,
        ])
      ).rowCount,
      0,
    );
    assert.equal(
      (await client.query('DELETE FROM public.compatibility_assessments WHERE user_id=$1', [first]))
        .rowCount,
      0,
    );
    await client.query('SAVEPOINT forbidden_write');
    let denied = false;
    try {
      await client.query('INSERT INTO public.compatibility_assessments (user_id) VALUES ($1)', [
        first,
      ]);
    } catch (error) {
      denied = error.code === '42501';
    }
    await client.query('ROLLBACK TO SAVEPOINT forbidden_write');
    assert.equal(denied, true, 'Cross-account insert must be denied by RLS');
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [first]);
    assert.equal(
      (await client.query('DELETE FROM public.compatibility_assessments WHERE user_id=$1', [first]))
        .rowCount,
      1,
    );
    await client.query('RESET ROLE');
    await client.query('SET LOCAL ROLE service_role');
    await client.query('SELECT * FROM public.compatibility_candidate_snapshots()');
    console.log(
      'PASS: schema, private RPC, CRUD, revision trigger and cross-account RLS. All test writes rolled back.',
    );
  } finally {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }
}
run()
  .catch((error) => {
    console.error('Database check failed:', error.code || error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
