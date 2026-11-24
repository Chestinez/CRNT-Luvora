const createError = require('http-errors');
const supabase = require('./supabase');
const { uuid } = require('../controllers/viewer');
const { assurance } = require('./assurance');
const cookieName = 'luvora_access';

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || process.env.APP_ORIGIN?.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
  };
}

function readToken(req) {
  const value = (req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));
  if (!value) return null;
  try {
    return decodeURIComponent(value.slice(cookieName.length + 1));
  } catch {
    return null;
  }
}

function setSession(res, session) {
  if (
    typeof session.access_token !== 'string' ||
    !Number.isFinite(session.expires_in) ||
    session.expires_in <= 0
  ) {
    throw createError(503, 'Could not start your session. Please log in again.', { expose: true });
  }
  // Bound this app's session to one hour. Refresh tokens are never stored.
  res.cookie(cookieName, session.access_token, {
    ...cookieOptions(),
    maxAge: Math.min(session.expires_in, 3600) * 1000,
  });
}

function clearSession(res) {
  res.clearCookie(cookieName, cookieOptions());
}

function sameOrigin(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const localOrigin = `${req.protocol}://${req.get('host')}`;
  const expected = uuid.test(req.user?.id || '')
    ? localOrigin
    : process.env.APP_ORIGIN || localOrigin;
  if (
    req.get('sec-fetch-site') === 'cross-site' ||
    (req.get('origin') && req.get('origin') !== expected)
  ) {
    return next(createError(403, 'Please submit this request from Luvora.'));
  }
  next();
}

async function identify(req, res, next) {
  const token = readToken(req);
  if (!token) return next(createError(401, 'Please log in to continue.'));
  try {
    // Verify with Supabase; never trust decoded JWT claims or a client-supplied user ID.
    const user = await supabase.request('/auth/v1/user', { token });
    if (!uuid.test(user.id || '')) throw createError(401, 'Please log in again.');
    req.user = user;
    req.authState = assurance(user, token);
    next();
  } catch (error) {
    if ([400, 401, 403].includes(error.status)) {
      clearSession(res);
      return next(createError(401, 'Your session has expired. Please log in again.'));
    }
    next(error);
  }
}

function requireMfa(req, res, next) {
  if (req.authState?.mfaRequired) {
    return res
      .status(403)
      .json({ code: 'MFA_REQUIRED', error: 'Enter your authenticator code to finish logging in.' });
  }
  next();
}

function authenticate(req, res, next) {
  // Preserve the existing loopback-only demo runner's trusted server identity.
  // MFA management always uses identify(), which requires a real Supabase cookie.
  if (uuid.test(req.user?.id || '') && !req.authState) return next();
  return identify(req, res, (error) => (error ? next(error) : requireMfa(req, res, next)));
}

module.exports = {
  authenticate,
  identify,
  requireMfa,
  sameOrigin,
  readToken,
  setSession,
  clearSession,
};
