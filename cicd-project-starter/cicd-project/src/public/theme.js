(() => {
  const key = 'luvora-color-theme';
  const densityKey = 'luvora-layout-density';
  function applyDensity(value) {
    const density = value === 'compact' ? 'compact' : 'comfortable';
    document.documentElement.dataset.density = density;
    const select = document.querySelector('#layout-density');
    if (select) select.value = density;
  }
  const contrastKey = 'luvora-high-contrast';
  function applyContrast(value) {
    const contrast = value === 'high' ? 'high' : 'standard';
    document.documentElement.dataset.contrast = contrast;
    const select = document.querySelector('#contrast-preference');
    if (select) select.value = contrast;
  }
  const motionKey = 'luvora-motion-preference';
  const motionSystem = window.matchMedia('(prefers-reduced-motion: reduce)');
  let motion = 'system';
  function applyMotion(value) {
    motion = value === 'reduce' ? 'reduce' : 'system';
    document.documentElement.dataset.motion =
      motion === 'reduce' || motionSystem.matches ? 'reduce' : 'normal';
    const select = document.querySelector('#motion-preference');
    if (select) select.value = motion;
  }
  const sizeKey = 'luvora-text-size';
  function applySize(value) {
    const size = ['default', 'large', 'extra-large'].includes(value) ? value : 'default';
    document.documentElement.dataset.textSize = size;
    const select = document.querySelector('#text-size');
    if (select) select.value = size;
  }
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
  function applyDefaults() {
    apply('rose');
    applyMode('dark');
    applySize('default');
    applyMotion('system');
    applyContrast('standard');
    applyDensity('comfortable');
  }
  function restore() {
    try {
      apply(localStorage.getItem(key));
      applyMode(localStorage.getItem(modeKey));
      applySize(localStorage.getItem(sizeKey));
      applyMotion(localStorage.getItem(motionKey));
      applyContrast(localStorage.getItem(contrastKey));
      applyDensity(localStorage.getItem(densityKey));
    } catch {
      applyDefaults();
    }
  }
  restore();
  document.addEventListener('DOMContentLoaded', () => {
    const reset = document.querySelector('#reset-appearance');
    if (reset) {
      const section = reset.closest('section');
      const status = document.querySelector('#reset-status');
      section.addEventListener('change', () => {
        status.textContent = '';
      });
      reset.addEventListener('click', () => {
        let saved = true;
        for (const preferenceKey of [key, modeKey, sizeKey, motionKey, contrastKey, densityKey]) {
          try {
            localStorage.removeItem(preferenceKey);
          } catch {
            saved = false;
          }
        }
        applyDefaults();
        for (const message of section.querySelectorAll('[role="status"]')) message.textContent = '';
        status.textContent = saved
          ? 'Appearance reset to defaults for this browser.'
          : 'Default appearance applied to this page. Browser storage is unavailable, so some saved preferences could not be reset.';
      });
    }
    const densitySelect = document.querySelector('#layout-density');
    if (densitySelect) {
      densitySelect.value = document.documentElement.dataset.density;
      densitySelect.addEventListener('change', () => {
        applyDensity(densitySelect.value);
        const status = document.querySelector('#density-status');
        try {
          localStorage.setItem(densityKey, densitySelect.value);
          status.textContent = 'Layout saved for this browser.';
        } catch {
          status.textContent =
            'Layout applied to this page. Browser storage is unavailable, so it could not be saved.';
        }
      });
    }
    const contrastSelect = document.querySelector('#contrast-preference');
    if (contrastSelect) {
      contrastSelect.value = document.documentElement.dataset.contrast;
      contrastSelect.addEventListener('change', () => {
        applyContrast(contrastSelect.value);
        const status = document.querySelector('#contrast-status');
        try {
          localStorage.setItem(contrastKey, contrastSelect.value);
          status.textContent = 'Contrast preference saved for this browser.';
        } catch {
          status.textContent =
            'Contrast applied to this page. Browser storage is unavailable, so it could not be saved.';
        }
      });
    }
    const motionSelect = document.querySelector('#motion-preference');
    if (motionSelect) {
      motionSelect.value = motion;
      motionSelect.addEventListener('change', () => {
        applyMotion(motionSelect.value);
        const status = document.querySelector('#motion-status');
        try {
          localStorage.setItem(motionKey, motion);
          status.textContent = 'Motion preference saved for this browser.';
        } catch {
          status.textContent =
            'Motion preference applied to this page. Browser storage is unavailable, so it could not be saved.';
        }
      });
    }
    const sizeSelect = document.querySelector('#text-size');
    if (sizeSelect) {
      sizeSelect.value = document.documentElement.dataset.textSize;
      sizeSelect.addEventListener('change', () => {
        applySize(sizeSelect.value);
        const status = document.querySelector('#size-status');
        try {
          localStorage.setItem(sizeKey, sizeSelect.value);
          status.textContent = 'Text size saved for this browser.';
        } catch {
          status.textContent =
            'Text size applied to this page. Browser storage is unavailable, so it could not be saved.';
        }
      });
    }
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
    if (
      event.key === key ||
      event.key === modeKey ||
      event.key === sizeKey ||
      event.key === motionKey ||
      event.key === contrastKey ||
      event.key === densityKey ||
      event.key === null
    )
      restore();
  });
  system.addEventListener('change', () => {
    if (mode === 'system') applyMode(mode);
  });
  motionSystem.addEventListener('change', () => applyMotion(motion));
  window.addEventListener('pageshow', restore);
})();
