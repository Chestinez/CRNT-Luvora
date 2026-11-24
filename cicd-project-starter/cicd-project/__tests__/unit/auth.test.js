const express = require('express');
const request = require('supertest');
const createAuthRouter = require('../../src/auth/auth.routes');
const { authenticate, sameOrigin } = require('../../src/auth/session');
const { validAdultDate } = require('../../src/auth/validation');

const user = {
  id: '7a0aa9ed-aafa-4f06-9ed0-97e65c70bc0a',
  email: 'alex@example.com',
  user_metadata: { display_name: 'Alex', date_of_birth: '2000-06-15' },
};
const signup = {
  displayName: ' Alex ',
  email: ' Alex@Example.com ',
  dateOfBirth: '2000-06-15',
  password: 'A-long-password9!',
  confirmPassword: 'A-long-password9!',
};
const session = {
  user,
  access_token: 'verified-access-token',
  refresh_token: 'never-return-this',
  expires_in: 3600,
};
const originalEnv = { ...process.env };
let app;

function reply(status, data) {
  global.fetch.mockResolvedValueOnce(
    new Response(status === 204 ? null : JSON.stringify(data), { status }),
  );
}

function post(path, body = signup) {
  return request(app)
    .post(`/api/auth/${path}`)
    .set('X-Luvora-Request', '1')
    .set('Origin', 'http://localhost:3000')
    .send(body);
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-public-key';
  process.env.APP_ORIGIN = 'http://localhost:3000';
  jest.spyOn(global, 'fetch').mockImplementation(() => {
    throw new Error('Unexpected provider request');
  });
  app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter());
  app.get('/protected', authenticate, (req, res) => res.json({ id: req.user.id }));
  app.post('/social', sameOrigin, authenticate, (req, res) => res.json({ id: req.user.id }));
  app.post(
    '/demo',
    (req, _res, next) => {
      req.user = { id: user.id };
      next();
    },
    sameOrigin,
    authenticate,
    (req, res) => res.json({ id: req.user.id }),
  );
  // eslint-disable-next-line no-unused-vars
  app.use((error, _req, res, _next) =>
    res.status(error.status || 500).json({ error: error.message }),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
  process.env = { ...originalEnv };
});

