// Minimal stand-in for the extension APIs the content scripts use, so they can run on a
// plain web page (test/harness.html). Backed by localStorage.
(() => {
  'use strict';

  const KEY = 'reelseek-shim-storage';
  const listeners = new Set();

  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) ?? {};
    } catch {
      return {};
    }
  };

  const sync = {
    async get(keys) {
      const all = read();
      if (keys == null) return all;
      const out = {};
      for (const k of [].concat(keys)) if (k in all) out[k] = all[k];
      return out;
    },
    async set(patch) {
      const all = read();
      const changes = {};
      for (const [k, v] of Object.entries(patch)) {
        changes[k] = { oldValue: all[k], newValue: v };
        all[k] = v;
      }
      localStorage.setItem(KEY, JSON.stringify(all));
      for (const fn of listeners) fn(changes, 'sync');
    },
    async clear() {
      localStorage.removeItem(KEY);
    },
  };

  globalThis.chrome = {
    storage: {
      sync,
      onChanged: {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
      },
    },
    runtime: { getManifest: () => ({ version: 'dev' }) },
  };
})();
