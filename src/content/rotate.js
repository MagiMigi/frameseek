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
  // React writes inline styles too (style.x = v replaces ours): a property that no longer
  // holds what FrameSeek wrote belongs to Instagram again, and is left as it is.
  class StyleLedger {
    constructor() {
      // { el, prop, value, priority, ours, oursPriority }
      this.entries = [];
    }

    get size() {
      return this.entries.length;
    }

    static holdsOurs(e) {
      return e.el.style.getPropertyValue(e.prop) === e.ours && e.el.style.getPropertyPriority(e.prop) === e.oursPriority;
    }

    set(el, prop, value) {
      let entry = this.entries.find((e) => e.el === el && e.prop === prop);
      if (!entry) {
        entry = { el, prop };
        this.entries.push(entry);
      }
      if (!('ours' in entry) || !StyleLedger.holdsOurs(entry)) {
        entry.value = el.style.getPropertyValue(prop);
        entry.priority = el.style.getPropertyPriority(prop);
      }
      el.style.setProperty(prop, value, 'important');
      entry.ours = el.style.getPropertyValue(prop);
      entry.oursPriority = el.style.getPropertyPriority(prop);
    }

    restore() {
      for (let i = this.entries.length - 1; i >= 0; i--) {
        const e = this.entries[i];
        if (!StyleLedger.holdsOurs(e)) continue;
        if (e.value) e.el.style.setProperty(e.prop, e.value, e.priority);
        else e.el.style.removeProperty(e.prop);
      }
      this.entries = [];
    }
  }

  // ---- the Rotator --------------------------------------------------------------

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MOTION_S = '0.3s';
  const MOTION_MS = 320;
  const SIDE_MIN_PX = 40; // a real neighbour, not a zero-width spacer
  const EDGE_GAP = 24; // room kept between a turned card and the content area's edges
  const POPUP_ROW_SLACK = 100; // a post row this much wider than its card is a popup's
  const SHIELD_MS = 500; // a double click's second click comes within this (OS default)
  const SHIELD_PAD = 4;
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
      // The arrow host may be placed against a box outside a scrolling list.
      this.onScroll = () => {
        if (this.scrollFrame) return;
        this.scrollFrame = requestAnimationFrame(() => {
          this.scrollFrame = 0;
          this.place();
        });
      };
      video.addEventListener('emptied', this.onEmptied);
      video.addEventListener('durationchange', this.onDurationChange);
      addEventListener('resize', this.onResize);
      addEventListener('scroll', this.onScroll, { capture: true, passive: true });
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
      const click = (dir, button) => (e) => {
        const was = button.getBoundingClientRect();
        this.turn(dir);
        if (e.detail > 0) {
          button.blur(); // a mouse click shouldn't leave a focus ring
          this.shield(was);
        }
      };
      this.btnL.addEventListener('click', click(-1, this.btnL));
      this.btnR.addEventListener('click', click(1, this.btnR));
    }

    // False when Instagram replaced the frame or moved the video: the caller then
    // destroys this Rotator and attaches a new one.
    ensure() {
      if (!this.frame.isConnected || !this.frame.contains(this.video) || this.frame.parentElement !== this.row) return false;
      if (this.disabled) return true; // the page wouldn't take a turn: no arrows for this video
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
      this.onChange(next);
      this.apply(true);
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
      this.unshield();
      cancelAnimationFrame(this.followFrame);
      cancelAnimationFrame(this.scrollFrame);
      clearTimeout(this.resizeTimer);
      clearTimeout(this.verifyTimer);
      this.video.removeEventListener('emptied', this.onEmptied);
      this.video.removeEventListener('durationchange', this.onDurationChange);
      removeEventListener('resize', this.onResize);
      removeEventListener('scroll', this.onScroll, { capture: true });
      this.host.remove();
    }

    // The page wouldn't take the turned size: put everything back and stop offering the
    // arrows for this video. A broken card is worse than no turn.
    disable() {
      this.disabled = true;
      this.turns = 0;
      clearTimeout(this.motionTimer);
      clearTimeout(this.verifyTimer);
      this.shape.restore();
      this.motion.restore();
      this.unshield();
      this.host.remove();
      this.onChange(0);
    }

    // After a click the arrows move with the frame, so the second click of a double click
    // would land on Instagram's video or comments. Swallow clicks there for a moment.
    shield(r) {
      this.unshield();
      const until = performance.now() + SHIELD_MS;
      const box = { left: r.left - SHIELD_PAD, right: r.right + SHIELD_PAD, top: r.top - SHIELD_PAD, bottom: r.bottom + SHIELD_PAD };
      this.shieldFn = (e) => {
        if (performance.now() > until) {
          this.unshield();
          return;
        }
        if (e.composedPath?.().includes(this.host)) return; // an arrow at its new place
        const p = e.changedTouches?.[0] ?? e;
        if (p.clientX >= box.left && p.clientX <= box.right && p.clientY >= box.top && p.clientY <= box.bottom) {
          e.stopPropagation();
          e.preventDefault?.();
        }
      };
      for (const type of SWALLOWED) addEventListener(type, this.shieldFn, true);
      this.shieldTimer = setTimeout(() => this.unshield(), SHIELD_MS);
    }

    unshield() {
      clearTimeout(this.shieldTimer);
      if (!this.shieldFn) return;
      for (const type of SWALLOWED) removeEventListener(type, this.shieldFn, true);
      this.shieldFn = null;
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
      clearTimeout(this.verifyTimer);
      const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const moving = animate && !reduced;
      if (moving) this.addMotion();
      this.shape.restore();
      this.appliedWidth = pageWidth();
      if (this.turns) {
        try {
          if (isQuarter(this.turns)) {
            const width = this.kind === 'reels' ? this.shapeReels() : this.shapePost();
            // Check once the frame has reached its new size.
            if (moving) this.verifyWhenStill(width);
            else this.verify(width);
          } else {
            this.shape.set(this.video, 'transform', `rotate(${angleFor(this.turns)}deg)`);
          }
        } catch {
          // Something about the page was unexpected: stay upright rather than half turned.
          this.disable();
          return;
        }
      } else if (this.motion.size) {
        // Turning back: let the transitions run, then drop them too.
        this.motionTimer = setTimeout(() => this.motion.restore(), MOTION_MS);
      }
      this.follow(moving ? MOTION_MS : 0);
    }

    // A window that isn't being drawn (in the background, covered) doesn't run the
    // transition, so the frame can stay at its old size for a long time. Only judge the
    // size once nothing on the frame is animating.
    verifyWhenStill(width) {
      clearTimeout(this.verifyTimer);
      const check = () => {
        const moving = this.frame.getAnimations?.().some((a) => a.playState === 'running');
        if (moving) this.verifyTimer = setTimeout(check, MOTION_MS);
        else this.verify(width);
      };
      this.verifyTimer = setTimeout(check, MOTION_MS);
    }

    // The frame took the turned width and the card still ends inside the page.
    verify(width) {
      if (this.disabled || !isQuarter(this.turns)) return;
      const fr = this.frame.getBoundingClientRect();
      const sr = this.side.getBoundingClientRect();
      if (Math.abs(fr.width - width) > 2 || sr.right > pageWidth() + 1) this.disable();
    }

    // Longhands only: a shorthand such as `flex` would wipe Instagram's own inline
    // `flex-basis` when it is put back.
    addMotion() {
      const m = (el, props) => {
        this.motion.set(el, 'transition-property', props);
        this.motion.set(el, 'transition-duration', MOTION_S);
        this.motion.set(el, 'transition-timing-function', 'ease');
      };
      m(this.frame, 'width, height');
      m(this.row, 'margin-top, margin-bottom, margin-left, margin-right, width');
      m(this.video, 'transform, width, height');
    }

    // How wide the turned box may get: centred where it is, inside the content area
    // (right of Instagram's navigation, however wide that is) and inside the page. A
    // popup's row spans its own room, so it caps the card too.
    room(rect, uprightCardWidth) {
      const area = this.row.closest?.('main')?.getBoundingClientRect();
      const left = Math.max(0, area ? area.left : 0);
      const right = Math.min(pageWidth(), area ? area.right : pageWidth());
      const centre = rect.left + rect.width / 2;
      let room = 2 * Math.min(centre - left, right - centre) - 2 * EDGE_GAP;
      // The popup's row spans the dialog, far wider than its card: that is the card's room.
      const rowW = this.row.getBoundingClientRect().width;
      if (this.kind === 'post' && rowW > uprightCardWidth + POPUP_ROW_SLACK) room = Math.min(room, rowW);
      return Math.max(0, room);
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
      // The like column on the right, and as much again for the caption on the left.
      const maxWidth = this.room(this.frame.getBoundingClientRect(), w + sideW) - 2 * (sideW + 16);
      const size = reelsSize({ w, h, maxWidth });
      const f = (p, v) => this.shape.set(this.frame, p, v);
      f('width', `${size.width}px`);
      f('height', `${size.height}px`);
      f('max-width', 'none');
      f('max-height', 'none');
      f('align-self', 'center');
      f('flex-grow', '0');
      f('flex-shrink', '0');
      f('flex-basis', 'auto');
      // Keep the reel's slot as tall as before, so the next reel doesn't slide up.
      const pad = `${Math.max(0, (h - size.height) / 2)}px`;
      this.shape.set(this.row, 'margin-top', pad);
      this.shape.set(this.row, 'margin-bottom', pad);
      // Inner wrappers that size themselves from --x-height (signed in) follow the frame.
      for (const el of this.frame.querySelectorAll('*')) {
        // (Skipping FrameSeek's own elements: the seek bar's host resets everything.)
        if (!el.shadowRoot && el.style?.getPropertyValue('--x-height')) this.shape.set(el, '--x-height', `${size.height}px`);
      }
      this.fitAspectBoxes(size.width, size.height);
      this.turnVideo(size.width, size.height);
      return size.width;
    }

    // Aspect-ratio boxes (a percentage padding) between the frame and the video keep the
    // upright 9:16 shape, so a widened frame would make them far taller than the frame
    // (a black area over the page below). Give them the turned frame's proportion.
    fitAspectBoxes(width, height) {
      for (let el = this.video.parentElement; el && el !== this.frame; el = el.parentElement) {
        for (const prop of ['padding-bottom', 'padding-top']) {
          if (el.style.getPropertyValue(prop).endsWith('%')) this.shape.set(el, prop, `${(height / width) * 100}%`);
        }
      }
    }

    shapePost() {
      const { w, h } = this.upright;
      const panel = this.side.getBoundingClientRect().width;
      const maxCardWidth = this.room(this.row.getBoundingClientRect(), w + panel);
      const size = postSize({ w, h, panelWidth: panel, maxCardWidth });
      const f = (p, v) => this.shape.set(this.frame, p, v);
      f('width', `${size.width}px`);
      f('height', `${h}px`);
      f('max-width', 'none');
      f('max-height', 'none');
      f('aspect-ratio', 'auto');
      f('flex-grow', '0');
      f('flex-shrink', '0');
      f('flex-basis', 'auto');
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
      this.fitAspectBoxes(size.width, h);
      this.turnVideo(size.width, size.height);
      return size.width;
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
