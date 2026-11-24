(() => {
  const key = 'luvora-color-theme';
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
    } catch {
      apply('rose');
    }
  }
  restore();
  document.addEventListener('DOMContentLoaded', () => {
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
    if (event.key === key || event.key === null) restore();
  });
  window.addEventListener('pageshow', restore);
})();
