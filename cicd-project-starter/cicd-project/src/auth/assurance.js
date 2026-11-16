// Call only with a token returned by Supabase or accepted by /auth/v1/user.
// Decoding alone is NOT signature verification.
function assurance(user, verifiedToken) {
  let aal = 'aal1';
  try {
    const claims = JSON.parse(Buffer.from(verifiedToken.split('.')[1], 'base64url').toString());
    if (claims.sub === user.id && claims.aal === 'aal2') aal = 'aal2';
  } catch {
    // Missing or malformed assurance claims never grant MFA access.
  }
  const enabled = (user.factors || []).some((factor) => factor.status === 'verified');
  return { enabled, aal, mfaRequired: enabled && aal !== 'aal2' };
}

module.exports = { assurance };
