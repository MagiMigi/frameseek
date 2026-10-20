// Shared settings store, used by the content scripts and the popup.
// Loaded as a classic script, so it exposes a single global: ReelSeekSettings.
(() => {
  'use strict';

  // Firefox exposes a promise-based `browser`; Chrome's MV3 `chrome` also returns promises.
  const api = globalThis.browser ?? globalThis.chrome;
  const area = api.storage.sync ?? api.storage.local;

  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const SKIP_CHOICES = [1, 2, 3, 4, 5, 10, 15];

  const DEFAULTS = Object.freeze({
    enabled: true,
    keyboard: true,
    skipSeconds: 5,
    showSpeed: true,
    rememberSpeed: true,
    speed: 1,
  });

  function sanitize(raw) {
    const s = { ...DEFAULTS };
    if (!raw || typeof raw !== 'object') return s;
    for (const key of ['enabled', 'keyboard', 'showSpeed', 'rememberSpeed']) {
      if (typeof raw[key] === 'boolean') s[key] = raw[key];
    }
    if (SKIP_CHOICES.includes(raw.skipSeconds)) s.skipSeconds = raw.skipSeconds;
    if (SPEEDS.includes(raw.speed)) s.speed = raw.speed;
    return s;
  }

  async function getSettings() {
    try {
      return sanitize(await area.get(Object.keys(DEFAULTS)));
    } catch {
      return { ...DEFAULTS };
    }
  }

  async function setSettings(patch) {
    await area.set(patch);
  }

  // Calls cb(settings) whenever any of our keys change (e.g. from the popup).
  function onSettingsChanged(cb) {
    const listener = async (changes, areaName) => {
      if (area === api.storage.sync && areaName !== 'sync') return;
      if (area === api.storage.local && areaName !== 'local') return;
      if (!Object.keys(changes).some((k) => k in DEFAULTS)) return;
      cb(await getSettings());
    };
    api.storage.onChanged.addListener(listener);
    return () => api.storage.onChanged.removeListener(listener);
  }

  globalThis.ReelSeekSettings = Object.freeze({
    DEFAULTS,
    SPEEDS,
    SKIP_CHOICES,
    getSettings,
    setSettings,
    onSettingsChanged,
  });
})();
