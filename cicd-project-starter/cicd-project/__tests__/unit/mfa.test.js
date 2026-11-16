const express = require('express');
const request = require('supertest');
const createAuthRouter = require('../../src/auth/auth.routes');
const { authenticate } = require('../../src/auth/session');

const id = '7a0aa9ed-aafa-4f06-9ed0-97e65c70bc0a';
const factorId = '00fca91c-1cec-4e74-a0e2-5fe6b2c89a7b';
const pendingId = '03fca91c-1cec-4e74-a0e2-5fe6b2c89a7b';
const challengeId = '01fca91c-1cec-4e74-a0e2-5fe6b2c89a7b';
const factor = {
  id: factorId,
  factor_type: 'totp',
  status: 'verified',
  friendly_name: 'Luvora authenticator',
};
const pending = { ...factor, id: pendingId, status: 'unverified' };
const user = {
  id,
  email: 'alex@example.com',
  user_metadata: { display_name: 'Alex' },
  factors: [factor],
};
const originalEnv = { ...process.env };
let app;

// These tokens are accepted ONLY by the mocked provider in this suite.
function token(aal = 'aal1', sub = id) {
  return `header.${Buffer.from(JSON.stringify({ sub, aal })).toString('base64url')}.test-signature`;
}
function reply(status, data) {
  global.fetch.mockResolvedValueOnce(
    new Response(status === 204 ? null : JSON.stringify(data), { status }),
  );
}
function post(path, body = {}, aal = 'aal1') {
  return request(app)
    .post(`/api/auth/mfa/${path}`)
    .set('Cookie', `luvora_access=${token(aal)}`)
    .set('Origin', 'http://localhost:3000')
    .set('X-Luvora-Request', '1')
    .send(body);
}
function verifiedSession() {
  return { access_token: token('aal2'), refresh_token: 'secret-refresh', expires_in: 3600, user };
}
beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'public-test-key';
  process.env.APP_ORIGIN = 'http://localhost:3000';
  jest.spyOn(global, 'fetch').mockImplementation(() => {
    throw new Error('Unexpected provider request');
  });
  app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter());
  app.get('/protected', authenticate, (_req, res) => res.json({ allowed: true }));
  // eslint-disable-next-line no-unused-vars
  app.use((error, _req, res, _next) =>
    res.status(error.status || 500).json({ error: error.message }),
  );
});
afterEach(() => {
  jest.restoreAllMocks();
  process.env = { ...originalEnv };
});

