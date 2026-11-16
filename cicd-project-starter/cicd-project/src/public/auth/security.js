const statusBox = document.querySelector('#security-status');
const content = document.querySelector('#security-content');
const form = document.querySelector('#mfa-form');
const code = document.querySelector('#code');
const factorSelect = document.querySelector('#factor');
let state;
let mode;
let pendingFactorId;
let busy = false;

function message(text, error = false, focus = false) {
  statusBox.textContent = text;
  statusBox.hidden = !text;
  statusBox.dataset.error = String(error);
  if (focus) statusBox.focus();
}

function setBusy(value) {
  busy = value;
  content.setAttribute('aria-busy', String(value));
  for (const element of document.querySelectorAll('button, input, select'))
    element.disabled = value;
}

function clearSecret() {
  document.querySelector('#qr-code').removeAttribute('src');
  document.querySelector('#setup-key').textContent = '';
  document.querySelector('#manual-setup').open = false;
  document.querySelector('#setup-panel').hidden = true;
  pendingFactorId = undefined;
  code.value = '';
}

async function api(path = '', body) {
  const response = await fetch(`/api/auth/${path}`, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json', 'X-Luvora-Request': '1' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45000),
  });
  const data = response.status === 204 ? {} : await response.json();
  if (response.status === 401) {
    clearSecret();
    window.location.replace('/auth/login.html');
    throw new Error('Your session expired. Please log in again.');
  }
  if (!response.ok) {
    if (data.code === 'MFA_REQUIRED') {
      clearSecret();
      content.hidden = true;
      document.querySelector('#retry').hidden = false;
    }
    throw new Error(data.error || 'Could not complete this request. Please try again.');
  }
  return data;
}

function chooseMode(nextMode) {
  mode = nextMode;
  form.hidden = false;
  code.value = '';
  code.setAttribute('aria-invalid', 'false');
  document.querySelector('#code-error').textContent = '';
  document.querySelector('#start-panel').hidden = true;
  document.querySelector('#enabled-panel').hidden = true;
  document.querySelector('#disable-warning').hidden = mode !== 'disable';
  document.querySelector('#cancel').hidden = mode === 'challenge';
  document.querySelector('#cancel').textContent =
    mode === 'setup' ? 'Cancel setup' : 'Keep authenticator';
  document.querySelector('#verify').textContent =
    mode === 'setup'
      ? 'Enable two-factor authentication'
      : mode === 'disable'
        ? 'Verify and remove authenticator'
        : 'Verify and log in';
  document.querySelector('#factor-choice').hidden =
    mode === 'setup' || factorSelect.options.length < 2;
}

function render() {
  clearSecret();
  const verified = state.factors.filter((factor) => factor.status === 'verified');
  factorSelect.replaceChildren(...verified.map((factor) => new Option(factor.name, factor.id)));
  content.hidden = false;
  form.hidden = true;
  document.querySelector('#start-panel').hidden = state.enabled;
  document.querySelector('#enabled-panel').hidden = !state.enabled || state.mfaRequired;
  document.querySelector('#back-account').hidden = state.mfaRequired;
  document.querySelector('#recovery-help').hidden = !state.mfaRequired;
  document.querySelector('#disable').hidden = !verified.length;
  document.querySelector('#security-title').textContent = state.mfaRequired
    ? 'One more step.'
    : 'Account security.';
  document.querySelector('#security-intro').textContent = state.mfaRequired
    ? 'Enter a code from your authenticator app to finish logging in.'
    : 'Keep your connections personal. Add another layer of protection to your account.';
  if (state.mfaRequired && verified.length) chooseMode('challenge');
  if (state.mfaRequired && !verified.length)
    message(
      'This account uses a different second factor. Contact the project team for help signing in.',
      true,
    );
}

async function load() {
  if (busy) return;
  setBusy(true);
  content.hidden = true;
  clearSecret();
  document.querySelector('#retry').hidden = true;
  message('Checking your security settings…');
  try {
    state = await api('mfa');
    message('');
    render();
  } catch (error) {
    message(error.message || 'Could not connect. Check your connection and reload.', true);
    document.querySelector('#retry').hidden = false;
  } finally {
    setBusy(false);
  }
}

async function action(run) {
  if (busy) return;
  setBusy(true);
  message('');
  try {
    await run();
  } catch (error) {
    message(error.message || 'Could not connect. Check your connection and try again.', true, true);
  } finally {
    setBusy(false);
  }
}

document.querySelector('#start').addEventListener('click', () =>
  action(async () => {
    const data = await api('mfa/enroll', {});
    pendingFactorId = data.factorId;
    // Render the provider's SVG only as an inert image, never as page HTML.
    document.querySelector('#qr-code').src = data.qrCode.startsWith('data:image/svg+xml')
      ? data.qrCode
      : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.qrCode)}`;
    document.querySelector('#setup-key').textContent = data.secret;
    document.querySelector('#setup-panel').hidden = false;
    chooseMode('setup');
    message('Scan the QR code, then enter the code from your app.', false, true);
  }),
);

document.querySelector('#disable').addEventListener('click', () => {
  if (busy) return;
  chooseMode('disable');
  code.focus();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (busy) return;
  if (!/^\d{6}$/.test(code.value)) {
    code.setAttribute('aria-invalid', 'true');
    document.querySelector('#code-error').textContent = 'Enter a six-digit code.';
    code.focus();
    return;
  }
  code.setAttribute('aria-invalid', 'false');
  document.querySelector('#code-error').textContent = '';
  action(async () => {
    const result = await api(mode === 'disable' ? 'mfa/disable' : 'mfa/verify', {
      factorId: mode === 'setup' ? pendingFactorId : factorSelect.value,
      code: code.value,
    });
    clearSecret();
    if (mode === 'disable') {
      content.hidden = true;
      message('Authenticator removed. Log in again to continue.', false, true);
      const link = document.createElement('a');
      link.href = '/auth/login.html';
      link.textContent = 'Go to login';
      link.className = 'primary-button';
      statusBox.after(link);
    } else {
      window.location.replace(
        `/auth/account.html${result.profilePending ? '?profile=pending' : ''}`,
      );
    }
  });
});

document.querySelector('#cancel').addEventListener('click', () =>
  action(async () => {
    if (mode === 'setup' && pendingFactorId) await api('mfa/cancel', { factorId: pendingFactorId });
    render();
    message(
      mode === 'setup'
        ? 'Setup cancelled. Two-factor authentication is still off.'
        : 'Your authenticator is still enabled.',
      false,
      true,
    );
  }),
);

document.querySelector('#signout').addEventListener('click', () =>
  action(async () => {
    await api('logout', {});
    clearSecret();
    window.location.replace('/auth/login.html');
  }),
);
document.querySelector('#retry').addEventListener('click', load);
window.addEventListener('pagehide', () => {
  clearSecret();
  content.hidden = true;
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) load();
});
load();
