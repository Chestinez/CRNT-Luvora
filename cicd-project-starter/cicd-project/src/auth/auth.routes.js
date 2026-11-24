const express = require('express');
const createError = require('http-errors');
const supabase = require('./supabase');
const { validateCredentials } = require('./validation');
const {
  identify,
  requireMfa,
  sameOrigin,
  readToken,
  setSession,
  clearSession,
} = require('./session');
const { assurance } = require('./assurance');
const createMfaRouter = require('./mfa.routes');

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.user_metadata?.display_name || 'Luvora member',
  };
}

function createAuthRouter() {
  const router = express.Router();
  const attempts = new Map();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(sameOrigin);
  router.use((req, _res, next) => {
    if (
      req.method === 'POST' &&
      (!req.is('application/json') || req.get('X-Luvora-Request') !== '1')
    ) {
      return next(createError(403, 'Please submit this request from the Luvora form.'));
    }
    next();
  });

  router.use('/mfa', createMfaRouter());

  function limitAttempts(req, res, next) {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.reset <= now) attempts.delete(key);
    const key = req.ip;
    const attempt = attempts.get(key) || { count: 0, reset: now + 15 * 60 * 1000 };
    if (attempt.count >= 20 || (!attempts.has(key) && attempts.size >= 10000)) {
      res.set('Retry-After', String(Math.ceil((attempt.reset - now) / 1000)));
      return next(createError(429, 'Too many attempts. Please wait 15 minutes and try again.'));
    }
    attempt.count += 1;
    attempts.set(key, attempt);
    next();
  }

  for (const action of ['signup', 'login']) {
    router.post(`/${action}`, limitAttempts, async (req, res) => {
      const signup = action === 'signup';
      const values = validateCredentials(req.body || {}, signup);
      if (Object.keys(values.fields).length) {
        return res
          .status(400)
          .json({ error: 'Please check the highlighted fields.', fields: values.fields });
      }
      const { email, password, displayName, dateOfBirth } = values;
      const redirect = process.env.APP_ORIGIN
        ? `?redirect_to=${encodeURIComponent(`${process.env.APP_ORIGIN}/auth/login.html`)}`
        : '';
      let result;
      try {
        result = await supabase.request(
          signup ? `/auth/v1/signup${redirect}` : '/auth/v1/token?grant_type=password',
          {
            method: 'POST',
            body: {
              email,
              password,
              ...(signup
                ? { data: { display_name: displayName, date_of_birth: dateOfBirth } }
                : {}),
            },
          },
        );
      } catch (error) {
        if (error.status !== 400) throw error;
        if (signup && ['user_already_exists', 'email_exists'].includes(error.providerCode)) {
          return res.status(202).json({ confirmationRequired: true });
        }
        throw createError(
          signup ? 400 : 401,
          signup
            ? 'Could not create your account. Check your details or try logging in if you already registered.'
            : 'Email or password is incorrect, or your email still needs confirmation.',
        );
      }
      if (signup && !result.access_token)
        return res.status(202).json({ confirmationRequired: true });
      if (!result.user?.id)
        throw createError(503, 'Could not start your session. Please try logging in.', {
          expose: true,
        });
      // A failed profile write does not lose an account that Auth already created.
      // Retry this idempotent update on the next login.
      let profilePending = false;
      const { mfaRequired } = assurance(result.user, result.access_token);
      if (!mfaRequired) {
        try {
          await supabase.saveSignupDate(result.user, result.access_token);
        } catch {
          profilePending = true;
        }
      }
      setSession(res, result);
      return res
        .status(signup ? 201 : 200)
        .json({ user: publicUser(result.user), profilePending, mfaRequired });
    });
  }

  router.get('/me', identify, (req, res) =>
    res.json({ user: publicUser(req.user), ...req.authState }),
  );
  router.get('/profile', identify, requireMfa, async (req, res) => {
    const rows = await supabase.request(
      `/rest/v1/profiles?user_id=eq.${encodeURIComponent(req.user.id)}&select=display_name`,
      { token: readToken(req) },
    );
    if (!rows[0]) throw createError(404, 'Your profile is not available yet.');
    res.json({ displayName: rows[0].display_name });
  });
  router.post('/profile', identify, requireMfa, async (req, res) => {
    const name = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
    if (
      !name ||
      Array.from(name).length > 80 ||
      Array.from(name).some(
        (character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
      )
    ) {
      return res
        .status(400)
        .json({ error: 'Enter a name between 1 and 80 characters without control characters.' });
    }
    const rows = await supabase.request(
      `/rest/v1/profiles?user_id=eq.${encodeURIComponent(req.user.id)}&select=display_name`,
      {
        method: 'PATCH',
        token: readToken(req),
        body: { display_name: name },
        representation: true,
      },
    );
    if (!rows[0]) throw createError(404, 'Your profile is not available yet.');
    res.json({ displayName: rows[0].display_name });
  });
  router.get('/privacy', identify, requireMfa, async (req, res) => {
    const rows = await supabase.request(
      `/rest/v1/profiles?user_id=eq.${encodeURIComponent(req.user.id)}&select=is_discoverable,onboarding_completed_at`,
      { token: readToken(req) },
    );
    if (!rows[0]) throw createError(404, 'Your profile is not available yet.');
    res.json({
      discoverable: rows[0].is_discoverable,
      onboardingComplete: Boolean(rows[0].onboarding_completed_at),
    });
  });
  router.post('/privacy', identify, requireMfa, async (req, res) => {
    if (typeof req.body?.discoverable !== 'boolean') {
      return res.status(400).json({ error: 'Choose whether to show your profile in Discovery.' });
    }
    const discoverable = req.body.discoverable;
    const rows = await supabase.request(
      `/rest/v1/profiles?user_id=eq.${encodeURIComponent(req.user.id)}&select=is_discoverable${discoverable ? '&onboarding_completed_at=not.is.null' : ''}`,
      {
        method: 'PATCH',
        token: readToken(req),
        body: { is_discoverable: discoverable },
        representation: true,
      },
    );
    if (!rows[0])
      return res.status(409).json({
        error:
          'Your profile is unavailable or onboarding is incomplete. Reload your privacy settings.',
      });
    res.json({ discoverable: rows[0].is_discoverable });
  });
  router.get('/preferences', identify, requireMfa, async (req, res) => {
    const rows = await supabase.request(
      `/rest/v1/user_preferences?user_id=eq.${encodeURIComponent(req.user.id)}&select=min_age,max_age,hard_age`,
      { token: readToken(req) },
    );
    if (!rows[0]) throw createError(404, 'Your preferences are not available yet.');
    res.json(rows[0]);
  });
  router.post('/preferences', identify, requireMfa, async (req, res) => {
    const { min_age, max_age, hard_age } = req.body || {};
    if (
      !Number.isInteger(min_age) ||
      !Number.isInteger(max_age) ||
      min_age < 18 ||
      max_age > 120 ||
      min_age > max_age ||
      typeof hard_age !== 'boolean'
    ) {
      return res.status(400).json({
        error:
          'Choose whole ages from 18 to 120, with minimum no greater than maximum, and a strict-filter option.',
      });
    }
    const rows = await supabase.request(
      `/rest/v1/user_preferences?user_id=eq.${encodeURIComponent(req.user.id)}&select=min_age,max_age,hard_age`,
      {
        method: 'PATCH',
        token: readToken(req),
        body: { min_age, max_age, hard_age },
        representation: true,
      },
    );
    if (!rows[0]) throw createError(404, 'Your preferences are not available yet.');
    res.json(rows[0]);
  });
  router.post('/logout', async (req, res) => {
    const token = readToken(req);
    // Clear the browser session even if the provider is temporarily unavailable.
    clearSession(res);
    if (token) {
      try {
        await supabase.request('/auth/v1/logout?scope=local', { method: 'POST', token });
      } catch (error) {
        if (![400, 401, 403].includes(error.status)) {
          return res.status(503).json({
            error: 'You are logged out on this browser. Server sign-out could not be confirmed.',
          });
        }
      }
    }
    res.status(204).end();
  });
  return router;
}

module.exports = createAuthRouter;
