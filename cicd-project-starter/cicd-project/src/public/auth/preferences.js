(() => {
  const form = document.querySelector('#preferences-form');
  const fields = document.querySelector('#preferences-fields');
  const minimum = document.querySelector('#min-age');
  const maximum = document.querySelector('#max-age');
  const strict = document.querySelector('#hard-age');
  const reload = document.querySelector('#reload-preferences');
  const status = document.querySelector('#preferences-status');
  async function preferences(save = false) {
    if (save && minimum.valueAsNumber > maximum.valueAsNumber) {
      status.textContent = 'Minimum age must not exceed maximum age.';
      minimum.focus();
      return;
    }
    fields.disabled = reload.disabled = true;
    status.textContent = save ? 'Saving…' : 'Loading preferences…';
    try {
      const response = await fetch('/api/auth/preferences', {
        method: save ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Luvora-Request': '1' },
        ...(save
          ? {
              body: JSON.stringify({
                min_age: minimum.valueAsNumber,
                max_age: maximum.valueAsNumber,
                hard_age: strict.checked,
              }),
            }
          : {}),
      });
      const data = await response.json();
      if (response.status === 401) return window.location.replace('/auth/login.html');
      if (data.code === 'MFA_REQUIRED') return window.location.replace('/auth/security.html');
      if (!response.ok) throw new Error(data.error || 'Could not save preferences.');
      minimum.value = data.min_age;
      maximum.value = data.max_age;
      strict.checked = data.hard_age;
      fields.disabled = false;
      status.textContent = save
        ? 'Preferences saved. Reopen or refresh For You to see the updated results.'
        : '';
    } catch (error) {
      status.textContent = `${error.message} Reload preferences to try again.`;
    } finally {
      reload.disabled = false;
    }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    preferences(true);
  });
  reload.addEventListener('click', () => preferences());
  window.addEventListener('pageshow', () => preferences());
})();
