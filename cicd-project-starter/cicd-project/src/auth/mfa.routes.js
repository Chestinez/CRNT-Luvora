const express = require('express');
const createError = require('http-errors');
const supabase = require('./supabase');
const { uuid } = require('../controllers/viewer');
const { identify, requireMfa, readToken, setSession, clearSession } = require('./session');
const { assurance } = require('./assurance');
const factorName = 'Luvora authenticator';

function findFactor(req) {
  const id = req.body?.factorId;
  if (typeof id !== 'string' || !uuid.test(id))
    throw createError(400, 'Select a valid authenticator.');
  const factor = (req.user.factors || []).find(
    (item) => item.id === id && item.factor_type === 'totp',
  );
  if (!factor)
    throw createError(404, 'This authenticator is no longer available. Reload and try again.');
  return factor;
}

async function verifyCode(req, factor) {
  const code = req.body?.code;
  if (typeof code !== 'string' || !/^\d{6}$/.test(code))
    throw createError(400, 'Enter the six-digit code from your authenticator app.');
  const token = readToken(req);
  try {
    const challenge = await supabase.request(`/auth/v1/factors/${factor.id}/challenge`, {
      method: 'POST',
      token,
      body: {},
    });
    if (!uuid.test(challenge.id || ''))
      throw createError(503, 'Could not start verification. Please try again.', { expose: true });
    const session = await supabase.request(`/auth/v1/factors/${factor.id}/verify`, {
      method: 'POST',
      token,
      body: { challenge_id: challenge.id, code },
    });
    if (
      session.user?.id !== req.user.id ||
      assurance(req.user, session.access_token).aal !== 'aal2'
    ) {
      throw createError(503, 'Could not verify your session. Please log in again.', {
        expose: true,
      });
    }
    return session;
  } catch (error) {
    if (error.status === 400)
      throw createError(
        400,
        'That code could not be verified. Use the latest code and check your phone’s time is automatic.',
      );
    throw error;
  }
}

function createMfaRouter() {
  const router = express.Router();
  const attempts = new Map();
  router.use(identify);
  router.use((req, res, next) => {
    if (req.method === 'GET') return next();
    // Per user, so opening new password sessions cannot reset the code limit.
    const now = Date.now();
    for (const [id, item] of attempts) if (item.reset <= now) attempts.delete(id);
    const item = attempts.get(req.user.id) || { count: 0, reset: now + 10 * 60 * 1000 };
    if (item.count >= 10 || (!attempts.has(req.user.id) && attempts.size >= 10000)) {
      res.set('Retry-After', String(Math.ceil((item.reset - now) / 1000)));
      return next(
        createError(429, 'Too many security attempts. Wait 10 minutes before trying again.'),
      );
    }
    item.count += 1;
    attempts.set(req.user.id, item);
    next();
  });

  router.get('/', (req, res) => {
    res.json({
      ...req.authState,
      factors: (req.user.factors || [])
        .filter((factor) => factor.factor_type === 'totp')
        .map((factor) => ({
          id: factor.id,
          name: factor.friendly_name || 'Authenticator app',
          status: factor.status,
        })),
    });
  });

  router.post('/enroll', requireMfa, async (req, res) => {
    if (req.authState.enabled)
      throw createError(409, 'Two-factor authentication is already enabled.');
    const token = readToken(req);
    // Restart only this feature's unfinished enrollments (a reload loses the QR).
    for (const factor of req.user.factors || []) {
      if (
        factor.factor_type === 'totp' &&
        factor.status === 'unverified' &&
        factor.friendly_name === factorName
      ) {
        await supabase.request(`/auth/v1/factors/${factor.id}`, { method: 'DELETE', token });
      }
    }
    const result = await supabase.request('/auth/v1/factors', {
      method: 'POST',
      token,
      body: { factor_type: 'totp', friendly_name: factorName, issuer: 'Luvora' },
    });
    if (!uuid.test(result.id || '') || !result.totp?.qr_code || !result.totp?.secret) {
      throw createError(503, 'Could not start setup. Reload and try again.', { expose: true });
    }
    // Secret is sent once to the setup screen. Never log it or persist it locally.
    res
      .status(201)
      .json({ factorId: result.id, qrCode: result.totp.qr_code, secret: result.totp.secret });
  });

  router.post('/verify', async (req, res) => {
    const factor = findFactor(req);
    // A password-only session cannot attach a new factor to bypass an existing one.
    if (req.authState.mfaRequired && factor.status !== 'verified') {
      throw createError(403, 'Use your already enabled authenticator to finish logging in.');
    }
    const session = await verifyCode(req, factor);
    let profilePending = false;
    try {
      await supabase.saveSignupDate(session.user, session.access_token);
    } catch {
      profilePending = true;
    }
    setSession(res, session);
    res.json({ verified: true, profilePending });
  });

  router.post('/cancel', requireMfa, async (req, res) => {
    const factor = findFactor(req);
    if (factor.status !== 'unverified')
      throw createError(409, 'An enabled authenticator cannot be cancelled.');
    await supabase.request(`/auth/v1/factors/${factor.id}`, {
      method: 'DELETE',
      token: readToken(req),
    });
    res.status(204).end();
  });

  router.post('/disable', requireMfa, async (req, res) => {
    const factor = findFactor(req);
    if (factor.status !== 'verified') throw createError(409, 'This authenticator is not enabled.');
    const session = await verifyCode(req, factor);
    await supabase.request(`/auth/v1/factors/${factor.id}`, {
      method: 'DELETE',
      token: session.access_token,
    });
    // End the local elevated session after a security setting changes.
    clearSession(res);
    res.json({ disabled: true });
  });
  return router;
}

module.exports = createMfaRouter;
