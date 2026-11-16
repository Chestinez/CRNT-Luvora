const page = document.body.dataset.page;
const form = document.querySelector('#auth-form');
const statusBox = document.querySelector('#form-status');

function showStatus(message, error = false, focus = false) {
  statusBox.textContent = message;
  statusBox.hidden = !message;
  statusBox.dataset.error = String(error);
  if (focus) statusBox.focus();
}

function fieldError(name, message) {
  const input = document.getElementById(name);
  if (!input) return;
  document.getElementById(`${name}-error`).textContent = message || '';
  input.setAttribute('aria-invalid', String(Boolean(message)));
}

function passwordRules(value) {
  return {
    length: value.length >= 12 && value.length <= 128,
    case: /[a-z]/.test(value) && /[A-Z]/.test(value),
    number: /[0-9]/.test(value),
    symbol: /[^A-Za-z0-9\s]/.test(value),
  };
}

function adultCutoff() {
  const now = new Date();
  const cutoff = new Date(Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate()));
  if (cutoff.getUTCMonth() !== now.getUTCMonth()) cutoff.setUTCDate(0);
  return cutoff.toISOString().slice(0, 10);
}

function validate(name) {
  const input = document.getElementById(name);
  const value = input.value;
  let error = '';
  if (name === 'displayName' && (!value.trim() || Array.from(value.trim()).length > 80)) {
    error = 'Enter a name between 1 and 80 characters.';
  } else if (
    name === 'email' &&
    (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) || value.trim().length > 254)
  ) {
    error = 'Enter a valid email address.';
  } else if (name === 'dateOfBirth' && (!value || !input.validity.valid || value > adultCutoff())) {
    error = 'Enter a valid date of birth. You must be 18 or older.';
  } else if (name === 'password') {
    if (!value || value.length > 128) error = 'Enter your password (up to 128 characters).';
    else if (page === 'signup' && !Object.values(passwordRules(value)).every(Boolean))
      error = 'Your password needs to meet all four requirements above.';
  } else if (
    name === 'confirmPassword' &&
    (!value || value !== document.getElementById('password').value)
  ) {
    error = 'Your passwords do not match.';
  }
  fieldError(name, error);
  return !error;
}

async function api(path, body) {
  const response = await fetch(`/api/auth/${path}`, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json', 'X-Luvora-Request': '1' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000),
  });
  const data = response.status === 204 ? {} : await response.json();
  return { response, data };
}

for (const button of document.querySelectorAll('[data-reveal]')) {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.reveal);
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    button.textContent = reveal ? 'Hide' : 'Show';
    button.setAttribute('aria-pressed', String(reveal));
    const label = button.dataset.reveal === 'password' ? 'password' : 'confirm password';
    button.setAttribute('aria-label', `${reveal ? 'Hide' : 'Show'} ${label}`);
  });
}

if (form) {
  const fields = [...form.querySelectorAll('input')];
  const date = document.querySelector('#dateOfBirth');
  if (date) date.max = adultCutoff();
  for (const input of fields) {
    input.addEventListener('blur', () => validate(input.id));
    input.addEventListener('input', () => {
      if (input.getAttribute('aria-invalid') === 'true') validate(input.id);
      if (input.id === 'password' && page === 'signup') {
        const rules = passwordRules(input.value);
        for (const item of document.querySelectorAll('[data-rule]'))
          item.dataset.met = String(rules[item.dataset.rule]);
        if (document.getElementById('confirmPassword').value) validate('confirmPassword');
      }
    });
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fieldset = document.querySelector('#form-fields');
    if (fieldset.disabled) return;
    const invalid = fields.filter((input) => !validate(input.id));
    if (invalid.length) {
      showStatus('Please check the highlighted fields.', true);
      invalid[0].focus();
      return;
    }
    const values = Object.fromEntries(new FormData(form));
    const submit = form.querySelector('[type="submit"]');
    const originalLabel = submit.innerHTML;
    fieldset.disabled = true;
    form.setAttribute('aria-busy', 'true');
    submit.textContent = page === 'signup' ? 'Creating your account…' : 'Logging in…';
    showStatus('');
    try {
      const { response, data } = await api(page, values);
      if (!response.ok) {
        for (const [name, message] of Object.entries(data.fields || {})) fieldError(name, message);
        showStatus(
          data.error || 'We couldn’t complete your request. Please try again.',
          true,
          true,
        );
        return;
      }
      if (data.confirmationRequired) {
        form.reset();
        form.hidden = true;
        document.querySelector('#confirmation').hidden = false;
        showStatus('One more step: confirm your email, then log in.', false, true);
      } else {
        form.reset();
        if (data.mfaRequired) {
          window.location.assign('/auth/security.html');
          return;
        }
        window.location.assign(
          `/auth/account.html${data.profilePending ? '?profile=pending' : ''}`,
        );
      }
    } catch {
      showStatus(
        page === 'signup'
          ? 'We couldn’t confirm the result. Check your connection and inbox. If you received a confirmation email, follow it and log in.'
          : 'Could not reach Luvora. Check your connection and try again.',
        true,
        true,
      );
    } finally {
      fieldset.disabled = false;
      form.setAttribute('aria-busy', 'false');
      submit.innerHTML = originalLabel;
    }
  });
}

// Supabase's email link confirms the address before redirecting here. Discard
// URL tokens immediately; this app starts its HttpOnly session through login.
function handleConfirmation() {
  if (page !== 'login' || !window.location.hash) return;
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  const failed = parameters.has('error') || parameters.has('error_code');
  window.history.replaceState(null, '', window.location.pathname);
  showStatus(
    failed
      ? 'This confirmation link is invalid or has expired. Try signing up again to request a new link.'
      : 'Email confirmation received. Log in to continue.',
    failed,
  );
}
handleConfirmation();
window.addEventListener('hashchange', handleConfirmation);

async function loadAccount() {
  document.querySelector('#account-details').hidden = true;
  try {
    const { response, data } = await api('me');
    if (response.status === 401) {
      window.location.replace('/auth/login.html');
      return;
    }
    if (!response.ok) {
      showStatus(data.error || 'Could not load your account. Please reload to try again.', true);
      return;
    }
    if (data.mfaRequired) {
      window.location.replace('/auth/security.html');
      return;
    }
    document.querySelector('#account-greeting').textContent = `Welcome, ${data.user.displayName}.`;
    document.querySelector('#account-email').textContent = data.user.email;
    document.querySelector('#account-details').hidden = false;
    document.querySelector('#security-state').textContent = data.enabled
      ? 'Two-factor authentication is on'
      : 'Add two-factor authentication';
    showStatus(
      new URLSearchParams(window.location.search).get('profile') === 'pending'
        ? 'You’re signed in, but your date of birth could not be saved. Log in again later to retry.'
        : '',
    );
  } catch {
    showStatus('Could not load your account. Check your connection and reload to try again.', true);
  }
}

if (page === 'account') {
  loadAccount();
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) loadAccount();
  });
  document.querySelector('#logout').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { response, data } = await api('logout', {});
      if (!response.ok) {
        showStatus(data.error || 'Could not log out. Please try again.', true, true);
        // The API clears the local cookie even when provider logout fails.
        if (response.status === 503) document.querySelector('#account-details').hidden = true;
        return;
      }
      window.location.replace('/auth/login.html');
    } catch {
      showStatus('Could not reach Luvora. Please try logging out again.', true, true);
    } finally {
      button.disabled = false;
    }
  });
}