test('password login requires MFA and defers profile writes', async () => {
  reply(200, {
    ...verifiedSession(),
    access_token: token(),
    user: { ...user, user_metadata: { date_of_birth: '2000-01-01' } },
  });
  const result = await request(app)
    .post('/api/auth/login')
    .set('X-Luvora-Request', '1')
    .send({ email: user.email, password: 'existing-password' });
  expect(result.status).toBe(200);
  expect(result.body.mfaRequired).toBe(true);
  expect(result.headers['set-cookie'][0]).toContain('HttpOnly');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test.each(['aal1', 'unknown'])(
  'blocks protected routes for an enrolled %s session',
  async (aal) => {
    reply(200, user);
    const result = await request(app)
      .get('/protected')
      .set('Cookie', `luvora_access=${token(aal)}`);
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('MFA_REQUIRED');
  },
);

test('accepts AAL2 only after Supabase validates the token and subject', async () => {
  reply(401, {});
  expect(
    (
      await request(app)
        .get('/protected')
        .set('Cookie', `luvora_access=${token('aal2')}`)
    ).status,
  ).toBe(401);
  reply(200, user);
  expect(
    (
      await request(app)
        .get('/protected')
        .set('Cookie', `luvora_access=${token('aal2', pendingId)}`)
    ).status,
  ).toBe(403);
  reply(200, user);
  expect(
    (
      await request(app)
        .get('/protected')
        .set('Cookie', `luvora_access=${token('aal2')}`)
    ).status,
  ).toBe(200);
});

test('unverified enrollment does not lock an account out', async () => {
  reply(200, { ...user, factors: [pending] });
  expect(
    (await request(app).get('/protected').set('Cookie', `luvora_access=${token()}`)).status,
  ).toBe(200);
});

test('security status exposes safe factor details, never secrets or tokens', async () => {
  reply(200, { ...user, factors: [{ ...factor, secret: 'private-secret' }] });
  const result = await request(app).get('/api/auth/mfa').set('Cookie', `luvora_access=${token()}`);
  expect(result.body).toEqual({
    enabled: true,
    aal: 'aal1',
    mfaRequired: true,
    factors: [{ id: factorId, name: factor.friendly_name, status: 'verified' }],
  });
  expect(result.headers['cache-control']).toBe('no-store');
});

test('enrolls TOTP with Supabase and returns a one-time setup QR and key', async () => {
  reply(200, { ...user, factors: [] });
  reply(200, { id: pendingId, totp: { qr_code: '<svg></svg>', secret: 'SETUPKEY' } });
  const result = await post('enroll');
  expect(result.status).toBe(201);
  expect(result.body).toEqual({ factorId: pendingId, qrCode: '<svg></svg>', secret: 'SETUPKEY' });
  expect(result.headers['cache-control']).toBe('no-store');
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({
    factor_type: 'totp',
    friendly_name: factor.friendly_name,
    issuer: 'Luvora',
  });
});

test('restart removes only this feature’s unfinished factor', async () => {
  reply(200, {
    ...user,
    factors: [pending, { ...pending, id: challengeId, friendly_name: 'Another app' }],
  });
  reply(200, { id: pendingId });
  reply(200, { id: factorId, totp: { qr_code: '<svg/>', secret: 'KEY' } });
  expect((await post('enroll')).status).toBe(201);
  expect(global.fetch.mock.calls[1][0]).toContain(`/factors/${pendingId}`);
  expect(global.fetch.mock.calls[1][1].method).toBe('DELETE');
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

test.each(['enroll', 'cancel', 'disable'])(
  'password-only sessions cannot %s an enabled factor',
  async (path) => {
    reply(200, user);
    const result = await post(path, { factorId, code: '123456' });
    expect(result.status).toBe(403);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  },
);

test('cannot verify a new pending factor to bypass an already enabled factor', async () => {
  reply(200, { ...user, factors: [factor, pending] });
  expect((await post('verify', { factorId: pendingId, code: '123456' })).status).toBe(403);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test.each(['12345', '1234567', 'abcdef', 123456, null])(
  'rejects malformed code %s',
  async (code) => {
    reply(200, user);
    expect((await post('verify', { factorId, code })).status).toBe(400);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  },
);

test('rejects factors belonging to another user', async () => {
  reply(200, user);
  expect((await post('verify', { factorId: pendingId, code: '123456' })).status).toBe(404);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('wrong or replayed codes do not upgrade the cookie', async () => {
  reply(200, user);
  reply(200, { id: challengeId });
  reply(422, { code: 'mfa_verification_failed' });
  const result = await post('verify', { factorId, code: '000001' });
  expect(result.status).toBe(400);
  expect(result.body.error).toContain('latest code');
  expect(result.headers['set-cookie']).toBeUndefined();
});

test('verification creates a challenge and replaces the cookie with the elevated session', async () => {
  reply(200, user);
  reply(200, { id: challengeId });
  reply(200, verifiedSession());
  const result = await post('verify', { factorId, code: '012345' });
  expect(result.status).toBe(200);
  expect(result.body.verified).toBe(true);
  expect(JSON.parse(global.fetch.mock.calls[2][1].body)).toEqual({
    challenge_id: challengeId,
    code: '012345',
  });
  expect(result.headers['set-cookie'][0]).toContain(token('aal2'));
  expect(JSON.stringify(result.body)).not.toMatch(/secret|token|012345/);
});

test('enrollment activation also requires successful code verification', async () => {
  reply(200, { ...user, factors: [pending] });
  reply(200, { id: challengeId });
  reply(200, verifiedSession());
  expect((await post('verify', { factorId: pendingId, code: '123456' })).body.verified).toBe(true);
});

test('does not accept a provider result without elevated assurance', async () => {
  reply(200, user);
  reply(200, { id: challengeId });
  reply(200, { ...verifiedSession(), access_token: token() });
  const result = await post('verify', { factorId, code: '123456' });
  expect(result.status).toBe(503);
  expect(result.headers['set-cookie']).toBeUndefined();
});

test('a verified factor cannot be deleted through cancel', async () => {
  reply(200, user);
  expect((await post('cancel', { factorId }, 'aal2')).status).toBe(409);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('cancels a pending enrollment', async () => {
  reply(200, { ...user, factors: [pending] });
  reply(200, { id: pendingId });
  expect((await post('cancel', { factorId: pendingId })).status).toBe(204);
  expect(global.fetch.mock.calls[1][1].method).toBe('DELETE');
});

test('removal requires a fresh code even with an elevated session', async () => {
  reply(200, user);
  reply(200, { id: challengeId });
  reply(400, {});
  const result = await post('disable', { factorId, code: '123456' }, 'aal2');
  expect(result.status).toBe(400);
  expect(global.fetch.mock.calls.some(([, options]) => options.method === 'DELETE')).toBe(false);
});

test('removes with the newly verified token and clears the browser session', async () => {
  reply(200, user);
  reply(200, { id: challengeId });
  reply(200, verifiedSession());
  reply(200, { id: factorId });
  const result = await post('disable', { factorId, code: '123456' }, 'aal2');
  expect(result.status).toBe(200);
  expect(global.fetch.mock.calls[3][1].method).toBe('DELETE');
  expect(global.fetch.mock.calls[3][1].headers.Authorization).toBe(`Bearer ${token('aal2')}`);
  expect(result.headers['set-cookie'][0]).toContain('Expires=Thu, 01 Jan 1970');
});

test('limits repeated code attempts per account', async () => {
  for (let i = 0; i < 10; i += 1) {
    reply(200, user);
    expect((await post('verify', { factorId, code: 'bad' })).status).toBe(400);
  }
  reply(200, user);
  const result = await post('verify', { factorId, code: '123456' });
  expect(result.status).toBe(429);
  expect(Number(result.headers['retry-after'])).toBeGreaterThan(0);
});

test('rejects cross-origin setup requests', async () => {
  const result = await request(app)
    .post('/api/auth/mfa/enroll')
    .set('Origin', 'https://other.example')
    .set('X-Luvora-Request', '1')
    .send({});
  expect(result.status).toBe(403);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('real social routes reject password-only MFA sessions before querying the database', async () => {
  const realApp = require('../../src/app');
  for (const path of ['/api/posts', '/api/discovery/profiles']) {
    reply(200, user);
    const result = await request(realApp).get(path).set('Cookie', `luvora_access=${token()}`);
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('MFA_REQUIRED');
  }
});
