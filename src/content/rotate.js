// Turn buttons: two arrows at a video's top corners turn it a quarter turn. The video's
// frame is reshaped to the turned size, so Instagram's own layout moves its like column,
// caption, comments and mute button to stay beside it. Every inline style FrameSeek sets
// on Instagram's elements goes through a StyleLedger, which puts each one back exactly.
// Loaded as a classic content script; exposes globalThis.FrameSeekRotate.
(() => {
  'use strict';

  const ANGLES = [0, 90, 180, -90];
  const REELS_SIDE_MAX = 120; // the Reels page's like column is about 60 px wide
  const POST_SIDE_MIN = 250; // the post card's comments panel is 335–500 px wide

  // ↻ is +1 and ↺ is −1; four quarter turns bring the video back upright.
  const nextTurns = (turns, dir) => (((turns + dir) % 4) + 4) % 4;
  const angleFor = (turns) => ANGLES[turns];
  const isQuarter = (turns) => turns % 2 === 1;

  // What sits to the right of the video decides the layout: the Reels page's narrow like
  // column, or a post card's comments panel. Anything else (a carousel's next slide) is
  // neither, and that video gets no arrows.
  function classifyRow({ sideWidth, sideHasIcons, sideHasCommentBox }) {
    if (sideWidth < REELS_SIDE_MAX && sideHasIcons) return 'reels';
    if (sideWidth > POST_SIDE_MIN && sideHasCommentBox) return 'post';
    return null;
  }

  // Reels page: the old height becomes the new width, unless the window is narrower.
  function reelsSize({ w, h, maxWidth }) {
    const width = Math.min(h, maxWidth);
    return { width, height: (width * w) / h };
  }

  // Post card: the picture keeps the card's height, so its width is h × h / w, unless the
  // card (picture + comments panel) would be wider than the window allows.
  function postSize({ w, h, panelWidth, maxCardWidth }) {
    const width = Math.min((h * h) / w, maxCardWidth - panelWidth);
    return { width, height: (width * w) / h };
  }

  // Sets inline styles with !important and remembers what each property was before, so
  // restore() can put every one of them back exactly (value and priority), newest first.
  class StyleLedger {
    constructor() {
      this.entries = []; // { el, prop, value, priority }
    }

    get size() {
      return this.entries.length;
    }

    set(el, prop, value) {
      if (!this.entries.some((e) => e.el === el && e.prop === prop)) {
        this.entries.push({
          el,
          prop,
          value: el.style.getPropertyValue(prop),
          priority: el.style.getPropertyPriority(prop),
        });
      }
      el.style.setProperty(prop, value, 'important');
    }

    restore() {
      for (let i = this.entries.length - 1; i >= 0; i--) {
        const { el, prop, value, priority } = this.entries[i];
        if (value) el.style.setProperty(prop, value, priority);
        else el.style.removeProperty(prop);
      }
      this.entries = [];
    }
  }

  // ---- the Rotator --------------------------------------------------------------

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MOTION = '0.3s ease';
  const MOTION_MS = 320;
  const SIDE_MIN_PX = 40; // a real neighbour, not a zero-width spacer
  const NAV_PX = 72; // Instagram's left navigation column
  const ARROW_PX = 30;
  const ARROW_OUT = 27; // how far an arrow reaches out past the corner
  const ARROW_UP = 6;
  const RESIZE_SETTLE_MS = 120; // re-apply once the window has stopped changing size

  // The page's own width. innerWidth can count more than the page really has (with
  // zoom or device emulation), which would let a turned card run off the screen.
  const pageWidth = () => globalThis.document?.documentElement?.clientWidth || innerWidth;
  // Events from the arrows must not reach Instagram, or a click would also pause the
  // video and a double click would "like" it.
  const SWALLOWED = [
    'click', 'dblclick', 'auxclick', 'contextmenu',
    'mousedown', 'mouseup', 'pointerdown', 'pointerup',
    'touchstart', 'touchend',
  ];
  const CSS = `
    :host { all: initial; }
    button {
      position: absolute;
      top: -${ARROW_UP}px;
      width: ${ARROW_PX}px;
      height: ${ARROW_PX}px;
      padding: 0;
      border: 0;
      background: none;
      color: var(--fs-arrow, #f5f5f5);
      opacity: 0.75;
      cursor: pointer;
      pointer-events: auto;
      filter: drop-shadow(0 0 2px var(--fs-arrow-shadow, rgba(0, 0, 0, 0.6)));
      transition: opacity 0.15s ease;
    }
    button:hover { opacity: 1; }
    button:focus-visible { outline: 2px solid #ff3d5a; outline-offset: 2px; border-radius: 6px; opacity: 1; }
    .l { left: -${ARROW_OUT}px; }
    svg { display: block; width: 100%; height: 100%; overflow: visible; }
    path { fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
  `;
  // ↺ curls round the top-left corner, ↻ round the top-right.
  const PATH_L = 'M25 5 A19 19 0 0 0 6 24 M2 19 L6 25 L10 19';
  const PATH_R = 'M5 5 A19 19 0 0 1 24 24 M20 19 L24 25 L28 19';

  // The video's frame is the child of the first horizontal flex row (walking up from the
  // video) that has a neighbour to its right. Only that row counts: in a carousel it is
  // the slide strip, which is neither layout, so carousel videos get no arrows.
  function findLayout(video) {
    for (let frame = video.parentElement; frame; frame = frame.parentElement) {
      const row = frame.parentElement;
      if (!row) return null;
      const rs = getComputedStyle(row);
      if (!String(rs.display).includes('flex') || !String(rs.flexDirection).startsWith('row')) continue;
      const fr = frame.getBoundingClientRect();
      const side = [...row.children].find((c) => {
        if (c === frame) return false;
        const r = c.getBoundingClientRect();
        return r.left >= fr.right - 4 && r.width > SIDE_MIN_PX;
      });
      if (!side) continue;
      const kind = classifyRow({
        sideWidth: side.getBoundingClientRect().width,
        sideHasIcons: Boolean(side.querySelector('svg[aria-label]')),
        sideHasCommentBox: Boolean(side.querySelector('textarea, form')),
      });
      return kind ? { kind, frame, row, side } : null;
    }
    return null;
  }

  // Readable on the icon colour: a dark shadow under light arrows and the other way round.
  function shadowFor(color) {
    const m = String(color).match(/\d+(\.\d+)?/g);
    if (!m || m.length < 3) return 'rgba(0, 0, 0, 0.6)';
    const [r, g, b] = m.map(Number);
    return 0.3 * r + 0.59 * g + 0.11 * b > 128 ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255, 255, 255, 0.7)';
  }

  function arrowButton(cls, label, path) {
    const b = document.createElement('button');
    b.setAttribute('type', 'button');
    b.setAttribute('class', cls);
    b.setAttribute('title', label);
    b.setAttribute('aria-label', label);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 30 30');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', path);
    svg.append(p);
    b.append(svg);
    return b;
  }

  class Rotator {
    // options: { onChange(turns) }
    constructor(video, layout, options = {}) {
      this.video = video;
      this.kind = layout.kind;
      this.frame = layout.frame;
      this.row = layout.row;
      this.side = layout.side;
      this.onChange = options.onChange ?? (() => {});
      this.turns = 0;
      this.shape = new StyleLedger(); // sizes and positions
      this.motion = new StyleLedger(); // transitions, removed after the turn back has animated
      this.upright = null;
      this.turnedDuration = 0;
      this.followUntil = 0;
      this.followFrame = 0;
      this.motionTimer = 0;
      this.build();
      this.onEmptied = () => this.reset();
      this.onDurationChange = () => {
        const d = this.video.duration;
        if (this.turns && Number.isFinite(d) && Math.abs(d - this.turnedDuration) > 0.5) this.reset();
      };
      // The resize event can come before the new size has settled: wait a moment.
      this.onResize = () => {
        clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => this.reapply(), RESIZE_SETTLE_MS);
      };
      video.addEventListener('emptied', this.onEmptied);
      video.addEventListener('durationchange', this.onDurationChange);
      addEventListener('resize', this.onResize);
      this.ensure();
    }

    build() {
      this.host = document.createElement('div');
      this.host.style.cssText = '';
      for (const [k, v] of [
        ['position', 'absolute'], ['left', '0px'], ['top', '0px'], ['width', '0px'], ['height', '0px'],
        ['z-index', '2147483001'], ['pointer-events', 'none'], ['display', 'block'],
      ]) this.host.style.setProperty(k, v, 'important');
      const shadow = this.host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = CSS;
      this.btnL = arrowButton('l', 'Turn left', PATH_L);
      this.btnR = arrowButton('r', 'Turn right', PATH_R);
      shadow.append(style, this.btnL, this.btnR);
      for (const type of SWALLOWED) {
        for (const b of [this.btnL, this.btnR]) b.addEventListener(type, (e) => e.stopPropagation());
      }
      const click = (dir) => (e) => {
        this.turn(dir);
        if (e.detail > 0) e.currentTarget.blur(); // a mouse click shouldn't leave a focus ring
      };
      this.btnL.addEventListener('click', click(-1));
      this.btnR.addEventListener('click', click(1));
    }

    // False when Instagram replaced the frame or moved the video: the caller then
    // destroys this Rotator and attaches a new one.
    ensure() {
      if (!this.frame.isConnected || !this.frame.contains(this.video) || this.frame.parentElement !== this.row) return false;
      if (this.host.parentElement !== this.row) this.row.appendChild(this.host);
      // The page can change width without a resize event (a scrollbar appearing).
      if (this.turns && pageWidth() !== this.appliedWidth) this.reapply();
      this.paint();
      this.place();
      return true;
    }

    turn(dir) {
      const next = nextTurns(this.turns, dir);
      if (!this.turns) {
        this.upright = this.measure();
        this.turnedDuration = this.video.duration;
      }
      this.turns = next;
      this.apply(true);
      this.onChange(this.turns);
    }

    reset() {
      if (!this.turns && !this.shape.size && !this.motion.size) return;
      this.turns = 0;
      clearTimeout(this.motionTimer);
      this.shape.restore();
      this.motion.restore();
      this.place();
      this.onChange(0);
    }

    destroy() {
      this.reset();
      cancelAnimationFrame(this.followFrame);
      clearTimeout(this.resizeTimer);
      this.video.removeEventListener('emptied', this.onEmptied);
      this.video.removeEventListener('durationchange', this.onDurationChange);
      removeEventListener('resize', this.onResize);
      this.host.remove();
    }

    // The frame's upright size. The Reels page sets it on the frame as --x-width/--x-height.
    measure() {
      const w = parseFloat(this.frame.style.getPropertyValue('--x-width'));
      const h = parseFloat(this.frame.style.getPropertyValue('--x-height'));
      if (this.kind === 'reels' && w > 0 && h > 0) return { w, h };
      const r = this.frame.getBoundingClientRect();
      return { w: r.width, h: r.height };
    }

    // After a window resize: measure the upright size again and turn to the same state.
    reapply() {
      if (!this.turns) return;
      this.shape.restore();
      this.upright = this.measure();
      this.apply(false);
    }

    apply(animate) {
      clearTimeout(this.motionTimer);
      const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (animate && !reduced) this.addMotion();
      this.shape.restore();
      this.appliedWidth = pageWidth();
      if (this.turns) {
        try {
          if (isQuarter(this.turns)) {
            if (this.kind === 'reels') this.shapeReels();
            else this.shapePost();
          } else {
            this.shape.set(this.video, 'transform', `rotate(${angleFor(this.turns)}deg)`);
          }
        } catch {
          // Something about the page was unexpected: stay upright rather than half turned.
          this.shape.restore();
          this.turns = 0;
        }
      } else if (this.motion.size) {
        // Turning back: let the transitions run, then drop them too.
        this.motionTimer = setTimeout(() => this.motion.restore(), MOTION_MS);
      }
      this.follow(animate && !reduced ? MOTION_MS : 0);
    }

    addMotion() {
      this.motion.set(this.frame, 'transition', `width ${MOTION}, height ${MOTION}`);
      this.motion.set(this.row, 'transition', `margin ${MOTION}, width ${MOTION}`);
      this.motion.set(this.video, 'transition', `transform ${MOTION}, width ${MOTION}, height ${MOTION}`);
    }

    // The video keeps its upright shape (picture height × picture width) and is turned
    // a quarter about its centre, so it covers a picture × height box exactly.
    turnVideo(width, height) {
      const s = (p, v) => this.shape.set(this.video, p, v);
      s('position', 'absolute');
      s('width', `${height}px`);
      s('height', `${width}px`);
      s('max-width', 'none');
      s('max-height', 'none');
      s('left', '50%');
      s('top', '50%');
      s('transform', `translate(-50%, -50%) rotate(${angleFor(this.turns)}deg)`);
    }

    shapeReels() {
      const { w, h } = this.upright;
      const sideW = this.side.getBoundingClientRect().width;
      const size = reelsSize({ w, h, maxWidth: pageWidth() - 2 * (NAV_PX + sideW + 16) });
      const f = (p, v) => this.shape.set(this.frame, p, v);
      f('width', `${size.width}px`);
      f('height', `${size.height}px`);
      f('max-width', 'none');
      f('max-height', 'none');
      f('align-self', 'center');
      f('flex', 'none');
      // Keep the reel's slot as tall as before, so the next reel doesn't slide up.
      const pad = `${Math.max(0, (h - size.height) / 2)}px`;
      this.shape.set(this.row, 'margin-top', pad);
      this.shape.set(this.row, 'margin-bottom', pad);
      // Inner wrappers that size themselves from --x-height (signed in) follow the frame.
      for (const el of this.frame.querySelectorAll('*')) {
        if (el.style?.getPropertyValue('--x-height')) this.shape.set(el, '--x-height', `${size.height}px`);
      }
      this.turnVideo(size.width, size.height);
    }

    shapePost() {
      const { w, h } = this.upright;
      const panel = this.side.getBoundingClientRect().width;
      const size = postSize({ w, h, panelWidth: panel, maxCardWidth: pageWidth() - 2 * NAV_PX });
      const f = (p, v) => this.shape.set(this.frame, p, v);
      f('width', `${size.width}px`);
      f('height', `${h}px`);
      f('max-width', 'none');
      f('max-height', 'none');
      f('aspect-ratio', 'auto');
      f('flex', 'none');
      // The card widens past its column when its row is too narrow (single reel and post
      // pages); the popup's row already spans the window and just re-centres.
      const rowW = this.row.getBoundingClientRect().width;
      const needed = size.width + panel;
      if (rowW < needed - 1) {
        const half = `${-(needed - rowW) / 2}px`;
        this.shape.set(this.row, 'width', `${needed}px`);
        this.shape.set(this.row, 'max-width', 'none');
        this.shape.set(this.row, 'flex-shrink', '0');
        this.shape.set(this.row, 'margin-left', half);
        this.shape.set(this.row, 'margin-right', half);
      }
      this.turnVideo(size.width, size.height);
    }

    // Arrow colour from Instagram's own icons beside the video, so it follows the theme.
    paint() {
      const icon = this.side.querySelector('svg[aria-label]');
      const color = getComputedStyle(icon ?? this.side).color;
      if (!color) return;
      this.host.style.setProperty('--fs-arrow', color);
      this.host.style.setProperty('--fs-arrow-shadow', shadowFor(color));
    }

    // Puts the arrow host at the frame's top-left, relative to whatever box it is
    // positioned in, and the right arrow past the frame's (Reels) or the card's (post)
    // top-right corner.
    place() {
      const cb = this.host.offsetParent;
      if (!cb) return;
      const fr = this.frame.getBoundingClientRect();
      const cr = cb.getBoundingClientRect();
      const x = fr.left - cr.left - (cb.clientLeft || 0) + (cb.scrollLeft || 0);
      const y = fr.top - cr.top - (cb.clientTop || 0) + (cb.scrollTop || 0);
      this.host.style.setProperty('left', `${x}px`, 'important');
      this.host.style.setProperty('top', `${y}px`, 'important');
      const right = (this.kind === 'post' ? this.side : this.frame).getBoundingClientRect().right;
      this.btnR.style.setProperty('left', `${right - fr.left - ARROW_PX + ARROW_OUT}px`);
    }

    // Keep the arrows on the corners while the frame animates.
    follow(ms) {
      cancelAnimationFrame(this.followFrame);
      this.followUntil = performance.now() + ms;
      const step = () => {
        this.place();
        if (performance.now() < this.followUntil) this.followFrame = requestAnimationFrame(step);
      };
      step();
    }
  }

  function attach(video, options) {
    if (globalThis.location?.pathname?.startsWith('/stories/')) return null;
    const layout = findLayout(video);
    return layout ? new Rotator(video, layout, options) : null;
  }

  globalThis.FrameSeekRotate = Object.freeze({
    nextTurns,
    angleFor,
    isQuarter,
    classifyRow,
    reelsSize,
    postSize,
    StyleLedger,
    findLayout,
    attach,
  });
})();