test('creates through Auth with normalized email and metadata; waits for confirmation', async () => {
  reply(200, { id: user.id, identities: [] });
  const result = await post('signup');
  expect(result.status).toBe(202);
  expect(result.body.confirmationRequired).toBe(true);
  expect(result.headers['set-cookie']).toBeUndefined();
  const [url, options] = global.fetch.mock.calls[0];
  expect(url).toContain('/auth/v1/signup?redirect_to=');
  expect(JSON.parse(options.body)).toEqual({
    email: user.email,
    password: signup.password,
    data: { display_name: 'Alex', date_of_birth: '2000-06-15' },
  });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test.each([
  ['email', 'invalid'],
  ['displayName', '   '],
  ['displayName', 'a'.repeat(81)],
  ['password', 'short'],
  ['confirmPassword', 'different'],
  ['dateOfBirth', '2020-01-01'],
  ['dateOfBirth', '2000-02-30'],
  ['dateOfBirth', '1899-01-01'],
  ['password', { bad: true }],
])('rejects invalid %s before contacting Supabase', async (field, value) => {
  const result = await post('signup', { ...signup, [field]: value });
  expect(result.status).toBe(400);
  expect(result.body.fields[field]).toBeDefined();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('allows exactly 18, rejects tomorrow’s birthday and impossible dates', () => {
  const today = new Date('2026-11-16T12:00:00Z');
  expect(validAdultDate('2008-11-16', today)).toBe(true);
  expect(validAdultDate('2008-11-17', today)).toBe(false);
  expect(validAdultDate('2007-02-29', today)).toBe(false);
  expect(validAdultDate('2008-02-29', new Date('2026-02-28T12:00:00Z'))).toBe(false);
  expect(validAdultDate('2008-02-29', new Date('2026-03-01T00:00:00Z'))).toBe(true);
});

test('logs in with a secure HttpOnly cookie and only fills an unset DOB under RLS', async () => {
  process.env.NODE_ENV = 'production';
  reply(200, session);
  reply(204);
  const result = await post('login', { email: signup.email, password: signup.password });
  expect(result.status).toBe(200);
  expect(result.body.user.id).toBe(user.id);
  expect(JSON.stringify(result.body)).not.toMatch(/token|password/);
  expect(result.headers['set-cookie'][0]).toMatch(/HttpOnly/);
  expect(result.headers['set-cookie'][0]).toMatch(/Secure/);
  expect(result.headers['set-cookie'][0]).toMatch(/SameSite=Lax/);
  expect(result.headers['cache-control']).toBe('no-store');
  const [url, options] = global.fetch.mock.calls[1];
  expect(url).toContain(`profiles?user_id=eq.${user.id}&date_of_birth=is.null`);
  expect(options.method).toBe('PATCH');
  expect(options.headers.Authorization).toBe('Bearer verified-access-token');
  expect(JSON.parse(options.body)).toEqual({ date_of_birth: '2000-06-15' });
});

test('immediate signup establishes a session when email confirmation is disabled', async () => {
  reply(200, session);
  reply(204);
  expect((await post('signup')).status).toBe(201);
});

test('profile failure does not pretend account creation failed', async () => {
  reply(200, session);
  reply(500, { message: 'private database detail' });
  const result = await post('signup');
  expect(result.status).toBe(201);
  expect(result.body.profilePending).toBe(true);
  expect(result.headers['set-cookie']).toBeDefined();
});

test('existing members can log in with older password policies', async () => {
  reply(200, { ...session, user: { ...user, user_metadata: {} } });
  const result = await post('login', { email: user.email, password: 'oldpass' });
  expect(result.status).toBe(200);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('wrong credentials and unconfirmed email use a generic message', async () => {
  reply(400, { error_code: 'invalid_credentials', message: 'provider-secret' });
  const result = await post('login');
  expect(result.status).toBe(401);
  expect(result.body.error).toContain('Email or password is incorrect');
  expect(JSON.stringify(result.body)).not.toContain('provider-secret');
});

test('duplicate signup has the same confirmation response', async () => {
  reply(422, { code: 'user_already_exists' });
  expect((await post('signup')).body).toEqual({ confirmationRequired: true });
});

test('missing configuration returns a safe, actionable error', async () => {
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_ANON_KEY;
  const result = await post('login');
  expect(result.status).toBe(503);
  expect(result.body.error).toContain('not configured');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('network failures are sanitized and do not set a cookie', async () => {
  global.fetch.mockRejectedValueOnce(new Error('private host detail'));
  const result = await post('login');
  expect(result.status).toBe(503);
  expect(result.body.error).not.toContain('private');
  expect(result.headers['set-cookie']).toBeUndefined();
});

test('rejects cross-origin and simple form requests before provider access', async () => {
  expect(
    (
      await request(app)
        .post('/api/auth/login')
        .set('Origin', 'https://other.example')
        .set('X-Luvora-Request', '1')
        .send(signup)
    ).status,
  ).toBe(403);
  expect((await request(app).post('/api/auth/login').type('form').send(signup)).status).toBe(403);
  expect((await request(app).post('/api/auth/login').send(signup)).status).toBe(403);
  expect(
    (await request(app).post('/social').set('Origin', 'https://other.example').send({})).status,
  ).toBe(403);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('rate limits repeated attempts before provider access', async () => {
  for (let i = 0; i < 20; i += 1) await post('login', {});
  const result = await post('login', {});
  expect(result.status).toBe(429);
  expect(Number(result.headers['retry-after'])).toBeGreaterThan(0);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('Supabase rate limits are retained without exposing provider errors', async () => {
  reply(429, { message: 'private detail' });
  expect((await post('signup')).status).toBe(429);
});

test('verifies cookie with Supabase and ignores client-supplied identity', async () => {
  reply(200, user);
  const result = await request(app)
    .get('/protected')
    .set('Cookie', 'luvora_access=verified-access-token')
    .set('X-User-Id', 'attacker');
  expect(result.body.id).toBe(user.id);
  expect(global.fetch.mock.calls[0][0]).toContain('/auth/v1/user');
});

test('rejects missing or expired sessions and clears an invalid cookie', async () => {
  expect((await request(app).get('/protected').set('X-User-Id', user.id)).status).toBe(401);
  reply(401, {});
  const result = await request(app).get('/api/auth/me').set('Cookie', 'luvora_access=expired');
  expect(result.status).toBe(401);
  expect(result.headers['set-cookie'][0]).toContain('Expires=Thu, 01 Jan 1970');
});

test('preserves an identity supplied by the existing trusted demo runner', async () => {
  const result = await request(app).post('/demo').send({});
  expect(result.status).toBe(200);
  expect(result.body.id).toBe(user.id);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('logout clears the cookie and revokes the provider session', async () => {
  reply(204);
  const result = await post('logout', {}).set('Cookie', 'luvora_access=verified-access-token');
  expect(result.status).toBe(204);
  expect(result.headers['set-cookie'][0]).toContain('Expires=Thu, 01 Jan 1970');
  expect(global.fetch.mock.calls[0][0]).toContain('/auth/v1/logout?scope=local');
});

test('logout clears the local cookie even if Supabase is unavailable', async () => {
  reply(503, {});
  const result = await post('logout', {}).set('Cookie', 'luvora_access=verified-access-token');
  expect(result.status).toBe(503);
  expect(result.headers['set-cookie'][0]).toContain('Expires=Thu, 01 Jan 1970');
});

test('app serves the new pages and protects the existing social endpoints', async () => {
  const realApp = require('../../src/app');
  expect((await request(realApp).get('/signup')).headers.location).toBe('/auth/signup.html');
  expect((await request(realApp).get('/auth/signup.html')).text).toContain('Create my account');
  expect((await request(realApp).get('/auth/login.html')).status).toBe(200);
  expect((await request(realApp).get('/api/discovery/profiles')).status).toBe(401);
  expect((await request(realApp).get('/api/posts')).status).toBe(401);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('profile updates only the verified user and trims the name', async () => {
  reply(200, user);
  reply(200, [{ display_name: 'New name' }]);
  const result = await post('profile', { displayName: ' New name ', user_id: 'someone-else' }).set(
    'Cookie',
    'luvora_access=verified-access-token',
  );
  expect(result.status).toBe(200);
  expect(result.body.displayName).toBe('New name');
  const [url, options] = global.fetch.mock.calls[1];
  expect(url).toContain(user.id);
  expect(JSON.parse(options.body)).toEqual({ display_name: 'New name' });
});

test('profile rejects blank names without writing', async () => {
  reply(200, user);
  const result = await post('profile', { displayName: ' ' }).set(
    'Cookie',
    'luvora_access=verified-access-token',
  );
  expect(result.status).toBe(400);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('profile requires a session', async () => {
  expect((await post('profile', { displayName: 'Name' })).status).toBe(401);
  expect(global.fetch).not.toHaveBeenCalled();
});
