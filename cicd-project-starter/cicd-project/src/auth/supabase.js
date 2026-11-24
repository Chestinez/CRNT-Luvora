const createError = require('http-errors');
const { validAdultDate } = require('./validation');

function configuration() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key)
    throw createError(503, 'Sign-in is not configured yet. Please contact the project team.', {
      expose: true,
    });
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw createError(503, 'Sign-in configuration needs attention.', { expose: true });
  }
  return { url: parsed.origin, key };
}

async function request(endpoint, { method = 'GET', body, token } = {}) {
  const { url, key } = configuration();
  let response;
  try {
    response = await fetch(`${url}${endpoint}`, {
      method,
      headers: {
        apikey: key,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
  } catch {
    throw createError(503, 'Cannot reach sign-in right now. Please try again.', { expose: true });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Never send raw provider errors, credentials or tokens to the browser or logs.
    const error = createError(
      response.status === 429 ? 429 : response.status >= 500 ? 503 : 400,
      response.status === 429
        ? 'Too many attempts. Please wait a few minutes and try again.'
        : response.status >= 500
          ? 'Sign-in is temporarily unavailable. Please try again.'
          : 'Unable to complete this request. Please check your details.',
      { expose: true },
    );
    error.providerCode = data.error_code || data.code;
    error.providerStatus = response.status;
    throw error;
  }
  return data;
}

async function saveSignupDate(user, token) {
  const date = user.user_metadata?.date_of_birth;
  if (!validAdultDate(date)) return;
  // The existing signup trigger creates the profile. Only fill an unset DOB;
  // never overwrite a teammate's profile edits or opt someone into discovery.
  await request(
    `/rest/v1/profiles?user_id=eq.${encodeURIComponent(user.id)}&date_of_birth=is.null`,
    {
      method: 'PATCH',
      token,
      body: { date_of_birth: date },
    },
  );
}

module.exports = { request, saveSignupDate };
