// Seek bar controller: one instance per <video>. The UI lives in a Shadow DOM so
// Instagram's CSS can't reach it and ours can't leak out.
// Loaded as a classic content script; exposes globalThis.FrameSeek.SeekBar.
(() => {
  'use strict';

  const { SPEEDS } = globalThis.FrameSeekSettings;
  const CLICK_SPEEDS = [0.5, 1, 1.25, 1.5, 2];
  const ZONE_PX = 72; // bottom strip of the video that reveals the time/speed controls
  const ZONE_MARGIN = 16; // how far the strip reaches above the pills when they're lifted
  const END_MARGIN = 0.1; // never seek exactly onto the end, it would loop or stop the video
  const SIZE_TOLERANCE = 4;
  const SEEK_SETTLE_MS = 250;
  const FLASH_MS = 650;
  const TOUCH_ZONE_MS = 3000;
  const DEFAULT_FRAME = 1 / 30; // most Reels are 30fps; measured per video when possible
  const COMMON_FPS = [24, 25, 30, 48, 50, 60];
  const FRAME_SAMPLES = 30;
  const MIN_REPEAT = 0.3; // shortest section that can be looped, in seconds
  const REPEAT_TITLES = {
    off: 'Loop a section: set the start ([)',
    start: 'Loop: set the end (])',
    on: 'Stop looping (\\)',
  };

  // Instagram's own buttons near the bottom of a video (tagged people, mute, caption
  // links) that our controls must not cover.
  const OBSTACLE_SELECTOR =
    'button, a[href], [role="button"], [role="link"], [role="slider"], svg, input, textarea, [contenteditable="true"]';
  const OBSTACLE_MAX_HEIGHT = 120; // taller ones are overlays covering the video, not buttons
  const OBSTACLE_GAP = 6;
  const OVERLAP_TOLERANCE = 4; // touching edges are fine, e.g. pills tucked under a caption row
  const MIN_HIT_STRIP = 10; // bottom strip of the click area that stays seekable everywhere

  // Events from our controls must not reach Instagram, or a click on the bar would also
  // pause, mute or "double-tap like" the video.
  const SWALLOWED_EVENTS = [
    'click', 'dblclick', 'auxclick', 'contextmenu',
    'mousedown', 'mouseup', 'pointerdown', 'pointerup',
    'touchstart', 'touchend',
  ];

  const CSS = `
    :host { all: initial; }
    [hidden] { display: none !important; }

    .root {
      --accent: #ff3d5a;
      --loop: #ffc94a;
      position: absolute;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
      color: #fff;
      font: 500 12px/1 system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      user-select: none;
      -webkit-user-select: none;
      -webkit-tap-highlight-color: transparent;
    }
    .root.no-duration > :not(.flash) { display: none; }

    .hit {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 16px;
      pointer-events: auto;
      cursor: pointer;
      touch-action: none;
    }
    .track {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 3px;
      background: rgba(255, 255, 255, 0.25);
      transition: height 0.12s ease, bottom 0.12s ease, left 0.12s ease, right 0.12s ease;
    }
    .root.zone .track,
    .root.hover-bar .track,
    .root.dragging .track {
      left: 10px;
      right: 10px;
      bottom: 6px;
      height: 4px;
    }
    .root.hover-bar .track,
    .root.dragging .track { height: 6px; }

    .fill {
      position: absolute;
      inset: 0;
      transform: scaleX(0);
      transform-origin: left center;
    }
    .buffered { background: rgba(255, 255, 255, 0.35); }
    .hover { background: rgba(255, 255, 255, 0.5); opacity: 0; }
    .root.hover-bar .hover { opacity: 1; }
    .root.dragging .hover { opacity: 0; }
    .played { background: var(--accent); }

    .knob {
      position: absolute;
      top: 50%;
      left: 0;
      width: 13px;
      height: 13px;
      margin: -6.5px 0 0 -6.5px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 3px rgba(0, 0, 0, 0.4);
      transform: scale(0);
      transition: transform 0.12s ease;
    }
    .root.hover-bar .knob,
    .root.dragging .knob { transform: scale(1); }

    .tip {
      position: absolute;
      left: 0;
      bottom: 52px;
      padding: 5px 7px;
      border-radius: 4px;
      background: rgba(20, 20, 20, 0.85);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      transform: translateX(-50%);
      opacity: 0;
      transition: opacity 0.1s ease;
    }
    .root.hover-bar .tip,
    .root.dragging .tip { opacity: 1; }

    .controls {
      position: absolute;
      left: 10px;
      bottom: 22px;
      display: flex;
      gap: 6px;
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    .root.zone .controls,
    .root.hover-bar .controls,
    .root.dragging .controls { opacity: 1; }
    .controls > * { pointer-events: none; }
    .root.zone .controls > *,
    .root.hover-bar .controls > * { pointer-events: auto; }

    .pill {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      height: 22px;
      margin: 0;
      padding: 0 8px;
      border: 0;
      border-radius: 11px;
      background: rgba(20, 20, 20, 0.65);
      color: #fff;
      font: inherit;
      font-variant-numeric: tabular-nums;
    }
    .speed,
    .repeat { cursor: pointer; }
    .speed:hover,
    .repeat:hover { background: rgba(20, 20, 20, 0.85); }
    .speed:focus-visible,
    .repeat:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .repeat[data-state="start"] .a { color: var(--loop); }
    .repeat[data-state="on"],
    .repeat[data-state="on"]:hover { background: var(--loop); color: #111; }

    /* The looped section: a bracket over the track from its start to its end. */
    .repeat-range {
      position: absolute;
      top: -4px;
      bottom: 0;
      display: none;
      box-sizing: border-box;
      border: 2px solid var(--loop);
      border-bottom: 0;
      background: rgba(255, 201, 74, 0.18);
      filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.6));
    }
    .repeat-range.start,
    .repeat-range.on { display: block; }
    .repeat-range.start { width: 0; border-top: 0; border-right: 0; background: none; }

    /* Grips on the loop's edges, for dragging its start and end. They sit above the seek
       area so they win where the two overlap, and only take clicks while the controls show. */
    .repeat-handle {
      position: absolute;
      bottom: -2px;
      z-index: 2;
      display: none;
      width: 16px;
      height: 24px;
      margin-left: -8px;
      cursor: ew-resize;
      touch-action: none;
      pointer-events: none;
    }
    .repeat-handle::before {
      content: "";
      position: absolute;
      left: 5px;
      top: 0;
      width: 6px;
      height: 12px;
      border-radius: 3px;
      background: var(--loop);
      box-shadow: 0 0 2px rgba(0, 0, 0, 0.6);
      opacity: 0;
      transition: opacity 0.12s ease;
    }
    .repeat-handle.show { display: block; }
    .root.zone .repeat-handle,
    .root.hover-bar .repeat-handle,
    .root.dragging .repeat-handle { pointer-events: auto; }
    .root.zone .repeat-handle::before,
    .root.hover-bar .repeat-handle::before,
    .root.dragging .repeat-handle::before { opacity: 1; }

    .flash {
      position: absolute;
      left: 50%;
      top: 50%;
      padding: 10px 18px;
      border-radius: 999px;
      background: rgba(20, 20, 20, 0.7);
      font-size: 18px;
      font-weight: 600;
      white-space: nowrap;
      transform: translate(-50%, -50%) scale(0.92);
      opacity: 0;
      transition: opacity 0.18s ease, transform 0.18s ease;
    }
    .flash.show { opacity: 1; transform: translate(-50%, -50%) scale(1); }

    @media (pointer: coarse) {
      .hit { height: 28px; }
      .controls { bottom: 34px; }
      .tip { bottom: 64px; }
    }
  `;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function h(tag, className, attrs = {}) {
    const el = document.createElement(tag);
    el.className = className;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  function formatTime(sec) {
    const s = Math.floor(Number.isFinite(sec) && sec > 0 ? sec : 0);
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
  }

  const formatRate = (rate) => `${Number(rate.toFixed(2))}×`;

  // 29.97 → 30, 23.976 → 24 and so on; anything unusual is kept as measured.
  function snapFrame(gap) {
    const fps = 1 / gap;
    const near = COMMON_FPS.find((f) => Math.abs(f - fps) / f < 0.04);
    return 1 / (near ?? fps);
  }

  // Instagram stacks transparent click-catching overlays as siblings of the video's
  // wrapper. Mounting at the highest ancestor with the same box as the video puts our bar
  // above them. Prefer an already-positioned ancestor so we never change Instagram's layout.
  function findMount(video) {
    const vr = video.getBoundingClientRect();
    const sameBox = (r) =>
      Math.abs(r.left - vr.left) <= SIZE_TOLERANCE &&
      Math.abs(r.top - vr.top) <= SIZE_TOLERANCE &&
      Math.abs(r.width - vr.width) <= SIZE_TOLERANCE &&
      Math.abs(r.height - vr.height) <= SIZE_TOLERANCE;

    const chain = [];
    for (let el = video.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (!sameBox(el.getBoundingClientRect())) break;
      chain.push(el);
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      if (getComputedStyle(chain[i]).position !== 'static') return { el: chain[i], needsPosition: false };
    }
    const el = chain[chain.length - 1] ?? video.parentElement;
    return el ? { el, needsPosition: getComputedStyle(el).position === 'static' } : null;
  }

  class SeekBar {
    // options: { onSpeedChange(bar, rate), story: true for a video in the stories viewer }
    constructor(video, settings, options = {}) {
      this.video = video;
      this.options = options;
      this.story = Boolean(options.story);
      this.resumeAfterDrag = false;
      this.settings = settings;
      this.mountEl = null;
      this.restorePosition = null;
      this.visible = true;
      this.dragging = false;
      this.dragTime = 0;
      this.pendingSeek = null;
      this.lastSeekAt = 0;
      this.frame = 0;
      this.seekFrame = 0;
      this.flashTimer = 0;
      this.zoneTimer = 0;
      this.zoneHeight = ZONE_PX; // grows when the pills have to sit higher up
      this.desiredRate = null;
      this.rateFixes = 0;
      this.lastText = '';
      this.destroyed = false;
      this.stepping = false; // paused by frame stepping; shortcuts keep targeting this video
      this.repeat = null; // looped section: { start, end }, end is null until it's set
      this.handleDrag = null; // 'start' or 'end' while one of the loop's edges is dragged
      this.lastRepeatTime = null;
      this.lastRepeatKey = '';
      this.frameDuration = DEFAULT_FRAME;
      this.frameSamples = [];
      this.lastMediaTime = null;
      this.frameHandle = 0;

      this.build();
      this.mount();
      this.listen();
      this.updateSettings(settings);
      this.render();
      this.renderSpeed();
      this.startLoop();
    }

    // ---- setup ---------------------------------------------------------------

    build() {
      this.host = document.createElement('div');
      this.host.setAttribute('data-frameseek', '');
      this.host.style.cssText =
        'all: initial !important; position: absolute !important; inset: 0 !important; display: block !important;' +
        'z-index: 2147483000 !important; pointer-events: none !important;';

      const shadow = this.host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = CSS;

      this.root = h('div', 'root no-duration');
      this.flashEl = h('div', 'flash', { 'aria-hidden': 'true' });
      this.controls = h('div', 'controls');
      this.timeEl = h('span', 'pill time');
      this.speedBtn = h('button', 'pill speed', { type: 'button', title: 'Playback speed', 'aria-label': 'Playback speed' });
      this.repeatBtn = h('button', 'pill repeat', {
        type: 'button',
        'data-state': 'off',
        title: REPEAT_TITLES.off,
        'aria-label': REPEAT_TITLES.off,
      });
      for (const [cls, text] of [['a', 'A'], ['dash', '-'], ['b', 'B']]) {
        const part = h('span', cls);
        part.textContent = text;
        this.repeatBtn.append(part);
      }
      this.repeatBtn.hidden = this.story;
      this.controls.append(this.timeEl, this.speedBtn, this.repeatBtn);

      this.tip = h('div', 'tip', { 'aria-hidden': 'true' });
      this.hit = h('div', 'hit', { role: 'slider', 'aria-label': 'Seek', 'aria-valuemin': '0' });
      this.track = h('div', 'track');
      this.buffered = h('div', 'fill buffered');
      this.hoverFill = h('div', 'fill hover');
      this.played = h('div', 'fill played');
      this.repeatRange = h('div', 'repeat-range');
      this.startHandle = h('div', 'repeat-handle', { role: 'slider', 'aria-label': 'Loop start' });
      this.endHandle = h('div', 'repeat-handle', { role: 'slider', 'aria-label': 'Loop end' });
      this.knob = h('div', 'knob');
      this.track.append(this.buffered, this.hoverFill, this.played, this.repeatRange, this.knob, this.startHandle, this.endHandle);

      // The visible track and the click area are separate, so the click area can be
      // narrowed around Instagram's buttons while the track still spans the full width.
      this.root.append(this.flashEl, this.controls, this.tip, this.track, this.hit);
      shadow.append(style, this.root);
    }

    mount() {
      const found = findMount(this.video);
      if (!found) return;
      const { el, needsPosition } = found;
      if (needsPosition) {
        this.restorePosition = el.style.position;
        el.style.position = 'relative';
      }
      el.appendChild(this.host);
      el.addEventListener('pointermove', this.onZoneMove, { passive: true });
      el.addEventListener('pointerdown', this.onZoneDown, { passive: true, capture: true });
      el.addEventListener('pointerleave', this.onZoneLeave, { passive: true });
      this.mountEl = el;
    }

    unmount() {
      const el = this.mountEl;
      if (el) {
        el.removeEventListener('pointermove', this.onZoneMove);
        el.removeEventListener('pointerdown', this.onZoneDown, { capture: true });
        el.removeEventListener('pointerleave', this.onZoneLeave);
        if (this.restorePosition !== null) el.style.position = this.restorePosition;
      }
      this.restorePosition = null;
      this.mountEl = null;
      this.host.remove();
    }

    // Instagram re-renders a lot; put the bar back if our host got detached or moved away.
    ensureMounted() {
      if (this.mountEl && this.host.parentNode === this.mountEl && this.mountEl.contains(this.video)) return;
      this.unmount();
      this.mount();
    }

    listen() {
      const v = this.video;
      this.videoListeners = [
        ['play', this.onPlay],
        ['playing', this.onPlay],
        ['loadedmetadata', this.onPlay],
        ['pause', this.onRender],
        ['ended', this.onEnded],
        ['timeupdate', this.onRender],
        ['durationchange', this.onRender],
        ['progress', this.onRender],
        ['emptied', this.onEmptied],
        ['seeked', this.onSeeked],
        ['ratechange', this.onRateChange],
      ];
      for (const [type, fn] of this.videoListeners) v.addEventListener(type, fn);
      this.probeFrames();

      this.io = new IntersectionObserver((entries) => {
        this.visible = entries[entries.length - 1].isIntersecting;
        if (this.visible) this.startLoop();
      });
      this.io.observe(v);

      this.hit.addEventListener('pointerdown', this.onHitDown);
      this.hit.addEventListener('pointermove', this.onHitMove);
      this.hit.addEventListener('pointerup', this.onHitUp);
      this.hit.addEventListener('pointercancel', this.onHitCancel);
      this.hit.addEventListener('pointerenter', this.onHitEnter);
      this.hit.addEventListener('pointerleave', this.onHitLeave);

      this.speedBtn.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus where it was
      this.speedBtn.addEventListener('click', () => this.cycleSpeed());
      this.repeatBtn.addEventListener('mousedown', (e) => e.preventDefault());
      this.repeatBtn.addEventListener('click', () => this.cycleRepeat());
      for (const handle of [this.startHandle, this.endHandle]) {
        handle.addEventListener('pointerdown', this.onHandleDown);
        handle.addEventListener('pointermove', this.onHandleMove);
        handle.addEventListener('pointerup', this.onHandleUp);
        handle.addEventListener('pointercancel', this.onHandleUp);
      }

      for (const type of SWALLOWED_EVENTS) {
        this.root.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
      }
    }

    updateSettings(settings) {
      this.settings = settings;
      this.speedBtn.hidden = !settings.showSpeed;
      if (settings.rememberSpeed && Math.abs(settings.speed - this.video.playbackRate) > 0.001) {
        this.setSpeed(settings.speed);
      }
    }

    destroy({ resetSpeed = false } = {}) {
      if (this.destroyed) return;
      this.destroyed = true;
      cancelAnimationFrame(this.frame);
      cancelAnimationFrame(this.seekFrame);
      clearTimeout(this.flashTimer);
      clearTimeout(this.zoneTimer);
      this.stopFrameProbe();
      this.io.disconnect();
      for (const [type, fn] of this.videoListeners) this.video.removeEventListener(type, fn);
      if (resetSpeed && this.desiredRate !== null) {
        this.video.defaultPlaybackRate = 1;
        this.video.playbackRate = 1;
      }
      this.unmount();
    }

    // ---- rendering -----------------------------------------------------------

    get duration() {
      const d = this.video.duration;
      return Number.isFinite(d) && d > 0 ? d : 0;
    }

    get maxTime() {
      return Math.max(0, this.duration - END_MARGIN);
    }

    shouldLoop() {
      return !this.destroyed && (this.dragging || (this.visible && !this.video.paused));
    }

    startLoop() {
      if (!this.frame && this.shouldLoop()) this.frame = requestAnimationFrame(this.tick);
    }

    tick = () => {
      this.frame = 0;
      this.render();
      this.startLoop();
    };

    render() {
      this.checkRepeat();
      const dur = this.duration;
      this.root.classList.toggle('no-duration', !dur);
      if (!dur) return;

      const repeatKey = this.repeat ? `${this.repeat.start}|${this.repeat.end}|${dur}` : `off|${dur}`;
      if (repeatKey !== this.lastRepeatKey) {
        this.lastRepeatKey = repeatKey;
        this.renderRepeat(dur);
      }

      const cur = this.dragging ? this.dragTime : this.pendingSeek ?? this.video.currentTime;
      const p = clamp(cur / dur, 0, 1);
      this.played.style.transform = `scaleX(${p})`;
      this.knob.style.left = `${p * 100}%`;
      this.buffered.style.transform = `scaleX(${clamp(this.bufferedEnd(cur) / dur, 0, 1)})`;

      const text = `${formatTime(cur)} / ${formatTime(dur)}`;
      if (text !== this.lastText) {
        this.lastText = text;
        this.timeEl.textContent = text;
        this.hit.setAttribute('aria-valuemax', String(Math.round(dur)));
        this.hit.setAttribute('aria-valuenow', String(Math.round(cur)));
        this.hit.setAttribute('aria-valuetext', text);
      }
    }

    bufferedEnd(t) {
      const b = this.video.buffered;
      for (let i = 0; i < b.length; i++) {
        if (b.start(i) <= t + 0.5 && b.end(i) >= t) return b.end(i);
      }
      return 0;
    }

    renderSpeed() {
      this.speedBtn.textContent = formatRate(this.video.playbackRate || 1);
    }

    flash(text) {
      this.flashEl.textContent = text;
      this.flashEl.classList.add('show');
      clearTimeout(this.flashTimer);
      this.flashTimer = setTimeout(() => this.flashEl.classList.remove('show'), FLASH_MS);
    }

    showTip(clientX) {
      const dur = this.duration;
      if (!dur) return;
      const tr = this.track.getBoundingClientRect();
      const rr = this.root.getBoundingClientRect();
      const p = clamp((clientX - tr.left) / tr.width, 0, 1);
      this.tip.textContent = formatTime(p * dur);
      this.hoverFill.style.transform = `scaleX(${p})`;
      const half = this.tip.offsetWidth / 2;
      const x = clamp(tr.left + p * tr.width - rr.left, half + 4, rr.width - half - 4);
      this.tip.style.left = `${x}px`;
    }

    // ---- seeking -------------------------------------------------------------

    timeAt(clientX) {
      const tr = this.track.getBoundingClientRect();
      const p = clamp((clientX - tr.left) / tr.width, 0, 1);
      return clamp(p * this.duration, 0, this.maxTime);
    }

    // Seeks requested while dragging are coalesced to one per frame, and wait for the
    // previous seek to land, so a fast drag doesn't queue up dozens of seeks.
    requestSeek(t) {
      this.pendingSeek = t;
      if (!this.seekFrame) {
        this.seekFrame = requestAnimationFrame(() => {
          this.seekFrame = 0;
          this.flushSeek();
        });
      }
    }

    flushSeek() {
      if (this.pendingSeek === null) return;
      if (this.video.seeking && performance.now() - this.lastSeekAt < SEEK_SETTLE_MS) return; // onSeeked retries
      const t = this.pendingSeek;
      this.pendingSeek = null;
      this.lastSeekAt = performance.now();
      if (typeof this.video.fastSeek === 'function') this.video.fastSeek(t);
      else this.video.currentTime = t;
    }

    seekNow(t) {
      cancelAnimationFrame(this.seekFrame);
      this.seekFrame = 0;
      this.pendingSeek = null;
      this.lastSeekAt = performance.now();
      this.video.currentTime = t;
      this.render();
    }

    // Used by the keyboard shortcuts. Returns false if this video can't be seeked yet.
    seekBy(delta) {
      if (!this.duration) return false;
      const base = this.pendingSeek ?? this.video.currentTime;
      this.seekNow(clamp(base + delta, 0, this.maxTime));
      this.flash(`${delta < 0 ? '−' : '+'}${Math.abs(delta)}s`);
      return true;
    }

    // Frame by frame, like YouTube's , and . keys. Pauses first, since stepping only makes
    // sense on a still picture. Aims at the middle of the target frame, so rounding can't
    // leave us on the frame we started from.
    stepFrame(dir) {
      if (!this.duration) return false;
      if (!this.video.paused) this.video.pause();
      this.stepping = true;
      const fd = this.frameDuration;
      const base = this.pendingSeek ?? this.video.currentTime;
      const frame = Math.floor(base / fd + 1e-3);
      const target = (frame + dir) * fd + fd / 2;
      this.seekNow(clamp(target, 0, Math.max(0, this.duration - fd / 2)));
      this.flash(dir < 0 ? '−1 frame' : '+1 frame');
      return true;
    }

    // Browsers don't expose a video's frame rate, so measure it: while playing, the
    // smallest gap between consecutive frames' media times is one frame.
    probeFrames() {
      const v = this.video;
      if (typeof v.requestVideoFrameCallback !== 'function' || this.frameHandle) return;
      const onFrame = (_now, meta) => {
        this.frameHandle = 0;
        if (this.destroyed) return;
        const gap = this.lastMediaTime === null ? 0 : meta.mediaTime - this.lastMediaTime;
        this.lastMediaTime = meta.mediaTime;
        if (gap > 0.005 && gap < 0.1 && !v.paused && !v.seeking) {
          this.frameSamples.push(gap);
          if (this.frameSamples.length >= 5) this.frameDuration = snapFrame(Math.min(...this.frameSamples));
          if (this.frameSamples.length >= FRAME_SAMPLES) return;
        }
        this.frameHandle = v.requestVideoFrameCallback(onFrame);
      };
      this.frameHandle = v.requestVideoFrameCallback(onFrame);
    }

    stopFrameProbe() {
      if (this.frameHandle) this.video.cancelVideoFrameCallback?.(this.frameHandle);
      this.frameHandle = 0;
    }

    // ---- looping a section ---------------------------------------------------

    // Set with the A-B button or the [ and ] keys. Not offered on stories, where a loop
    // would keep the story from ever moving on.
    setRepeatStart() {
      if (this.story || !this.duration) return false;
      const t = this.pendingSeek ?? this.video.currentTime;
      this.repeat = { start: clamp(t, 0, Math.max(0, this.maxTime - MIN_REPEAT)), end: null };
      this.flash(`Loop from ${formatTime(this.repeat.start)}`);
      this.render();
      return true;
    }

    // Without a start, the loop starts at the beginning. Setting the end before the start
    // swaps them.
    setRepeatEnd() {
      if (this.story || !this.duration) return false;
      let start = this.repeat ? this.repeat.start : 0;
      let end = Math.min(this.pendingSeek ?? this.video.currentTime, this.maxTime);
      if (end < start) [start, end] = [end, start];
      if (end - start < MIN_REPEAT) {
        this.flash('Loop too short');
        return true;
      }
      this.repeat = { start, end };
      this.lastRepeatTime = null;
      this.flash(`Loop ${formatTime(start)}–${formatTime(end)}`);
      this.seekNow(start);
      return true;
    }

    clearRepeat() {
      if (!this.repeat) return false;
      this.repeat = null;
      this.flash('Loop off');
      this.render();
      return true;
    }

    // The A-B button: start, then end, then off.
    cycleRepeat() {
      if (!this.repeat) this.setRepeatStart();
      else if (this.repeat.end === null) this.setRepeatEnd();
      else this.clearRepeat();
    }

    // Keeps playback inside the loop. Runs every frame while playing, and on timeupdate
    // when frames aren't being drawn.
    checkRepeat() {
      const r = this.repeat;
      if (!r || r.end === null || this.dragging) return;
      const t = this.video.currentTime;
      const last = this.lastRepeatTime;
      this.lastRepeatTime = t;
      // A video that loops by itself can jump from its end back to 0 between two checks.
      const wrapped =
        last !== null && t < last - 0.5 && last >= r.end - 0.6 && performance.now() - this.lastSeekAt > 300;
      if (t >= r.end || wrapped) {
        this.video.currentTime = r.start;
        this.lastRepeatTime = r.start;
      }
    }

    renderRepeat(dur) {
      const r = this.repeat;
      const state = !r ? 'off' : r.end === null ? 'start' : 'on';
      this.repeatRange.classList.toggle('start', state === 'start');
      this.repeatRange.classList.toggle('on', state === 'on');
      this.startHandle.classList.toggle('show', state !== 'off');
      this.endHandle.classList.toggle('show', state === 'on');
      if (r) {
        this.repeatRange.style.left = `${(r.start / dur) * 100}%`;
        this.repeatRange.style.width = r.end === null ? '' : `${((r.end - r.start) / dur) * 100}%`;
        this.startHandle.style.left = `${(r.start / dur) * 100}%`;
        if (r.end !== null) this.endHandle.style.left = `${(r.end / dur) * 100}%`;
      }
      this.repeatBtn.dataset.state = state;
      this.repeatBtn.title = REPEAT_TITLES[state];
      this.repeatBtn.setAttribute('aria-label', REPEAT_TITLES[state]);
    }

    // Dragging an edge of the loop. The video seeks along with it, so you see the frame
    // the edge is on; letting go restarts the loop from its start.
    onHandleDown = (e) => {
      if (e.button !== 0 || !this.repeat || !this.duration) return;
      e.preventDefault();
      this.handleDrag = e.currentTarget === this.startHandle ? 'start' : 'end';
      this.dragging = true;
      this.root.classList.add('dragging');
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Capture can fail if the pointer is already gone; dragging still works while inside.
      }
      this.moveHandle(e.clientX);
      this.startLoop();
    };

    onHandleMove = (e) => {
      if (this.handleDrag) this.moveHandle(e.clientX);
    };

    onHandleUp = () => {
      if (!this.handleDrag) return;
      const r = this.repeat;
      this.handleDrag = null;
      this.dragging = false;
      this.root.classList.remove('dragging');
      this.lastRepeatTime = null;
      this.flash(r.end === null ? `Loop from ${formatTime(r.start)}` : `Loop ${formatTime(r.start)}–${formatTime(r.end)}`);
      this.seekNow(r.start);
    };

    // The start can't pass the end (or the end the start); they stay MIN_REPEAT apart.
    moveHandle(clientX) {
      const r = this.repeat;
      const t = this.timeAt(clientX);
      if (this.handleDrag === 'start') {
        const latest = (r.end ?? this.maxTime) - MIN_REPEAT;
        r.start = clamp(t, 0, Math.max(0, latest));
        this.dragTime = r.start;
      } else {
        r.end = clamp(t, r.start + MIN_REPEAT, this.maxTime);
        this.dragTime = r.end;
      }
      this.requestSeek(this.dragTime);
      const tr = this.track.getBoundingClientRect();
      this.showTip(tr.left + (this.dragTime / this.duration) * tr.width);
      this.render();
    }

    // ---- speed ---------------------------------------------------------------

    setSpeed(rate) {
      this.desiredRate = rate;
      this.rateFixes = 0;
      this.video.defaultPlaybackRate = rate; // survives a source change on the same element
      this.video.playbackRate = rate;
      this.renderSpeed();
    }

    changeSpeed(rate) {
      this.setSpeed(rate);
      this.flash(formatRate(rate));
      this.options.onSpeedChange?.(this, rate);
    }

    cycleSpeed() {
      const cur = this.video.playbackRate;
      this.changeSpeed(CLICK_SPEEDS.find((s) => s > cur + 0.001) ?? CLICK_SPEEDS[0]);
    }

    stepSpeed(dir) {
      const cur = this.video.playbackRate;
      let idx = 0;
      SPEEDS.forEach((s, i) => {
        if (Math.abs(s - cur) < Math.abs(SPEEDS[idx] - cur)) idx = i;
      });
      this.changeSpeed(SPEEDS[clamp(idx + dir, 0, SPEEDS.length - 1)]);
    }

    // ---- event handlers ------------------------------------------------------

    onRender = () => this.render();

    // A video that doesn't loop by itself stops at its end; carry on with the loop.
    onEnded = () => {
      if (this.repeat && this.repeat.end !== null) {
        this.video.currentTime = this.repeat.start;
        this.video.play().catch(() => {});
      }
      this.render();
    };

    // The element got a new source: its frame rate may differ.
    onEmptied = () => {
      this.repeat = null;
      this.stopFrameProbe();
      this.frameDuration = DEFAULT_FRAME;
      this.frameSamples = [];
      this.lastMediaTime = null;
      this.probeFrames();
      this.render();
    };

    onPlay = () => {
      if (!this.video.paused) this.stepping = false;
      if (this.desiredRate !== null && Math.abs(this.video.playbackRate - this.desiredRate) > 0.001) {
        this.video.playbackRate = this.desiredRate;
      }
      this.render();
      this.startLoop();
    };

    onSeeked = () => {
      this.flushSeek();
      this.render();
    };

    onRateChange = () => {
      this.renderSpeed();
      if (this.desiredRate === null || Math.abs(this.video.playbackRate - this.desiredRate) < 0.001) return;
      if (this.rateFixes++ > 20) return; // something keeps overriding the speed; stop fighting it
      this.video.playbackRate = this.desiredRate;
    };

    onHitDown = (e) => {
      if (e.button !== 0 || !this.duration) return;
      e.preventDefault();
      this.dragging = true;
      this.root.classList.add('dragging');
      // A story moves on by itself when its time is up, so hold it still while dragging
      // (like Instagram's own press-and-hold) and carry on playing after.
      if (this.story && !this.video.paused) {
        this.resumeAfterDrag = true;
        this.video.pause();
      }
      try {
        this.hit.setPointerCapture(e.pointerId);
      } catch {
        // Capture can fail if the pointer is already gone; dragging still works while inside.
      }
      this.dragTo(e.clientX);
      this.startLoop();
    };

    onHitMove = (e) => {
      this.showTip(e.clientX);
      if (this.dragging) this.dragTo(e.clientX);
    };

    onHitUp = (e) => {
      if (!this.dragging) return;
      this.dragTime = this.timeAt(e.clientX);
      this.endDrag();
    };

    onHitCancel = () => {
      if (this.dragging) this.endDrag();
    };

    onHitEnter = (e) => {
      this.root.classList.add('hover-bar');
      this.showTip(e.clientX);
    };

    onHitLeave = () => {
      this.root.classList.remove('hover-bar');
    };

    dragTo(clientX) {
      this.dragTime = this.timeAt(clientX);
      this.requestSeek(this.dragTime);
      this.showTip(clientX);
      this.render();
    }

    endDrag() {
      const t = this.dragTime;
      this.dragging = false;
      this.root.classList.remove('dragging');
      this.seekNow(t); // exact seek on release
      if (this.resumeAfterDrag) {
        this.resumeAfterDrag = false;
        this.video.play().catch(() => {});
      }
    }

    onZoneMove = (e) => {
      if (e.pointerType === 'touch') return;
      const r = this.root.getBoundingClientRect();
      const inZone = e.clientY >= r.bottom - this.zoneHeight && e.clientY <= r.bottom;
      if (inZone && !this.root.classList.contains('zone')) this.avoidObstacles();
      this.root.classList.toggle('zone', inZone);
    };

    // Touch screens have no hover, so a tap near the bottom shows the controls for a while.
    onZoneDown = (e) => {
      if (e.pointerType !== 'touch') return;
      const r = this.root.getBoundingClientRect();
      if (e.clientY < r.bottom - this.zoneHeight) return;
      this.avoidObstacles();
      this.root.classList.add('zone');
      clearTimeout(this.zoneTimer);
      this.zoneTimer = setTimeout(() => {
        if (!this.dragging) this.root.classList.remove('zone');
      }, TOUCH_ZONE_MS);
    };

    // ---- staying clear of Instagram's buttons ------------------------------------

    // Some videos have small Instagram buttons in the bottom corners (tagged people,
    // mute) or caption links near the bottom. Runs whenever the pointer enters the
    // bottom of the video, since Instagram can add those buttons at any time.
    avoidObstacles() {
      if (!this.mountEl) return;
      const rr = this.root.getBoundingClientRect();
      if (!rr.width || !rr.height) return;
      const obstacles = [];
      for (const el of this.mountEl.querySelectorAll(OBSTACLE_SELECTOR)) {
        const r = el.getBoundingClientRect();
        // Wide is fine (a story's reply box spans most of the width); tall means an overlay.
        if (r.width < 4 || r.height < 4 || r.height > Math.min(rr.height * 0.4, OBSTACLE_MAX_HEIGHT)) continue;
        // Only the bottom half matters: the pills never go higher than that.
        if (r.right <= rr.left || r.left >= rr.right || r.top >= rr.bottom || r.bottom <= rr.bottom - rr.height / 2) continue;
        if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        // Distances from the video's left and bottom edges.
        obstacles.push({ x0: r.left - rr.left, x1: r.right - rr.left, b0: rr.bottom - r.bottom, b1: rr.bottom - r.top });
      }
      this.notchHit(obstacles, rr.width);
      this.placeControls(obstacles, rr.width, rr.height);
    }

    // Cut a notch into the top of the bar's click area wherever a button reaches down
    // into it, so the button stays clickable. Below the buttons, the bottom
    // MIN_HIT_STRIP px stay seekable across the full width.
    notchHit(obstacles, width) {
      const height = this.hit.offsetHeight;
      const maxDepth = Math.max(0, height - MIN_HIT_STRIP);
      const notches = [];
      for (const o of [...obstacles].sort((a, b) => a.x0 - b.x0)) {
        const depth = Math.min(maxDepth, height - o.b0);
        if (depth <= 0) continue;
        const x0 = clamp(o.x0 - 2, 0, width);
        const x1 = clamp(o.x1 + 2, 0, width);
        const last = notches[notches.length - 1];
        if (last && x0 <= last.x1) {
          last.x1 = Math.max(last.x1, x1);
          last.depth = Math.max(last.depth, depth);
        } else if (x1 > x0) {
          notches.push({ x0, x1, depth });
        }
      }
      if (!notches.length) {
        this.hit.style.clipPath = '';
        return;
      }
      const points = ['0px 0px'];
      for (const n of notches) points.push(`${n.x0}px 0px`, `${n.x0}px ${n.depth}px`, `${n.x1}px ${n.depth}px`, `${n.x1}px 0px`);
      points.push(`${width}px 0px`, `${width}px ${height}px`, `0px ${height}px`);
      this.hit.style.clipPath = `polygon(${points.join(', ')})`;
    }

    // Slide the time/speed pills right past any button in the way; if there's no room on
    // that row, lift them above the buttons instead.
    placeControls(obstacles, width, height) {
      const c = this.controls;
      c.style.left = '';
      c.style.bottom = '';
      const cs = getComputedStyle(c);
      const defLeft = parseFloat(cs.left) || 0;
      const defBottom = parseFloat(cs.bottom) || 0;
      const w = c.offsetWidth;
      const h = c.offsetHeight;
      const t = OVERLAP_TOLERANCE;
      const blocking = (left, bottom) =>
        obstacles.filter((o) => left < o.x1 - t && left + w > o.x0 + t && bottom < o.b1 - t && bottom + h > o.b0 + t);

      let left = defLeft;
      for (let i = 0; i < 5; i++) {
        const hits = blocking(left, defBottom);
        if (!hits.length) break;
        left = Math.max(...hits.map((o) => o.x1)) + OBSTACLE_GAP;
      }
      let bottom = defBottom;
      if (left + w <= width - defLeft && !blocking(left, defBottom).length) {
        if (left !== defLeft) c.style.left = `${left}px`;
      } else {
        // Keep lifting until nothing is in the way: above a reply box there may be a
        // link sticker, and so on.
        let lifted = defBottom;
        for (let i = 0; i < 8; i++) {
          const hits = blocking(defLeft, lifted);
          if (!hits.length) break;
          lifted = Math.max(...hits.map((o) => o.b1)) + OBSTACLE_GAP;
        }
        if (lifted + h <= height / 2 && !blocking(defLeft, lifted).length) {
          bottom = lifted;
          c.style.bottom = `${bottom}px`;
        }
      }
      // The pills only show while the pointer is near the bottom. Reach up past them, or
      // they'd vanish as the pointer moves towards lifted pills.
      this.zoneHeight = Math.max(ZONE_PX, bottom + h + ZONE_MARGIN);
    }

    onZoneLeave = (e) => {
      if (e.pointerType !== 'touch' && !this.dragging) this.root.classList.remove('zone');
    };
  }

  globalThis.FrameSeek = Object.freeze({ SeekBar, formatTime });
})();
