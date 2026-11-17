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

  // How much a vw × vh picture turned by `deg` must shrink to fit inside an fw × fh frame:
  // 1 when upright, or a quarter turn in a frame of its turned shape, and less partway.
  function fitScale({ vw, vh, deg, fw, fh }) {
    const r = (deg * Math.PI) / 180;
    const c = Math.abs(Math.cos(r));
    const s = Math.abs(Math.sin(r));
    return Math.min(1, fw / (vw * c + vh * s), fh / (vw * s + vh * c));
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
  const MOTION_MS = 300;
  // A window that isn't being drawn runs no animation frames: the turn ends by this anyway.
  const MOTION_FALLBACK_MS = MOTION_MS + 200;
  const SIDE_MIN_PX = 40; // a real neighbour, not a zero-width spacer
  // Room kept between a turned card and the edges of its space, so the arrows, which reach
  // 27 px past the card, stay inside it: at a popup's very edge a click goes to the
  // backdrop and closes the popup.
  const EDGE_GAP = 48;
  const POPUP_ROW_SLACK = 100; // a post row this much wider than its card is a popup's
  const SHIELD_MS = 500; // a double click's second click comes within this (OS default)
  const SHIELD_PAD = 4;
  const ARROW_PX = 30;
  const ARROW_OUT = 27; // how far an arrow reaches out past the corner
  const ARROW_UP = 6;
  const RESIZE_SETTLE_MS = 120; // re-apply once the window has stopped changing size

  // Slow at both ends, so the turn starts and lands softly.
  const ease = (t) => 0.5 - Math.cos(Math.PI * t) / 2;
  // A turn's shape partway (p from 0 to 1) between two shapes; at 1 exactly the second.
  const mix = (a, b, p) => Object.fromEntries(Object.keys(b).map((k) => [k, p >= 1 ? b[k] : a[k] + (b[k] - a[k]) * p]));

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
      this.angle = 0; // degrees, counted on across turns so each one turns the short way
      this.shape = new StyleLedger(); // every inline style a turn sets on Instagram's elements
      this.upright = null; // the upright layout, measured when a turn starts from upright
      this.geo = null; // the shape on screen now: null when upright and untouched
      this.goal = null; // the shape the current turn ends in
      this.frameId = 0; // the next animation frame while a turn is moving
      this.fallbackTimer = 0;
      this.sizedInside = []; // inner wrappers sized from --x-height
      this.aspectBoxes = []; // [element, padding property] of aspect-ratio boxes
      this.widening = false; // the post card's row overflows its column while turned
      this.turnedDuration = 0;
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
      // The page can change width without a resize event (a scrollbar appearing). A turn
      // still moving is left to finish; the next check catches it.
      if (this.turns && !this.frameId && pageWidth() !== this.appliedWidth) this.reapply();
      this.paint();
      this.place();
      return true;
    }

    turn(dir) {
      const next = nextTurns(this.turns, dir);
      if (!this.turns) {
        // Measured upright, also while a turn back is still moving: its styles come off
        // for the measurement, and the new turn starts from the shape on screen.
        this.shape.restore();
        this.upright = this.measure();
        this.turnedDuration = this.video.duration;
      }
      this.turns = next;
      this.angle += dir * 90;
      this.onChange(next);
      this.apply(true);
    }

    reset() {
      if (!this.turns && !this.shape.size) return;
      this.stopMotion();
      this.turns = 0;
      this.angle = 0;
      this.geo = null;
      this.shape.restore();
      this.place();
      this.onChange(0);
    }

    destroy() {
      this.reset();
      this.stopMotion();
      this.unshield();
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
      this.stopMotion();
      clearTimeout(this.verifyTimer);
      this.turns = 0;
      this.angle = 0;
      this.geo = null;
      this.shape.restore();
      this.unshield();
      this.host.remove();
      this.onChange(0);
    }

    // After a click the arrows move with the frame, so the second click of a double click
    // would land on whatever is now under the old spot: Instagram's video or comments
    // (pause, like) or a popup's backdrop (closes the popup). For a moment, every event
    // at that spot is stopped at the window, before anything else sees it. That includes
    // the arrow itself: a press that starts on the arrow can end on the page as the arrow
    // moves away, and the page would get the click. A fast double click is one turn.
    shield(r) {
      this.unshield();
      const box = { left: r.left - SHIELD_PAD, right: r.right + SHIELD_PAD, top: r.top - SHIELD_PAD, bottom: r.bottom + SHIELD_PAD };
      this.shieldFn = (e) => {
        const p = e.changedTouches?.[0] ?? e;
        if (p.clientX >= box.left && p.clientX <= box.right && p.clientY >= box.top && p.clientY <= box.bottom) {
          e.stopImmediatePropagation();
          e.preventDefault();
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

    // The upright layout, read while nothing is turned: the frame's size (the Reels page
    // sets it on the frame as --x-width/--x-height), the neighbour's and the row's widths,
    // and how wide the turned box may get.
    measure() {
      const fr = this.frame.getBoundingClientRect();
      const rr = this.row.getBoundingClientRect();
      let w = fr.width;
      let h = fr.height;
      const xw = parseFloat(this.frame.style.getPropertyValue('--x-width'));
      const xh = parseFloat(this.frame.style.getPropertyValue('--x-height'));
      if (this.kind === 'reels' && xw > 0 && xh > 0) {
        w = xw;
        h = xh;
      }
      const side = this.side.getBoundingClientRect().width;
      const room = this.room(this.kind === 'reels' ? fr : rr, w + side, rr.width);
      return { w, h, side, rowW: rr.width, room };
    }

    // After a window resize: measure the upright layout again and turn to the same state.
    reapply() {
      if (!this.turns) return;
      this.stopMotion();
      this.shape.restore();
      this.upright = this.measure();
      this.apply(false);
    }

    // The shape of a turn state: the frame's size (fw × fh), the video's own size (vw × vh,
    // always the upright proportion), its angle, and how the row moves: on the Reels page
    // margins that keep the reel's slot as tall as before (pad), on the post layout how
    // much wider the card gets than its column (widen).
    shapeFor(turns, deg) {
      const { w, h, side, rowW, room } = this.upright;
      if (!isQuarter(turns)) return { fw: w, fh: h, vw: w, vh: h, deg, pad: 0, widen: 0 };
      if (this.kind === 'reels') {
        // The like column on the right, and as much again for the caption on the left.
        const size = reelsSize({ w, h, maxWidth: room - 2 * (side + 16) });
        const pad = Math.max(0, (h - size.height) / 2);
        return { fw: size.width, fh: size.height, vw: size.height, vh: size.width, deg, pad, widen: 0 };
      }
      // The picture keeps the card's height; the popup's row already spans the window, so
      // only a narrower row (single reel and post pages) needs widening.
      const size = postSize({ w, h, panelWidth: side, maxCardWidth: room });
      const needed = size.width + side;
      const widen = rowW < needed - 1 ? needed - rowW : 0;
      return { fw: size.width, fh: h, vw: size.height, vh: size.width, deg, pad: 0, widen };
    }

    // Moves from the shape on screen to the one for this.turns. Every frame of the turn
    // sets every size, so the frame, the video, the inner wrappers and the row all move
    // together. CSS transitions can't do that: position, max sizes, aspect-ratio and
    // custom properties such as --x-height would jump at the start.
    apply(animate) {
      this.stopMotion();
      clearTimeout(this.verifyTimer);
      this.appliedWidth = pageWidth();
      const from = this.geo ?? this.shapeFor(0, 0);
      this.goal = this.shapeFor(this.turns, this.angle);
      this.findSizedInside();
      const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (!animate || reduced) {
        this.settle();
        return;
      }
      this.widening = from.widen > 0 || this.goal.widen > 0;
      const start = performance.now();
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / MOTION_MS);
        if (t >= 1) {
          this.settle();
          return;
        }
        this.geo = mix(from, this.goal, ease(t));
        try {
          this.draw(this.geo);
        } catch {
          // Something about the page was unexpected: stay upright rather than half turned.
          this.disable();
          return;
        }
        this.place();
        this.frameId = requestAnimationFrame(step);
      };
      this.fallbackTimer = setTimeout(() => this.settle(), MOTION_FALLBACK_MS);
      step();
    }

    stopMotion() {
      cancelAnimationFrame(this.frameId);
      clearTimeout(this.fallbackTimer);
      this.frameId = 0;
    }

    // Where a turn lands: only the styles that state needs, and a check that the page took
    // them. Upright, everything is put back; a half turn only turns the video.
    settle() {
      this.stopMotion();
      const goal = this.goal;
      this.angle = angleFor(this.turns); // four quarter turns the same way are upright again
      this.shape.restore();
      this.geo = null;
      if (this.turns) {
        this.geo = { ...goal, deg: this.angle };
        try {
          if (isQuarter(this.turns)) {
            this.widening = goal.widen > 0;
            this.draw(this.geo);
            this.verifySoon(goal.fw);
          } else {
            this.shape.set(this.video, 'transform', `rotate(${this.angle}deg)`);
          }
        } catch {
          this.disable();
          return;
        }
      }
      this.place();
    }

    // Judge the size once nothing on the frame is animating (a transition of the page's own).
    verifySoon(width) {
      clearTimeout(this.verifyTimer);
      const check = () => {
        if (this.frame.getAnimations?.().some((a) => a.playState === 'running')) this.verifyTimer = setTimeout(check, MOTION_MS);
        else this.verify(width);
      };
      check();
    }

    // The frame took the turned width and the card still ends inside the page.
    verify(width) {
      if (this.disabled || !isQuarter(this.turns)) return;
      const fr = this.frame.getBoundingClientRect();
      const sr = this.side.getBoundingClientRect();
      if (Math.abs(fr.width - width) > 2 || sr.right > pageWidth() + 1) this.disable();
    }

    // How wide the turned box may get: centred where it is, inside the content area
    // (right of Instagram's navigation, however wide that is) and inside the page. A
    // popup's row spans its own room, so it caps the card too.
    room(rect, uprightCardWidth, rowW) {
      const area = this.row.closest?.('main')?.getBoundingClientRect();
      const left = Math.max(0, area ? area.left : 0);
      const right = Math.min(pageWidth(), area ? area.right : pageWidth());
      const centre = rect.left + rect.width / 2;
      let room = 2 * Math.min(centre - left, right - centre) - 2 * EDGE_GAP;
      // The popup's row spans the dialog, far wider than its card: that is the card's room.
      if (this.kind === 'post' && rowW > uprightCardWidth + POPUP_ROW_SLACK) room = Math.min(room, rowW - 2 * EDGE_GAP);
      return Math.max(0, room);
    }

    // Elements inside the frame that size themselves: wrappers that read --x-height (the
    // Reels page, signed in), and aspect-ratio boxes (a percentage padding) between the
    // frame and the video, which keep the upright 9:16 shape and would make a widened
    // frame far taller than it is (a black area over the page below).
    findSizedInside() {
      this.sizedInside = [];
      if (this.kind === 'reels') {
        for (const el of this.frame.querySelectorAll('*')) {
          // (Skipping FrameSeek's own elements: the seek bar's host resets everything.)
          if (!el.shadowRoot && el.style?.getPropertyValue('--x-height')) this.sizedInside.push(el);
        }
      }
      this.aspectBoxes = [];
      for (let el = this.video.parentElement; el && el !== this.frame; el = el.parentElement) {
        for (const prop of ['padding-bottom', 'padding-top']) {
          if (el.style.getPropertyValue(prop).endsWith('%')) this.aspectBoxes.push([el, prop]);
        }
      }
    }

    // One moment of a turn, or a quarter turn at rest. The frame takes the shape's size.
    // The video keeps its upright proportion and turns about the frame's centre, shrunk
    // while partway so that its corners stay inside the frame.
    draw(g) {
      const f = (p, v) => this.shape.set(this.frame, p, v);
      const r = (p, v) => this.shape.set(this.row, p, v);
      f('width', `${g.fw}px`);
      f('height', `${g.fh}px`);
      f('max-width', 'none');
      f('max-height', 'none');
      // Longhands only: a shorthand such as `flex` would wipe Instagram's own inline
      // `flex-basis` when it is put back.
      f('flex-grow', '0');
      f('flex-shrink', '0');
      f('flex-basis', 'auto');
      if (this.kind === 'reels') {
        f('align-self', 'center');
        // Keep the reel's slot as tall as before, so the next reel doesn't slide up.
        r('margin-top', `${g.pad}px`);
        r('margin-bottom', `${g.pad}px`);
        for (const el of this.sizedInside) this.shape.set(el, '--x-height', `${g.fh}px`);
      } else {
        f('aspect-ratio', 'auto');
        if (this.widening) {
          // The card overflows its column evenly, so the column and the grid below stay.
          r('width', `${this.upright.rowW + g.widen}px`);
          r('max-width', 'none');
          r('flex-shrink', '0');
          r('margin-left', `${-g.widen / 2}px`);
          r('margin-right', `${-g.widen / 2}px`);
        }
      }
      for (const [el, prop] of this.aspectBoxes) this.shape.set(el, prop, `${(g.fh / g.fw) * 100}%`);
      const scale = fitScale(g);
      const v = (p, val) => this.shape.set(this.video, p, val);
      v('position', 'absolute');
      v('width', `${g.vw}px`);
      v('height', `${g.vh}px`);
      v('max-width', 'none');
      v('max-height', 'none');
      v('left', '50%');
      v('top', '50%');
      v('transform', `translate(-50%, -50%) rotate(${g.deg}deg)${scale < 0.9995 ? ` scale(${scale})` : ''}`);
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
    fitScale,
    StyleLedger,
    findLayout,
    attach,
  });
})();
