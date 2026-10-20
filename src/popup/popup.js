(() => {
  'use strict';

  const { getSettings, setSettings, onSettingsChanged } = globalThis.ReelSeekSettings;
  const api = globalThis.browser ?? globalThis.chrome;

  const TOGGLES = ['enabled', 'keyboard', 'showSpeed', 'rememberSpeed'];
  const $ = (id) => document.getElementById(id);

  function render(s) {
    for (const key of TOGGLES) $(key).checked = s[key];
    $('skipSeconds').value = String(s.skipSeconds);
    $('skipLabel').textContent = String(s.skipSeconds);
    $('options').disabled = !s.enabled;
  }

  for (const key of TOGGLES) {
    $(key).addEventListener('change', (e) => setSettings({ [key]: e.target.checked }));
  }
  $('skipSeconds').addEventListener('change', (e) => setSettings({ skipSeconds: Number(e.target.value) }));

  $('version').textContent = `v${api.runtime.getManifest().version}`;
  getSettings().then(render);
  onSettingsChanged(render);
})();
