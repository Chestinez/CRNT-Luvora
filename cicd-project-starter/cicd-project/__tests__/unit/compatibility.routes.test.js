const express = require('express');
const request = require('../helpers/http-request');
const { QUESTIONS } = require('../../src/data/compatibilityQuestions');
jest.mock('../../src/db/with-viewer');
jest.mock('../../src/services/compatibility/compatibility.recommendations', () => ({
  recommendations: jest.fn(async () => []),
}));
const withViewer = require('../../src/db/with-viewer');
const router = require('../../src/routes/compatibility/compatibility.routes');
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
let records;
let app;
let query;
const base = '/api/compatibility';
const draft = (revision = 1) => ({
  revision,
  action: 'draft',
  answers: { 'goals-01': ['serious'] },
  partnerPreferences: {},
  skippedQuestionIds: [],
});
const call = (method, path, body, user = alice) =>
  request(app, method, base + path, body, user ? { 'x-test-user': user } : {});

beforeEach(() => {
  records = new Map();
  query = jest.fn(async (sql, params) => {
    const [id] = params;
    if (sql.includes('SELECT *'))
      return { rows: records.has(id) ? [structuredClone(records.get(id))] : [] };
    if (sql.includes('INSERT INTO')) {
      if (records.has(id)) return { rows: [] };
      const row = {
        user_id: id,
        questionnaire_version: params[1],
        revision: 1,
        answers: {},
        partner_preferences: {},
        skipped_question_ids: [],
        core_completed_at: null,
      };
      records.set(id, row);
      return { rows: [structuredClone(row)] };
    }
    if (sql.includes('UPDATE public')) {
      const row = records.get(id);
      if (!row || row.revision !== params[5]) return { rows: [] };
      Object.assign(row, {
        answers: JSON.parse(params[1]),
        partner_preferences: JSON.parse(params[2]),
        skipped_question_ids: JSON.parse(params[3]),
        core_completed_at: params[4],
        revision: row.revision + 1,
      });
      return { rows: [structuredClone(row)] };
    }
    if (sql.includes('DELETE FROM')) {
      records.delete(id);
      return { rows: [] };
    }
    throw new Error('Unexpected query');
  });
  withViewer.mockImplementation(async (_id, run) => run({ query }));
  app = express();
  app.use(express.json());
  // Test-only identity. Production routes never trust this header.
  app.use((req, _res, next) => {
    if (req.headers['x-test-user']) req.user = { id: req.headers['x-test-user'] };
    next();
  });
  app.use(base, router);
});

test('requires authentication and avoids database access', async () => {
  const count = withViewer.mock.calls.length;
  expect((await call('GET', '/assessment', undefined, null)).status).toBe(401);
  expect(withViewer.mock.calls.length).toBe(count);
});
test('serves 15 questions with no-store', async () => {
  const response = await call('GET', '/questions');
  expect(response.status).toBe(200);
  expect(response.body.questions).toHaveLength(15);
  expect(response.headers['cache-control']).toBe('no-store');
});
test('creates, reads, updates and deletes only own assessment', async () => {
  expect((await call('GET', '/assessment')).body.assessment).toBeNull();
  expect((await call('POST', '/assessment')).status).toBe(201);
  expect((await call('POST', '/assessment')).status).toBe(409);
  expect((await call('GET', '/assessment', undefined, bob)).body.assessment).toBeNull();
  const saved = await call('PUT', '/assessment', draft());
  expect(saved.status).toBe(200);
  expect(saved.body.assessment.revision).toBe(2);
  expect((await call('GET', '/assessment')).body.assessment.answers).toEqual(draft().answers);
  expect((await call('DELETE', '/assessment', { revision: 2 }, bob)).status).toBe(404);
  expect((await call('DELETE', '/assessment', { revision: 2 })).status).toBe(204);
  expect((await call('GET', '/assessment')).body.assessment).toBeNull();
});
test('rejects stale saves and deletes without changing data', async () => {
  await call('POST', '/assessment');
  await call('PUT', '/assessment', draft());
  expect((await call('PUT', '/assessment', draft())).status).toBe(409);
  expect((await call('DELETE', '/assessment', { revision: 1 })).status).toBe(409);
  expect(records.get(alice).revision).toBe(2);
});
test('rejects invalid answers and identity injection', async () => {
  await call('POST', '/assessment');
  expect((await call('PUT', '/assessment', { ...draft(), userId: bob })).status).toBe(400);
  expect(
    (await call('PUT', '/assessment', { ...draft(), answers: { 'goals-01': ['bad'] } })).status,
  ).toBe(400);
  expect(records.get(alice).revision).toBe(1);
});
test('completion requires all questions and editing can clear completion', async () => {
  await call('POST', '/assessment');
  expect((await call('PUT', '/assessment', { ...draft(), action: 'complete' })).status).toBe(400);
  const answers = Object.fromEntries(QUESTIONS.map((q) => [q.id, [q.options[0].value]]));
  const result = await call('PUT', '/assessment', { ...draft(), answers, action: 'complete' });
  expect(result.status).toBe(200);
  expect(result.body.assessment.core_completed_at).toBeTruthy();
  const changed = await call('PUT', '/assessment', draft(2));
  expect(changed.body.assessment.core_completed_at).toBeNull();
});
test('masks database failures', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  withViewer.mockRejectedValueOnce(new Error('private database details'));
  const response = await call('GET', '/assessment');
  expect(response.status).toBe(500);
  expect(JSON.stringify(response.body)).not.toContain('private database');
  log.mockRestore();
});
