(() => {
  const key = 'luvora-color-theme';
  const modeKey = 'luvora-display-mode';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let mode = 'dark';
  function applyMode(value) {
    mode = ['light', 'dark', 'system'].includes(value) ? value : 'dark';
    document.documentElement.dataset.mode =
      mode === 'system' ? (system.matches ? 'dark' : 'light') : mode;
    const select = document.querySelector('#display-mode');
    if (select) select.value = mode;
  }
  const themes = ['rose', 'ocean', 'forest', 'lavender'];
  function apply(value) {
    const theme = themes.includes(value) ? value : 'rose';
    document.documentElement.dataset.theme = theme;
    const select = document.querySelector('#color-theme');
    if (select) select.value = theme;
  }
  function restore() {
    try {
      apply(localStorage.getItem(key));
      applyMode(localStorage.getItem(modeKey));
    } catch {
      apply('rose');
      applyMode('dark');
    }
  }
  restore();
  document.addEventListener('DOMContentLoaded', () => {
    const modeSelect = document.querySelector('#display-mode');
    if (modeSelect) {
      modeSelect.value = mode;
      modeSelect.addEventListener('change', () => {
        applyMode(modeSelect.value);
        const status = document.querySelector('#mode-status');
        try {
          localStorage.setItem(modeKey, mode);
          status.textContent = 'Display mode saved for this browser.';
        } catch {
          status.textContent =
            'Mode applied to this page. Browser storage is unavailable, so it could not be saved.';
        }
      });
    }
    const select = document.querySelector('#color-theme');
    if (!select) return;
    select.value = document.documentElement.dataset.theme;
    select.addEventListener('change', () => {
      apply(select.value);
      const status = document.querySelector('#theme-status');
      try {
        localStorage.setItem(key, select.value);
        status.textContent = 'Website color saved for this browser.';
      } catch {
        status.textContent =
          'Color applied to this page. Browser storage is unavailable, so it could not be saved.';
      }
    });
  });
  window.addEventListener('storage', (event) => {
    if (event.key === key || event.key === modeKey || event.key === null) restore();
  });
  system.addEventListener('change', () => {
    if (mode === 'system') applyMode(mode);
  });
  window.addEventListener('pageshow', restore);
})();
