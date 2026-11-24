jest.mock('../../src/db/pool', () => ({ connect: jest.fn() }));
const pool = require('../../src/db/pool');
const {
  recommendations,
} = require('../../src/services/compatibility/compatibility.recommendations');
const originalUrl = process.env.DATABASE_URL;
afterAll(() => {
  if (originalUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalUrl;
});
let client;
beforeEach(() => {
  process.env.DATABASE_URL = 'test-only';
  client = { query: jest.fn(async () => ({ rows: [] })), release: jest.fn() };
  pool.connect.mockResolvedValue(client);
});
test('scopes the server-only function to the authenticated viewer and releases', async () => {
  expect(await recommendations('trusted-viewer')).toEqual([]);
  expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN READ ONLY');
  expect(client.query).toHaveBeenCalledWith('SET LOCAL ROLE service_role');
  expect(client.query).toHaveBeenCalledWith(
    "SELECT set_config('request.jwt.claim.sub', $1, true)",
    ['trusted-viewer'],
  );
  expect(client.query).toHaveBeenCalledWith(
    'SELECT * FROM public.compatibility_candidate_snapshots()',
  );
  expect(client.query).toHaveBeenCalledWith('COMMIT');
  expect(client.release).toHaveBeenCalledWith(false);
});
test('rolls back and releases on failure', async () => {
  client.query.mockImplementation(async (sql) => {
    if (sql.includes('snapshots')) throw new Error('test failure');
    return { rows: [] };
  });
  await expect(recommendations('trusted-viewer')).rejects.toThrow('test failure');
  expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  expect(client.release).toHaveBeenCalledWith(false);
});
test('discards connection if rollback fails', async () => {
  client.query.mockImplementation(async (sql) => {
    if (sql.includes('snapshots') || sql === 'ROLLBACK') throw new Error('test failure');
    return { rows: [] };
  });
  await expect(recommendations('trusted-viewer')).rejects.toThrow();
  expect(client.release).toHaveBeenCalledWith(true);
});
test('missing database configuration fails before a connection is acquired', async () => {
  delete process.env.DATABASE_URL;
  const calls = pool.connect.mock.calls.length;
  await expect(recommendations('trusted-viewer')).rejects.toMatchObject({ status: 503 });
  expect(pool.connect.mock.calls.length).toBe(calls);
});
