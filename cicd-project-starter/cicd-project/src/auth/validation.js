function validAdultDate(value, today = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  const cutoff = new Date(
    Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate()),
  );
  // A leap-day birthday reaches 18 on March 1 in a non-leap year.
  if (cutoff.getUTCMonth() !== today.getUTCMonth()) cutoff.setUTCDate(0);
  return date <= cutoff && date.getUTCFullYear() >= 1900;
}

function validateCredentials(body = {}, signup = false) {
  const fields = {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = body.password;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fields.email = 'Enter a valid email address.';
  }
  if (typeof password !== 'string' || !password.length || password.length > 128) {
    fields.password = 'Enter your password (up to 128 characters).';
  }
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  if (signup) {
    if (!displayName || Array.from(displayName).length > 80) {
      fields.displayName = 'Enter a name between 1 and 80 characters.';
    }
    if (
      typeof password !== 'string' ||
      password.length < 12 ||
      password.length > 128 ||
      !/[a-z]/.test(password) ||
      !/[A-Z]/.test(password) ||
      !/[0-9]/.test(password) ||
      !/[^A-Za-z0-9\s]/.test(password)
    ) {
      fields.password = 'Use 12–128 characters with uppercase, lowercase, a number and a symbol.';
    }
    if (body.confirmPassword !== password) fields.confirmPassword = 'Your passwords do not match.';
    if (!validAdultDate(body.dateOfBirth))
      fields.dateOfBirth = 'Enter a valid date of birth. You must be 18 or older.';
  }
  return { fields, email, password, displayName, dateOfBirth: body.dateOfBirth };
}

module.exports = { validAdultDate, validateCredentials };
