// Entry point on instagram.com: finds <video> elements, gives each a SeekBar, and
// handles the keyboard shortcuts. Instagram is a single-page app with randomized class
// names, so we rely only on <video> elements and layout, never on class names.
(() => {
  'use strict';

  const { getSettings, setSettings, onSettingsChanged, DEFAULTS } = globalThis.FrameSeekSettings;
  const { SeekBar } = globalThis.FrameSeek;

  const MIN_WIDTH = 200; // skip hover previews and thumbnails
  const MIN_HEIGHT = 150;
  const RESCAN_MS = 1500; // safety net for videos that grow without a DOM mutation
  const SCAN_THROTTLE_MS = 100; // Instagram mutates the DOM constantly; scan at most this often
  const LONG_SKIP = 10;
  // The stories viewer shows the previous/next stories as smaller cards beside the main
  // one; only videos at least this share of the largest video's area get a bar there.
  const STORY_MAIN_SHARE = 0.5;

  const bars = new Map(); // HTMLVideoElement -> SeekBar
  let settings = { ...DEFAULTS };
  let scanQueued = false;

  const isStoriesPage = () => location.pathname.startsWith('/stories/');

  // A timer rather than requestAnimationFrame, so scans still run while the page isn't
  // being drawn (e.g. the window is covered).
  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    setTimeout(scan, SCAN_THROTTLE_MS);
  }

  function scan() {
    scanQueued = false;
    for (const [video, bar] of bars) {
      if (!video.isConnected) {
        bar.destroy();
        bars.delete(video);
      }
    }
    if (!settings.enabled) {
      destroyAll();
      return;
    }
    const story = isStoriesPage();
    const videos = [...document.querySelectorAll('video')].map((video) => {
      const r = video.getBoundingClientRect();
      return { video, area: r.width * r.height, big: r.width >= MIN_WIDTH && r.height >= MIN_HEIGHT };
    });
    const minArea = story ? Math.max(0, ...videos.map((v) => v.area)) * STORY_MAIN_SHARE : 0;
    for (const { video, area, big } of videos) {
      const bar = bars.get(video);
      const wanted = big && area >= minArea;
      if (bar && story && !wanted) {
        // A story that moved from the middle into a side preview.
        bar.destroy();
        bars.delete(video);
      } else if (bar) {
        bar.ensureMounted();
      } else if (wanted) {
        bars.set(video, new SeekBar(video, settings, { onSpeedChange, story }));
      }
    }
  }

  function destroyAll(options) {
    for (const bar of bars.values()) bar.destroy(options);
    bars.clear();
  }

  function onSpeedChange(source, rate) {
    if (!settings.rememberSpeed) return;
    settings = { ...settings, speed: rate };
    for (const bar of bars.values()) if (bar !== source) bar.setSpeed(rate);
    setSettings({ speed: rate }).catch(() => {});
  }

  // The video the shortcuts act on: on a stories page the story, then one being stepped
  // frame by frame, else the playing one with the most area on screen, else the most
  // visible paused one (if at least a third of it is showing). The stories viewer covers
  // the feed, so a feed video behind it must not win.
  function activeBar() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const story = isStoriesPage();
    let best = null;
    let bestScore = 0;
    for (const bar of bars.values()) {
      if (!bar.duration) continue;
      const r = bar.video.getBoundingClientRect();
      const w = Math.min(r.right, vw) - Math.max(r.left, 0);
      const h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      if (w <= 0 || h <= 0) continue;
      const area = w * h;
      const playing = !bar.video.paused;
      if (!playing && area < (r.width * r.height) / 3) continue;
      const score =
        area + (playing ? vw * vh : 0) + (bar.stepping ? 2 * vw * vh : 0) + (story && bar.story ? 4 * vw * vh : 0);
      if (score > bestScore) {
        best = bar;
        bestScore = score;
      }
    }
    return best;
  }

  function isTypingTarget(e) {
    const el = e.composedPath()[0];
    if (!(el instanceof Element)) return false;
    return el.isContentEditable || el.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  }

  function shortcutFor(e) {
    switch (e.key) {
      case 'ArrowLeft': return (bar) => bar.seekBy(-settings.skipSeconds);
      case 'ArrowRight': return (bar) => bar.seekBy(settings.skipSeconds);
      case 'j': case 'J': return (bar) => bar.seekBy(-LONG_SKIP);
      case 'l': case 'L': return (bar) => bar.seekBy(LONG_SKIP);
      case ',': return (bar) => bar.stepFrame(-1);
      case '.': return (bar) => bar.stepFrame(1);
      case '<': return (bar) => (bar.stepSpeed(-1), true);
      case '>': return (bar) => (bar.stepSpeed(1), true);
      default: return null;
    }
  }

  function onKeyDown(e) {
    if (!settings.enabled || !settings.keyboard) return;
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || isTypingTarget(e)) return;
    const action = shortcutFor(e);
    if (!action) return;
    if ((e.key === '<' || e.key === '>') && !settings.showSpeed) return;
    // In stories, ← / → are Instagram's previous / next story; J / L still skip.
    if (isStoriesPage() && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
    const bar = activeBar();
    if (!bar || !action(bar)) return;
    // Only swallow keys we actually used, so Instagram keeps its own arrow-key navigation
    // whenever there's no video to act on.
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function applySettings(next) {
    const wasEnabled = settings.enabled;
    settings = next;
    if (!settings.enabled) {
      destroyAll({ resetSpeed: wasEnabled });
      return;
    }
    for (const bar of bars.values()) bar.updateSettings(settings);
    queueScan();
  }

  async function start() {
    settings = await getSettings();
    onSettingsChanged(applySettings);
    new MutationObserver(queueScan).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(queueScan, RESCAN_MS);
    window.addEventListener('resize', queueScan, { passive: true });
    window.addEventListener('keydown', onKeyDown, true);
    queueScan();
  }

  start();
})();
