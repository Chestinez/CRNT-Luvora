(() => {
  const form = document.querySelector('#profile-form');
  const input = document.querySelector('#profile-name');
  const save = document.querySelector('#save-profile');
  const reload = document.querySelector('#reload-profile');
  const status = document.querySelector('#profile-status');
  async function profile(saveChanges = false) {
    input.disabled = save.disabled = reload.disabled = true;
    status.textContent = saveChanges ? 'Saving…' : 'Loading profile…';
    try {
      const response = await fetch('/api/auth/profile', {
        method: saveChanges ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Luvora-Request': '1' },
        ...(saveChanges ? { body: JSON.stringify({ displayName: input.value }) } : {}),
      });
      const data = await response.json();
      if (response.status === 401) return window.location.replace('/auth/login.html');
      if (data.code === 'MFA_REQUIRED') return window.location.replace('/auth/security.html');
      if (!response.ok) throw new Error(data.error || 'Could not load your profile.');
      input.value = data.displayName;
      input.disabled = save.disabled = false;
      status.textContent = saveChanges ? 'Profile name saved.' : '';
    } catch (error) {
      status.textContent = error.message || 'Could not reach Luvora. Please try again.';
      if (saveChanges) input.disabled = save.disabled = false;
    } finally {
      reload.disabled = false;
    }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    profile(true);
  });
  reload.addEventListener('click', () => profile());
  window.addEventListener('pageshow', () => profile());
})();
