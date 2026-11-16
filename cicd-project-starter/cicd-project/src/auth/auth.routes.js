const express = require('express');
const createError = require('http-errors');
const supabase = require('./supabase');
const { validateCredentials } = require('./validation');
const { identify, sameOrigin, readToken, setSession, clearSession } = require('./session');
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
