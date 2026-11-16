// Hover preview: a hidden, low-quality copy of the video that seeks to the time under the
// mouse and is shown in a small box above the seek bar's time label. A file found in the
// page's resource timing is only used once a frame of it matches the real video's.
// Loaded as a classic content script; exposes globalThis.FrameSeekPreview.
(() => {
  'use strict';

  // Mean greyscale difference per pixel at 16×16: measured 8.6 for the right file and
  // 60–73 for other reels.
  const MATCH_MAX_DIFF = 25;
  // A nearly flat frame (black, white, a fade) would match any other flat frame.
  const MIN_SPREAD = 40;
  const MIN_BOX_WIDTH = 80;
  const EDGE = 4;
  const GREY_SIZE = 16;
  const OPEN_TIMEOUT_MS = 5000; // an expired or blocked file never sends its metadata
  const SEEK_TIMEOUT_MS = 3000;
  const RELEASE_MS = 5000; // drop the file this long after the mouse leaves the bar
  const RETRY_MS = 300; // while the real video's frame is unusable, look again at most this often

  const CSS = `
    .preview {
      position: absolute;
      left: 0;
      bottom: 0;
      box-sizing: border-box;
      border: 1px solid rgba(255, 255, 255, 0.35);
      border-radius: 4px;
      overflow: hidden;
      background: rgba(20, 20, 20, 0.85);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.1s ease;
    }
    .preview.show { opacity: 1; }
    .preview video {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function frameDiff(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
  }

  function frameSpread(g) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of g) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return hi - lo;
  }

  function boxSize(rootW, rootH, aspect) {
    const a = aspect > 0 ? aspect : 16 / 9;
    const width = Math.max(MIN_BOX_WIDTH, Math.min(0.32 * rootW, 0.4 * rootH * a));
    return { width, height: width / a };
  }

  function boxLeft(centerX, width, rootW) {
    return clamp(centerX - width / 2, EDGE, rootW - width - EDGE);
  }

  // Turn buttons (rotate.js): quarter turns 0–3, ↻ adding one. The same table as rotate.js,
  // which loads after this file.
  const ANGLES = [0, 90, 180, -90];
  const isQuarterTurn = (turns) => turns % 2 === 1;

  // A quarter turn swaps the picture's sides.
  function turnedAspect(aspect, turns) {
    return isQuarterTurn(turns) ? 1 / aspect : aspect;
  }

  // Tries the candidates in order and returns the first one that is this video's file:
  // { player, candidate }, 'retry' when the real video has no usable frame to compare
  // with yet, or null when none matches. Players that don't match are closed.
  async function pickSource(candidates, ops) {
    for (const candidate of candidates) {
      let ref = null;
      if (candidate.check) {
        // Look at the real video first, so a flat frame costs no download.
        ref = ops.reference();
        if (!ref || frameSpread(ref.grey) < MIN_SPREAD) return 'retry';
      }
      const player = await ops.open(candidate.url, candidate.check);
      if (!player) continue;
      if (!candidate.check) return { player, candidate };
      const grey = await ops.frameAt(player, ref.time);
      if (grey && frameDiff(ref.grey, grey) <= MATCH_MAX_DIFF) return { player, candidate };
      ops.close(player);
    }
    return null;
  }

  // ---- the player ------------------------------------------------------------

  // Resolves true when `type` fires, false on an error, when the player is released
  // (`emptied`) or after `ms`.
  function waitFor(el, type, ms) {
    return new Promise((resolve) => {
      const done = (ok) => {
        clearTimeout(timer);
        el.removeEventListener(type, onOk);
        el.removeEventListener('error', onFail);
        el.removeEventListener('emptied', onFail);
        resolve(ok);
      };
      const onOk = () => done(true);
      const onFail = () => done(false);
      const timer = setTimeout(() => done(false), ms);
      el.addEventListener(type, onOk);
      el.addEventListener('error', onFail);
      el.addEventListener('emptied', onFail);
    });
  }

  // Stops a player's download and frees its decoder.
  function release(player) {
    player.removeAttribute('src');
    player.load();
    player.remove();
  }

  class Preview {
    constructor(main, container) {
      this.main = main;
      this.box = document.createElement('div');
      this.box.className = 'preview';
      this.box.setAttribute('aria-hidden', 'true');
      container.append(this.box);
      this.player = null;
      this.pending = new Set(); // candidate players still loading or being checked
      this.known = null; // the confirmed file, kept across a release: { url, check: false }
      this.matchedDuration = 0;
      this.state = 'idle'; // 'idle' | 'matching' | 'ready' | 'none'
      this.noneVersion = -1; // the source list's version when nothing matched
      this.retryAt = 0; // no new frame check before this time (performance.now())
      this.gen = 0; // bumped by reset/release/destroy, so late results are dropped
      this.hovering = false;
      this.wanted = null;
      this.seeking = false;
      this.shownAt = null; // the time the player last landed on
      this.releaseTimer = 0;
      this.layout = null;
      this.boxNow = null; // the box's current size: { width, height }
      this.turns = 0; // how the main video is turned (turn buttons)
      this.canvas = null;
      this.ctx = null;
      this.destroyed = false;
    }

    hover(t) {
      if (this.destroyed) return;
      clearTimeout(this.releaseTimer);
      this.releaseTimer = 0;
      this.hovering = true;
      this.wanted = t;
      if (this.state === 'none' && globalThis.FrameSeekSources.version() !== this.noneVersion) this.state = 'idle';
      if (this.state === 'idle') {
        if (performance.now() >= this.retryAt) this.match();
      } else if (this.state === 'ready') {
        this.seek();
      }
    }

    hide() {
      this.hovering = false;
      this.box.classList.remove('show');
    }

    leave() {
      this.hide();
      clearTimeout(this.releaseTimer);
      this.releaseTimer = setTimeout(() => this.release(), RELEASE_MS);
    }

    place(centerX, bottom, rootW, rootH) {
      this.layout = { centerX, bottom, rootW, rootH };
      this.applyLayout();
    }

    applyLayout() {
      if (!this.layout) return;
      const { centerX, bottom, rootW, rootH } = this.layout;
      const src = this.player?.videoWidth ? this.player : this.main;
      const { width, height } = boxSize(rootW, rootH, turnedAspect(src.videoWidth / src.videoHeight, this.turns));
      const s = this.box.style;
      s.width = `${width}px`;
      s.height = `${height}px`;
      s.left = `${boxLeft(centerX, width, rootW)}px`;
      s.bottom = `${bottom}px`;
      this.boxNow = { width, height };
      this.orientPlayer();
    }

    // Follow the main video's turn (turn buttons).
    setTurns(turns) {
      this.turns = turns;
      this.applyLayout();
      if (!this.layout) this.orientPlayer();
    }

    // Turned a quarter, the player keeps its upright shape (box height × box width) and
    // turns about the box's centre, so it fills the wide box.
    orientPlayer() {
      const p = this.player;
      if (!p) return;
      const s = p.style;
      const quarter = isQuarterTurn(this.turns) && this.boxNow;
      s.position = quarter ? 'absolute' : '';
      s.left = quarter ? '50%' : '';
      s.top = quarter ? '50%' : '';
      s.width = quarter ? `${this.boxNow.height}px` : '';
      s.height = quarter ? `${this.boxNow.width}px` : '';
      if (quarter) s.transform = `translate(-50%, -50%) rotate(${ANGLES[this.turns]}deg)`;
      else s.transform = this.turns === 2 ? 'rotate(180deg)' : '';
    }

    // The main video's source changed, or the preview was turned off.
    reset() {
      this.release();
      this.known = null;
      this.state = 'idle';
      this.matchedDuration = 0;
      this.retryAt = 0;
    }

    destroy() {
      this.reset();
      this.destroyed = true;
      this.box.remove();
    }

    // Lets go of the file but remembers which one matched, so coming back to the bar
    // doesn't need another frame check.
    release() {
      this.gen++;
      clearTimeout(this.releaseTimer);
      this.releaseTimer = 0;
      if (this.player) release(this.player);
      this.player = null;
      for (const p of this.pending) release(p);
      this.pending.clear();
      this.seeking = false;
      this.shownAt = null;
      this.box.classList.remove('show');
      if (this.state !== 'none') this.state = 'idle';
    }

    async match() {
      const gen = this.gen;
      this.state = 'matching';
      try {
        await this.tryMatch(gen);
      } catch {
        // Something unexpected: drop what was loading and try again on a later hover.
        if (gen === this.gen) {
          this.release();
          this.state = 'idle';
          this.retryAt = performance.now() + RETRY_MS;
        }
      }
    }

    async tryMatch(gen) {
      const duration = this.main.duration;
      const usedKnown = Boolean(this.known);
      // Read before looking, so a file listed while this check runs triggers another try.
      const version = globalThis.FrameSeekSources.version();
      const candidates = usedKnown ? [this.known] : globalThis.FrameSeekSources.candidatesFor(this.main);
      const result = await pickSource(candidates, {
        open: (url, check) => this.open(url, check, gen),
        reference: () => this.reference(),
        frameAt: (player, time) => this.frameAt(player, time),
        close: (player) => {
          this.pending.delete(player);
          release(player);
        },
      });
      if (result && typeof result === 'object') this.pending.delete(result.player);
      if (gen !== this.gen) {
        if (result && typeof result === 'object') release(result.player);
        return;
      }
      if (result === 'retry') {
        this.state = 'idle'; // try again on a later hover
        this.retryAt = performance.now() + RETRY_MS;
        return;
      }
      if (!result && usedKnown) {
        // The remembered file no longer loads (its signed URL may have expired):
        // look for it in the list again on the next hover.
        this.known = null;
        this.state = 'idle';
        return;
      }
      if (!result) {
        this.state = 'none';
        this.noneVersion = version;
        return;
      }
      this.player = result.player;
      this.known = { url: result.candidate.url, check: false };
      this.matchedDuration = duration;
      this.state = 'ready';
      this.box.append(this.player);
      this.applyLayout();
      if (this.hovering) this.seek();
    }

    async open(url, check, gen) {
      if (gen !== this.gen) return null;
      const p = document.createElement('video');
      p.muted = true;
      p.playsInline = true;
      p.disablePictureInPicture = true;
      p.preload = 'metadata';
      if (check) p.crossOrigin = 'anonymous'; // so its frames can be compared
      this.pending.add(p);
      p.src = url;
      const ok = await waitFor(p, 'loadedmetadata', OPEN_TIMEOUT_MS);
      if (!ok || gen !== this.gen) {
        this.pending.delete(p);
        release(p);
        return null;
      }
      return p;
    }

    reference() {
      const v = this.main;
      // While seeking, the picture can still be the old frame although currentTime is new.
      if (v.readyState < 2 || !v.videoWidth || v.seeking) return null;
      const grey = this.greyOf(v);
      return grey && { grey, time: v.currentTime };
    }

    async frameAt(player, time) {
      player.currentTime = clamp(time, 0, player.duration || time);
      return (await waitFor(player, 'seeked', SEEK_TIMEOUT_MS)) ? this.greyOf(player) : null;
    }

    greyOf(source) {
      if (!this.ctx) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = GREY_SIZE;
        this.canvas.height = GREY_SIZE;
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      }
      let data;
      try {
        this.ctx.drawImage(source, 0, 0, GREY_SIZE, GREY_SIZE);
        data = this.ctx.getImageData(0, 0, GREY_SIZE, GREY_SIZE).data;
      } catch {
        return null; // a file without CORS can't be read back
      }
      const grey = new Float32Array(GREY_SIZE * GREY_SIZE);
      for (let i = 0; i < grey.length; i++) {
        grey[i] = 0.3 * data[i * 4] + 0.59 * data[i * 4 + 1] + 0.11 * data[i * 4 + 2];
      }
      return grey;
    }

    // One seek in flight; when it lands, go on to the latest time asked for.
    seek() {
      const p = this.player;
      if (!p || this.seeking || this.wanted === null) return;
      const t = this.wanted;
      if (t === this.shownAt) {
        this.updateShow();
        return;
      }
      this.seeking = true;
      const gen = this.gen;
      p.currentTime = clamp(t, 0, p.duration || t);
      waitFor(p, 'seeked', SEEK_TIMEOUT_MS).then((ok) => {
        if (gen !== this.gen) return;
        this.seeking = false;
        if (ok) this.shownAt = t;
        this.updateShow();
        if (this.wanted !== t) this.seek();
      });
    }

    updateShow() {
      this.box.classList.toggle('show', this.hovering && this.shownAt !== null);
    }
  }

  globalThis.FrameSeekPreview = Object.freeze({
    MATCH_MAX_DIFF,
    MIN_SPREAD,
    CSS,
    frameDiff,
    frameSpread,
    boxSize,
    boxLeft,
    turnedAspect,
    pickSource,
    Preview,
  });
})();
