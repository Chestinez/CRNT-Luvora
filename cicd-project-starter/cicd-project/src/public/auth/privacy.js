(() => {
  const form = document.querySelector('#privacy-form');
  const fields = document.querySelector('#privacy-fields');
  const checkbox = document.querySelector('#discoverable');
  const reload = document.querySelector('#reload-privacy');
  const status = document.querySelector('#privacy-status');
  let onboardingComplete = false;
  async function privacy(save = false) {
    fields.disabled = reload.disabled = true;
    status.textContent = save ? 'Saving privacy settings…' : 'Loading privacy settings…';
    try {
      const response = await fetch('/api/auth/privacy', {
        method: save ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Luvora-Request': '1' },
        ...(save ? { body: JSON.stringify({ discoverable: checkbox.checked }) } : {}),
      });
      const data = await response.json();
      if (response.status === 401) return window.location.replace('/auth/login.html');
      if (data.code === 'MFA_REQUIRED') return window.location.replace('/auth/security.html');
      if (!response.ok) throw new Error(data.error || 'Could not update privacy settings.');
      if (!save) onboardingComplete = data.onboardingComplete;
      checkbox.checked = data.discoverable;
      checkbox.disabled = !onboardingComplete && !data.discoverable;
      document.querySelector('#onboarding-note').hidden = onboardingComplete;
      fields.disabled = false;
      status.textContent = save ? 'Privacy settings saved.' : '';
    } catch (error) {
      status.textContent = `${error.message} Reload privacy settings to try again.`;
    } finally {
      reload.disabled = false;
    }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    privacy(true);
  });
  reload.addEventListener('click', () => privacy());
  window.addEventListener('pageshow', () => privacy());
})();
