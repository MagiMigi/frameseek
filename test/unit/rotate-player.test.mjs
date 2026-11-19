// The Rotator against a small fake page shaped like the Reels layout. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakeStyle {
  constructor(init = {}) {
    this.map = new Map(Object.entries(init).map(([k, v]) => [k, { value: v, priority: '' }]));
  }
  getPropertyValue(p) {
    return this.map.get(p)?.value ?? '';
  }
  getPropertyPriority(p) {
    return this.map.get(p)?.priority ?? '';
  }
  setProperty(p, value, priority = '') {
    this.map.set(p, { value: String(value), priority });
  }
  removeProperty(p) {
    this.map.delete(p);
  }
  // A stable text form to compare before and after.
  get text() {
    return [...this.map].map(([k, v]) => `${k}:${v.value}${v.priority ? '!' : ''}`).sort().join(';');
  }
  set cssText(_) {}
}

class FakeNode extends EventTarget {
  constructor(tag, { rect = { left: 0, top: 0, width: 0, height: 0 }, style = {}, attrs = {}, computed = {} } = {}) {
    super();
    this.tagName = tag.toUpperCase();
    this.localName = tag;
    this.children = [];
    this.parentElement = null;
    this.style = new FakeStyle(style);
    this.rect = rect;
    this.attrs = { ...attrs };
    this.computed = { display: 'block', flexDirection: 'row', position: 'relative', color: 'rgb(245, 245, 245)', ...computed };
    this.root = false;
    this.clientLeft = 0;
    this.clientTop = 0;
    this.scrollLeft = 0;
    this.scrollTop = 0;
    this.shadowRoot = null;
  }
  get isConnected() {
    let n = this;
    while (n.parentElement) n = n.parentElement;
    return n.root;
  }
  get offsetParent() {
    return this.parentElement;
  }
  // Layout honours an inline px width/height, unless this node resists (as a page whose
  // CSS forces its own size would).
  getBoundingClientRect() {
    const { left, top } = this.rect;
    let { width, height } = this.rect;
    if (!this.resists && !this.animating) {
      const w = parseFloat(this.style.getPropertyValue('width'));
      const h = parseFloat(this.style.getPropertyValue('height'));
      if (this.style.getPropertyValue('width').endsWith('px') && w >= 0) width = w;
      if (this.style.getPropertyValue('height').endsWith('px') && h >= 0) height = h;
    }
    return { left, top, width, height, right: left + width, bottom: top + height };
  }
  closest(sel) {
    for (let n = this; n; n = n.parentElement) if (n.matches?.(sel)) return n;
    return null;
  }
  // While `animating`, a transition is still running (or the window isn't being drawn).
  getAnimations() {
    return this.animating ? [{ playState: 'running' }] : [];
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return this.attrs[k] ?? null;
  }
  append(...kids) {
    for (const k of kids) {
      if (k.parentElement) k.remove();
      k.parentElement = this;
      this.children.push(k);
    }
  }
  appendChild(k) {
    this.append(k);
    return k;
  }
  remove() {
    if (!this.parentElement) return;
    const p = this.parentElement;
    p.children = p.children.filter((c) => c !== this);
    this.parentElement = null;
  }
  contains(n) {
    for (let x = n; x; x = x.parentElement) if (x === this) return true;
    return false;
  }
  *descendants() {
    for (const c of this.children) {
      yield c;
      yield* c.descendants();
    }
  }
  matches(sel) {
    return sel.split(',').some((s) => {
      s = s.trim();
      if (s === '*') return true;
      const m = s.match(/^([a-z]+)?(?:\[([a-z-]+)\])?$/);
      if (!m) return false;
      const [, tag, attr] = m;
      return (!tag || this.localName === tag) && (!attr || attr in this.attrs);
    });
  }
  querySelector(sel) {
    for (const d of this.descendants()) if (d.matches(sel)) return d;
    return null;
  }
  querySelectorAll(sel) {
    return [...this.descendants()].filter((d) => d.matches(sel));
  }
  attachShadow() {
    this.shadowRoot = new FakeNode('#shadow');
    return this.shadowRoot;
  }
  blur() {}
}

globalThis.document = {
  createElement: (tag) => new FakeNode(tag),
  createElementNS: (_ns, tag) => new FakeNode(tag),
  body: null,
};
globalThis.getComputedStyle = (el) => el.computed;
globalThis.location = { pathname: '/reels/abc/' };
globalThis.innerWidth = 1920;
globalThis.innerHeight = 901;
globalThis.matchMedia = () => ({ matches: true }); // reduced motion: no transitions in these tests
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
// Window listeners, so tests can fire scroll events and inspect capture-phase shields.
const winListeners = {};
globalThis.addEventListener = (type, fn) => (winListeners[type] ||= new Set()).add(fn);
globalThis.removeEventListener = (type, fn) => winListeners[type]?.delete(fn);
const tick = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

await import('../../src/content/rotate.js');
const { attach } = globalThis.FrameSeekRotate;

// The Reels layout from the spike: a flex row holding the frame (487×869, sized from
// --x-width/--x-height) and the 60 px like column; an inner wrapper also sets --x-height.
function reelsPage() {
  const page = new FakeNode('div', { rect: { left: 0, top: 0, width: 1920, height: 901 } });
  page.root = true;
  const row = new FakeNode('div', { rect: { left: 709, top: 16, width: 556, height: 869 }, computed: { display: 'flex' } });
  const frame = new FakeNode('div', {
    rect: { left: 709, top: 16, width: 487, height: 869 },
    style: { '--x-width': '487px', '--x-height': '869px' },
  });
  const wrapper = new FakeNode('div', { rect: { left: 709, top: 16, width: 487, height: 869 }, style: { '--x-height': '869px' } });
  const video = new FakeNode('video', {
    rect: { left: 709, top: 16, width: 487, height: 869 },
    style: { 'object-fit': 'cover', display: 'block' },
  });
  video.duration = 13;
  const side = new FakeNode('div', { rect: { left: 1205, top: 16, width: 60, height: 869 } });
  side.append(new FakeNode('svg', { attrs: { 'aria-label': 'Like' } }));
  wrapper.append(video);
  frame.append(wrapper);
  row.append(frame, side);
  page.append(row);
  return { page, row, frame, wrapper, video, side };
}

const texts = (els) => els.map((e) => e.style.text);

test('a quarter turn reshapes the frame and the inner wrapper', () => {
  const { row, frame, wrapper, video } = reelsPage();
  const rot = attach(video, {});
  assert.ok(rot, 'the Reels layout is recognised');
  rot.turn(-1);
  assert.equal(frame.style.getPropertyValue('width'), '869px');
  assert.equal(frame.style.getPropertyValue('height'), '487px');
  assert.equal(wrapper.style.getPropertyValue('--x-height'), '487px');
  assert.equal(row.style.getPropertyValue('margin-top'), '191px');
  assert.equal(row.style.getPropertyValue('margin-bottom'), '191px');
  assert.match(video.style.getPropertyValue('transform'), /rotate\(-90deg\)/);
  rot.destroy();
});

test("the turn leaves FrameSeek's own seek bar element alone", () => {
  // The seek bar's host resets everything (all: initial), so it reports --x-height too.
  const { frame, video } = reelsPage();
  const barHost = new FakeNode('div', { style: { '--x-height': 'initial' } });
  barHost.attachShadow();
  frame.append(barHost);
  const rot = attach(video, {});
  rot.turn(-1);
  assert.equal(barHost.style.getPropertyValue('--x-height'), 'initial');
  rot.destroy();
});

test("the caption's own small boxes keep their size", () => {
  // Signed in, the caption hangs off the frame's left and is part of the frame. A collab
  // line's person icon sizes itself with --x-height: 12px; turned to the reel's height,
  // it stretched the caption's header and pushed the caption text out of view.
  const { frame, video } = reelsPage();
  const caption = new FakeNode('div');
  const icon = new FakeNode('div', { style: { '--x-height': '12px', '--x-width': '12px' } });
  caption.append(icon);
  frame.children.unshift(caption);
  caption.parentElement = frame;
  const rot = attach(video, {});
  rot.turn(-1);
  assert.equal(icon.style.text, '--x-height:12px;--x-width:12px');
  assert.equal(rot.pageChanged(), false, 'the icon is no wrapper waiting to follow the turn');
  rot.destroy();
});

// A wide reel as Instagram lays it out (measured 2026-11-19): the reels list scrolls; a wide
// reel's slot is as tall as the list and centres the row's parent, which keeps 16 px above
// and below the row. Tall reels get a slot only as tall as they are. The list here is 841 px,
// below a 60 px top bar in the 901 px window.
function wideReelPage() {
  const page = new FakeNode('div', { rect: { left: 0, top: 0, width: 1920, height: 901 } });
  page.root = true;
  const list = new FakeNode('div', { rect: { left: 0, top: 60, width: 1920, height: 841 }, computed: { overflowY: 'auto' } });
  list.clientHeight = 841;
  const slot = new FakeNode('div', { rect: { left: 0, top: 60, width: 1920, height: 841 }, computed: { display: 'flex' } });
  const holder = new FakeNode('div', { rect: { left: 340, top: 143, width: 1214, height: 675 }, computed: { paddingTop: '16px', paddingBottom: '16px' } });
  const row = new FakeNode('div', { rect: { left: 340, top: 159, width: 1214, height: 643 }, computed: { display: 'flex' } });
  const frame = new FakeNode('div', {
    rect: { left: 340, top: 159, width: 1142, height: 643 },
    style: { '--x-width': '1142px', '--x-height': '643px' },
  });
  const wrapper = new FakeNode('div', { rect: { left: 340, top: 159, width: 1142, height: 643 }, style: { '--x-height': '643px' } });
  const video = new FakeNode('video', { rect: { left: 340, top: 159, width: 1142, height: 643 } });
  video.duration = 20;
  const side = new FakeNode('div', { rect: { left: 1494, top: 159, width: 60, height: 643 } });
  side.append(new FakeNode('svg', { attrs: { 'aria-label': 'Like' } }));
  wrapper.append(video);
  frame.append(wrapper);
  row.append(frame, side);
  holder.append(row);
  slot.append(holder);
  list.append(slot);
  page.append(list);
  return { page, list, slot, holder, row, frame, wrapper, video, side };
}

test('a wide reel turned upright stays inside its slot', () => {
  const num = (el, prop) => parseFloat(el.style.getPropertyValue(prop));
  const { row, frame, wrapper, video } = wideReelPage();
  const before = texts([row, frame, wrapper, video]);
  const rot = attach(video, {});
  assert.ok(rot, 'the Reels layout is recognised');
  rot.turn(1);
  // As tall as the list less the 16 px kept above and below, in the turned proportion.
  assert.equal(num(frame, 'height'), 809);
  assert.ok(Math.abs(num(frame, 'width') - (809 * 643) / 1142) < 0.01, `frame width ${num(frame, 'width')}`);
  assert.equal(num(wrapper, '--x-height'), 809);
  assert.equal(row.style.getPropertyValue('margin-top'), '0px', 'no margins: the slot is already taller than the reel was');
  assert.match(video.style.getPropertyValue('transform'), /rotate\(90deg\)/);
  rot.turn(-1);
  assert.deepEqual(texts([row, frame, wrapper, video]), before);
  rot.destroy();
});

test('turning back restores every inline style exactly', () => {
  const { row, frame, wrapper, video } = reelsPage();
  const before = texts([row, frame, wrapper, video]);
  const rot = attach(video, {});
  rot.turn(-1);
  rot.turn(1);
  assert.deepEqual(texts([row, frame, wrapper, video]), before);
  rot.destroy();
});

// With motion on, a clock and animation frames that the test moves on by hand.
function manualFrames() {
  let clock = 0;
  let next = 1;
  const queue = new Map();
  const saved = {
    matchMedia: globalThis.matchMedia,
    raf: globalThis.requestAnimationFrame,
    caf: globalThis.cancelAnimationFrame,
    performance: globalThis.performance,
  };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = (fn) => {
    queue.set(next, fn);
    return next++;
  };
  globalThis.cancelAnimationFrame = (id) => queue.delete(id);
  Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true, writable: true });
  return {
    // Moves the clock to `ms` and draws one animation frame.
    at(ms) {
      clock = ms;
      const fns = [...queue.values()];
      queue.clear();
      for (const fn of fns) fn(ms);
    },
    restore() {
      globalThis.matchMedia = saved.matchMedia;
      globalThis.requestAnimationFrame = saved.raf;
      globalThis.cancelAnimationFrame = saved.caf;
      Object.defineProperty(globalThis, 'performance', { value: saved.performance, configurable: true, writable: true });
    },
  };
}

const px = (el, prop) => parseFloat(el.style.getPropertyValue(prop));
const angleOf = (video) => parseFloat(video.style.getPropertyValue('transform').match(/rotate\((-?[\d.]+)deg\)/)?.[1] ?? 'NaN');
const scaleOf = (video) => parseFloat(video.style.getPropertyValue('transform').match(/scale\(([\d.]+)\)/)?.[1] ?? '1');

test('with motion, a turn starts from the upright picture and ends as the instant turn does', () => {
  const frames = manualFrames();
  try {
    const { row, frame, wrapper, video } = reelsPage();
    const before = texts([row, frame, wrapper, video]);
    const rot = attach(video, {});
    rot.turn(-1);
    // The first frame looks like the upright reel: the same size, not turned yet.
    assert.equal(px(frame, 'width'), 487);
    assert.equal(px(frame, 'height'), 869);
    assert.equal(px(video, 'width'), 487);
    assert.equal(px(video, 'height'), 869);
    assert.equal(angleOf(video), 0);
    frames.at(300);
    assert.equal(frame.style.getPropertyValue('width'), '869px');
    assert.equal(frame.style.getPropertyValue('height'), '487px');
    assert.equal(wrapper.style.getPropertyValue('--x-height'), '487px');
    assert.equal(row.style.getPropertyValue('margin-top'), '191px');
    assert.equal(angleOf(video), -90);
    assert.equal(scaleOf(video), 1);
    for (const el of [row, frame, wrapper, video]) assert.equal(el.style.getPropertyValue('transition-property'), '', 'no CSS transitions');
    rot.turn(1);
    frames.at(450);
    frames.at(600);
    assert.deepEqual(texts([row, frame, wrapper, video]), before);
    rot.destroy();
  } finally {
    frames.restore();
  }
});

test('halfway through a turn, everything is halfway and the picture stays inside the frame', () => {
  const frames = manualFrames();
  try {
    const { row, frame, wrapper, video } = reelsPage();
    const rot = attach(video, {});
    rot.turn(-1);
    frames.at(150);
    const fw = px(frame, 'width');
    const fh = px(frame, 'height');
    assert.ok(fw > 500 && fw < 860, `frame width ${fw}`);
    assert.ok(fh > 500 && fh < 860, `frame height ${fh}`);
    assert.equal(px(wrapper, '--x-height'), fh, 'the inner wrapper follows the frame');
    const margin = px(row, 'margin-top');
    assert.ok(margin > 10 && margin < 180, `row margin ${margin}`);
    const deg = angleOf(video);
    assert.ok(deg < -20 && deg > -70, `angle ${deg}`);
    // The turned picture's bounding box fits in the frame (it would reach over the like column).
    const r = (deg * Math.PI) / 180;
    const [vw, vh, s] = [px(video, 'width'), px(video, 'height'), scaleOf(video)];
    const bw = s * (vw * Math.abs(Math.cos(r)) + vh * Math.abs(Math.sin(r)));
    const bh = s * (vw * Math.abs(Math.sin(r)) + vh * Math.abs(Math.cos(r)));
    assert.ok(bw <= fw + 0.5 && bh <= fh + 0.5, `picture ${bw.toFixed(0)}×${bh.toFixed(0)} in frame ${fw.toFixed(0)}×${fh.toFixed(0)}`);
    assert.ok(s < 0.95, 'the picture shrinks to fit while it is turned partway');
    rot.destroy();
  } finally {
    frames.restore();
  }
});

test('turning back, the inner wrapper follows the frame the whole way', () => {
  // The wrapper holds the turned height when the turn back starts, not the reel's: it must
  // still be known as the reel's wrapper, or it stays short until the end and then jumps.
  const frames = manualFrames();
  try {
    const { frame, wrapper, video } = reelsPage();
    const rot = attach(video, {});
    rot.turn(-1);
    frames.at(300);
    rot.turn(1);
    frames.at(450);
    const fh = px(frame, 'height');
    assert.ok(fh > 500 && fh < 860, `frame height ${fh}`);
    assert.equal(px(wrapper, '--x-height'), fh, 'the inner wrapper is as tall as the frame halfway back');
    frames.at(600);
    assert.equal(wrapper.style.text, '--x-height:869px');
    rot.destroy();
  } finally {
    frames.restore();
  }
});

test('a click during a turn carries on from where the picture is', () => {
  const frames = manualFrames();
  try {
    const { row, frame, wrapper, video } = reelsPage();
    const before = texts([row, frame, wrapper, video]);
    const rot = attach(video, {});
    rot.turn(-1);
    frames.at(150);
    const mid = { width: px(frame, 'width'), angle: angleOf(video) };
    rot.turn(1); // back, from halfway
    assert.ok(Math.abs(px(frame, 'width') - mid.width) < 0.01, 'no jump in size');
    assert.ok(Math.abs(angleOf(video) - mid.angle) < 0.01, 'no jump in angle');
    frames.at(300);
    const back = { width: px(frame, 'width'), angle: angleOf(video) };
    assert.ok(back.width < mid.width && back.angle > mid.angle, 'heading back upright');
    rot.turn(-1); // and again, while turning back
    assert.ok(Math.abs(px(frame, 'width') - back.width) < 0.01, 'no jump in size the second time');
    assert.ok(Math.abs(angleOf(video) - back.angle) < 0.01, 'no jump in angle the second time');
    frames.at(600);
    assert.equal(frame.style.getPropertyValue('width'), '869px');
    assert.equal(angleOf(video), -90);
    rot.turn(1);
    frames.at(900);
    assert.deepEqual(texts([row, frame, wrapper, video]), before);
    rot.destroy();
  } finally {
    frames.restore();
  }
});

test('two turns the same way end upside down, turning the short way each time', () => {
  const frames = manualFrames();
  try {
    const { frame, video } = reelsPage();
    const rot = attach(video, {});
    rot.turn(-1);
    frames.at(300);
    rot.turn(-1);
    frames.at(450);
    const deg = angleOf(video);
    assert.ok(deg < -100 && deg > -170, `on its way from -90 to -180, not back through 0: ${deg}`);
    frames.at(600);
    assert.equal(frame.style.getPropertyValue('width'), '', 'the frame is upright again');
    assert.match(video.style.getPropertyValue('transform'), /^rotate\((180|-180)deg\)$/);
    rot.destroy();
  } finally {
    frames.restore();
  }
});

test('with motion, the post card widens frame by frame and is put back exactly', () => {
  const frames = manualFrames();
  try {
    const { row, frame, video } = postPage();
    const before = texts([row, frame, video]);
    const rot = attach(video, {});
    rot.turn(-1);
    frames.at(150);
    const rw = px(row, 'width');
    assert.ok(rw > 570 && rw < 604, `the card is partway wider: ${rw}`);
    assert.ok(px(row, 'margin-left') < 0 && px(row, 'margin-left') > -17, 'and stays centred');
    frames.at(300);
    assert.equal(frame.style.getPropertyValue('width'), '304px');
    assert.equal(row.style.getPropertyValue('width'), '604px');
    rot.turn(1);
    frames.at(600);
    assert.deepEqual(texts([row, frame, video]), before);
    rot.destroy();
  } finally {
    frames.restore();
  }
});

test('a window that draws no frames still finishes the turn', async () => {
  const frames = manualFrames(); // frames.at() is never called: no animation frame runs
  try {
    const { frame, video } = reelsPage();
    const rot = attach(video, {});
    rot.turn(-1);
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(frame.style.getPropertyValue('width'), '869px');
    assert.equal(angleOf(video), -90);
    rot.destroy();
  } finally {
    frames.restore();
  }
});

test('the size check waits for the turn to finish animating', async () => {
  globalThis.matchMedia = () => ({ matches: false });
  try {
    const { row, frame, video } = reelsPage();
    frame.animating = true; // the frame is still growing (or the window isn't being drawn)
    const rot = attach(video, {});
    rot.turn(-1);
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(rot.turns, 3, 'not given up while still animating');
    assert.ok(row.children.some((c) => c.shadowRoot), 'arrows kept');
    frame.animating = false;
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(rot.turns, 3, 'the finished size passes the check');
    rot.destroy();
  } finally {
    globalThis.matchMedia = () => ({ matches: true });
  }
});

// Instagram re-renders a reel a moment after a zoom or a window resize, sometimes after
// FrameSeek re-applied the turn: React writes the reel's new upright size onto the frame and
// the inner wrapper (setProperty with no priority, which replaces FrameSeek's value).
function instagramResizes({ frame, wrapper }, w, h) {
  frame.style.setProperty('--x-width', `${w}px`);
  frame.style.setProperty('--x-height', `${h}px`);
  wrapper.style.setProperty('--x-height', `${h}px`);
}

test("a turned reel follows Instagram's new size after a zoom", () => {
  const nodes = reelsPage();
  const { row, frame, wrapper, video } = nodes;
  const rot = attach(video, {});
  rot.turn(-1);
  instagramResizes(nodes, 330, 587);
  assert.equal(rot.ensure(), true);
  assert.equal(frame.style.getPropertyValue('width'), '587px');
  assert.equal(frame.style.getPropertyValue('height'), '330px');
  assert.equal(wrapper.style.getPropertyValue('--x-height'), '330px', 'the wrapper follows the turn again');
  assert.equal(row.style.getPropertyValue('margin-top'), '128.5px', "the slot is as tall as Instagram's new reel");
  rot.turn(1);
  assert.equal(wrapper.style.text, '--x-height:587px', "turning back leaves Instagram's new size");
  assert.equal(frame.style.text, '--x-height:587px;--x-width:330px');
  rot.destroy();
});

test('a turned reel picks up a wrapper Instagram added', () => {
  const nodes = reelsPage();
  const { wrapper, video } = nodes;
  const rot = attach(video, {});
  rot.turn(-1);
  const added = new FakeNode('div', { style: { '--x-height': '869px' } });
  wrapper.append(added);
  rot.ensure();
  assert.equal(added.style.getPropertyValue('--x-height'), '487px');
  rot.destroy();
  assert.equal(added.style.text, '--x-height:869px');
});

test('a turned post card takes back a style Instagram replaced', () => {
  const { frame, video } = postPage();
  frame.style.setProperty('max-width', '270px');
  const rot = attach(video, {});
  rot.turn(-1);
  frame.style.setProperty('max-width', '300px'); // the popup re-rendered at a new size
  rot.ensure();
  assert.equal(frame.style.getPropertyValue('max-width'), 'none');
  rot.turn(1);
  assert.equal(frame.style.getPropertyValue('max-width'), '300px');
  rot.destroy();
});

test("Instagram's changes are put right at once, not at the next scan", () => {
  // A stand-in for MutationObserver: the test delivers the records by hand.
  const observers = [];
  globalThis.MutationObserver = class {
    constructor(cb) {
      this.cb = cb;
      this.target = null;
      observers.push(this);
    }
    observe(target, options) {
      this.target = target;
      this.options = options;
    }
    disconnect() {
      this.target = null;
    }
  };
  try {
    const nodes = reelsPage();
    const { row, frame, wrapper, video } = nodes;
    const rot = attach(video, {});
    const watching = () => observers.filter((o) => o.target);
    assert.equal(watching().length, 0, 'nothing watched while upright');
    rot.turn(-1);
    assert.deepEqual(watching().map((o) => o.target), [row], 'the row is watched while turned');
    assert.equal(watching()[0].options.subtree, true);
    instagramResizes(nodes, 330, 587);
    watching()[0].cb([]);
    assert.equal(wrapper.style.getPropertyValue('--x-height'), '330px');
    assert.equal(frame.style.getPropertyValue('width'), '587px');
    rot.turn(1);
    assert.equal(watching().length, 0, 'not watched once upright again');
    rot.destroy();
  } finally {
    delete globalThis.MutationObserver;
  }
});

test('onChange reports the turns', () => {
  const { video } = reelsPage();
  const calls = [];
  const rot = attach(video, { onChange: (t) => calls.push(t) });
  rot.turn(-1);
  rot.turn(1);
  assert.deepEqual(calls, [3, 0]);
  rot.destroy();
});

test('on the Reels page the arrows are positioned in the row, inside the reels list', () => {
  // The row's own positioning box is outside the scrolling reels list: arrows placed
  // against it weren't clipped by the list, and every loaded reel's arrows made the page
  // taller. The row (position: static on Instagram) becomes their positioning box.
  const { row, video } = reelsPage();
  row.computed.position = 'static';
  const before = row.style.text;
  const rot = attach(video, {});
  assert.equal(row.style.getPropertyValue('position'), 'relative');
  rot.turn(1);
  rot.turn(-1);
  assert.equal(row.style.getPropertyValue('position'), 'relative', 'a turn and back leave it');
  row.style.removeProperty('position'); // React wrote the row's style again
  rot.ensure();
  assert.equal(row.style.getPropertyValue('position'), 'relative', 'put back at the next scan');
  rot.destroy();
  assert.equal(row.style.text, before);
});

test('destroy restores and removes the arrows', () => {
  const { row, frame, wrapper, video } = reelsPage();
  const before = texts([row, frame, wrapper, video]);
  const rot = attach(video, {});
  rot.turn(1);
  const host = row.children.find((c) => c.shadowRoot);
  assert.ok(host, 'the arrows were added');
  rot.destroy();
  assert.deepEqual(texts([row, frame, wrapper, video]), before);
  assert.equal(row.children.includes(host), false);
});

// The post card: a static frame (270×480) with a 300 px comments panel beside it.
function postPage() {
  const page = new FakeNode('div', { rect: { left: 0, top: 0, width: 700, height: 901 } });
  page.root = true;
  const row = new FakeNode('div', { rect: { left: 65, top: 36, width: 570, height: 480 }, computed: { display: 'flex' } });
  const frame = new FakeNode('div', { rect: { left: 65, top: 36, width: 270, height: 480 }, computed: { position: 'static' } });
  const video = new FakeNode('video', { rect: { left: 65, top: 36, width: 270, height: 480 }, style: { display: 'block' } });
  video.duration = 20;
  const side = new FakeNode('div', { rect: { left: 335, top: 36, width: 300, height: 480 } });
  side.append(new FakeNode('svg', { attrs: { 'aria-label': 'Like' } }), new FakeNode('textarea'));
  frame.append(video);
  row.append(frame, side);
  page.append(row);
  return { row, frame, video };
}

test("the post card is capped by the page's width, not the window's", () => {
  // In some windows innerWidth counts more than the page really has (zoom, emulation).
  globalThis.document.documentElement = { clientWidth: 700 };
  try {
    const { frame, video } = postPage();
    const rot = attach(video, {});
    assert.ok(rot, 'the post layout is recognised');
    rot.turn(-1);
    // Card centred at 350 on a 700 px page: 2 × 350 − 2 × 48 = 604 for the card, 304 for the video.
    assert.equal(frame.style.getPropertyValue('width'), '304px');
    rot.destroy();
  } finally {
    delete globalThis.document.documentElement;
  }
});

test('ensure re-applies the turn when the page width changed without a resize event', () => {
  const doc = { clientWidth: 1920 };
  globalThis.document.documentElement = doc;
  // Move the card so it is centred at x, as the page's layout would.
  const centreAt = (nodes, x) => {
    const dx = x - (nodes.row.rect.left + nodes.row.rect.width / 2);
    for (const n of [nodes.row, nodes.frame, nodes.video, nodes.side]) n.rect = { ...n.rect, left: n.rect.left + dx };
  };
  try {
    const nodes = postPage();
    nodes.side = nodes.row.children[1];
    centreAt(nodes, 960);
    const { frame, video } = nodes;
    const rot = attach(video, {});
    rot.turn(-1);
    const wide = frame.style.getPropertyValue('width');
    doc.clientWidth = 700;
    centreAt(nodes, 350);
    assert.equal(rot.ensure(), true);
    assert.equal(frame.style.getPropertyValue('width'), '304px');
    assert.notEqual(wide, '304px');
    rot.destroy();
  } finally {
    delete globalThis.document.documentElement;
  }
});

const arrowOf = (row, cls) => row.children.find((c) => c.shadowRoot).shadowRoot.children.find((c) => c.attrs.class === cls);
function clickEvent() {
  const ev = new Event('click');
  Object.defineProperty(ev, 'detail', { value: 1 });
  return ev;
}

test('a double click on an arrow cannot reach the page under it', async () => {
  // After the first click the arrow moves with the frame: the second click must not reach
  // Instagram's video, comments, or a popup's backdrop (which closes the popup). Everything
  // at the old spot is swallowed for half a second, the arrow's own events included, since
  // a press that starts on the arrow can end on the page as the arrow moves away.
  const { row, video } = reelsPage();
  const rot = attach(video, {});
  const host = row.children.find((c) => c.shadowRoot);
  const btn = arrowOf(row, 'l');
  btn.rect = { left: 680, top: 10, width: 30, height: 30 };
  btn.dispatchEvent(clickEvent());
  const shields = () => [...(winListeners.pointerdown ?? [])];
  assert.ok(shields().length > 0, 'a shield listens on the window');
  const hit = (x, y, path = []) => {
    let stopped = false;
    const ev = {
      clientX: x,
      clientY: y,
      composedPath: () => path,
      stopImmediatePropagation: () => { stopped = true; },
      stopPropagation() {},
      preventDefault() {},
    };
    for (const fn of shields()) fn(ev);
    return stopped;
  };
  assert.equal(hit(695, 25), true, 'where the arrow was');
  assert.equal(hit(695, 25, [host]), true, 'even on the arrow itself');
  assert.equal(hit(1000, 500), false, 'elsewhere');
  await new Promise((r) => setTimeout(r, 560));
  assert.equal(shields().length, 0, 'gone after half a second');
  rot.destroy();
});

test("the popup frame keeps Instagram's own flex-basis", () => {
  const { frame, video } = postPage();
  frame.style.setProperty('flex-basis', '270px');
  frame.style.setProperty('max-width', '270px');
  frame.style.setProperty('aspect-ratio', '9 / 16');
  const before = frame.style.text;
  const rot = attach(video, {});
  rot.turn(-1);
  assert.equal(frame.style.getPropertyValue('flex'), '', 'no flex shorthand');
  assert.equal(frame.style.getPropertyValue('flex-basis'), 'auto');
  rot.turn(1);
  assert.equal(frame.style.text, before);
  rot.destroy();
});

test("in a popup the turned card leaves room for the arrows inside the popup's row", () => {
  // The popup's row spans the dialog (1777 px). An arrow reaches 27 px past the card;
  // right at the row's edge it can't be clicked, and the click closes the popup.
  const page = new FakeNode('div', { rect: { left: 0, top: 0, width: 1920, height: 901 } });
  page.root = true;
  const row = new FakeNode('div', { rect: { left: 64, top: 24, width: 1777, height: 853 }, computed: { display: 'flex' } });
  const frame = new FakeNode('div', { rect: { left: 463, top: 24, width: 480, height: 853 } });
  const video = new FakeNode('video', { rect: { left: 463, top: 24, width: 480, height: 853 } });
  const side = new FakeNode('div', { rect: { left: 942, top: 24, width: 500, height: 853 } });
  side.append(new FakeNode('svg', { attrs: { 'aria-label': 'Like' } }), new FakeNode('form'));
  frame.append(video);
  row.append(frame, side);
  page.append(row);
  const rot = attach(video, {});
  rot.turn(-1);
  // 1777 − 2 × 48 = 1681 for the card, so 1181 for the video beside the 500 px comments.
  assert.equal(Math.round(parseFloat(frame.style.getPropertyValue('width'))), 1181);
  rot.destroy();
});

test('an aspect-ratio box inside the post frame takes the turned proportion', () => {
  // Signed in, a wrapper keeps the video's 9:16 shape with padding-bottom: 177.778%,
  // which would make it far taller than the widened frame.
  const { frame, video } = postPage();
  const box = new FakeNode('div', { style: { 'padding-bottom': '177.778%' } });
  frame.children = [];
  box.append(video);
  frame.append(box);
  const rot = attach(video, {});
  rot.turn(-1);
  const width = parseFloat(frame.style.getPropertyValue('width'));
  const pb = parseFloat(box.style.getPropertyValue('padding-bottom'));
  assert.ok(Math.abs((pb / 100) * width - 480) < 1, `the box is ${((pb / 100) * width).toFixed(1)} px tall, not the frame's 480`);
  rot.turn(1);
  assert.equal(box.style.text, 'padding-bottom:177.778%');
  rot.destroy();
});

test('the post card fits beside a wide navigation column', () => {
  globalThis.document.documentElement = { clientWidth: 1536 };
  try {
    // A 244 px navigation column; the card is centred in the content to its right.
    const page = new FakeNode('div', { rect: { left: 0, top: 0, width: 1536, height: 864 } });
    page.root = true;
    const main = new FakeNode('main', { rect: { left: 244, top: 0, width: 1292, height: 864 } });
    const row = new FakeNode('div', { rect: { left: 597, top: 36, width: 659, height: 576 }, computed: { display: 'flex' } });
    const frame = new FakeNode('div', { rect: { left: 597, top: 36, width: 324, height: 576 } });
    const video = new FakeNode('video', { rect: { left: 597, top: 36, width: 324, height: 576 } });
    const side = new FakeNode('div', { rect: { left: 921, top: 36, width: 335, height: 576 } });
    side.append(new FakeNode('svg', { attrs: { 'aria-label': 'Like' } }), new FakeNode('form'));
    frame.append(video);
    row.append(frame, side);
    main.append(row);
    page.append(main);
    const rot = attach(video, {});
    rot.turn(-1);
    // Centre 926.5: 2 × min(926.5 − 244, 1536 − 926.5) − 2 × 48 = 1123 for the card, 788 for the video.
    assert.equal(Math.round(parseFloat(frame.style.getPropertyValue('width'))), 788);
    rot.destroy();
  } finally {
    delete globalThis.document.documentElement;
  }
});

// A wide video on a post page or in the popup, as Instagram shows it (measured 2026-11-19):
// the frame is a 4:3 or square box, and the 16:9 picture is letterboxed inside it.
function letterboxPage({ rowRect, frameRect, videoRect, sideWidth }) {
  const page = new FakeNode('div', { rect: { left: 0, top: 0, width: 1920, height: 901 } });
  page.root = true;
  const row = new FakeNode('div', { rect: rowRect, computed: { display: 'flex' } });
  const frame = new FakeNode('div', { rect: frameRect });
  const video = new FakeNode('video', { rect: videoRect, style: { display: 'block' }, computed: { objectFit: 'contain' } });
  video.videoWidth = 1920;
  video.videoHeight = 1080;
  video.duration = 23;
  const side = new FakeNode('div', { rect: { left: frameRect.left + frameRect.width, top: frameRect.top, width: sideWidth, height: frameRect.height } });
  side.append(new FakeNode('svg', { attrs: { 'aria-label': 'Like' } }), new FakeNode('textarea'));
  frame.append(video);
  row.append(frame, side);
  page.append(row);
  return { row, frame, video };
}

test('in the popup a wide video turns to its own shape, not the square box', () => {
  // 1920×1080 letterboxed in an 853 px square: turned, the picture is 853 × 1080 / 1920 wide.
  const { row, frame, video } = letterboxPage({
    rowRect: { left: 64, top: 24, width: 1777, height: 853 },
    frameRect: { left: 276, top: 24, width: 853, height: 853 },
    videoRect: { left: 276, top: 211, width: 853, height: 480 },
    sideWidth: 500,
  });
  const rot = attach(video, {});
  rot.turn(1);
  assert.equal(frame.style.getPropertyValue('width'), '479.8125px');
  assert.equal(frame.style.getPropertyValue('height'), '853px');
  assert.equal(video.style.getPropertyValue('width'), '853px');
  assert.equal(video.style.getPropertyValue('height'), '479.8125px');
  assert.equal(row.style.getPropertyValue('width'), '', "the popup's row spans the dialog and centres the card itself");
  rot.destroy();
});

test('on a post page a card that turns narrower stays centred in its column', () => {
  // The single reel page: a 600×450 box beside 335 px of comments, in a 935 px row. The
  // 16:9 picture turned is 450 × 1080 / 1920 = 253.125 wide, so the card is 588.125 wide,
  // 346.875 narrower than the row: 173.4375 px on each side.
  const { row, frame, video } = letterboxPage({
    rowRect: { left: 485, top: 38, width: 935, height: 450 },
    frameRect: { left: 485, top: 38, width: 600, height: 450 },
    videoRect: { left: 485, top: 95, width: 600, height: 338 },
    sideWidth: 335,
  });
  const before = texts([row, frame, video]);
  const rot = attach(video, {});
  rot.turn(1);
  assert.equal(frame.style.getPropertyValue('width'), '253.125px');
  assert.equal(row.style.getPropertyValue('width'), '588.125px');
  assert.equal(row.style.getPropertyValue('margin-left'), '173.4375px');
  assert.equal(row.style.getPropertyValue('margin-right'), '173.4375px');
  rot.turn(-1);
  assert.deepEqual(texts([row, frame, video]), before);
  rot.destroy();
});

test("a card's border doesn't change how much it grows", () => {
  // The row is 2 px wider than picture + comments (a 1 px border each side). Turned, the
  // picture grows from 270 to 304 px, so the card grows by 34 px: 572 → 606.
  const { row, frame, video } = postPage();
  row.rect = { ...row.rect, left: 64, width: 572 }; // still centred at 350
  const rot = attach(video, {});
  rot.turn(-1);
  assert.equal(frame.style.getPropertyValue('width'), '304px');
  assert.equal(row.style.getPropertyValue('width'), '606px');
  assert.equal(row.style.getPropertyValue('margin-left'), '-17px');
  rot.destroy();
});

test("a card that won't widen is put back and loses its arrows", () => {
  const { row, frame, video } = postPage();
  frame.resists = true;
  const before = frame.style.text;
  const changes = [];
  const rot = attach(video, { onChange: (t) => changes.push(t) });
  rot.turn(-1);
  assert.equal(frame.style.text, before);
  assert.equal(rot.turns, 0);
  assert.equal(row.children.some((c) => c.shadowRoot), false, 'no arrows');
  assert.equal(rot.ensure(), true, 'stays attached, inert');
  assert.equal(row.children.some((c) => c.shadowRoot), false, 'still no arrows');
  assert.deepEqual(changes, [3, 0]);
  rot.destroy();
});

test('the arrows follow a scroll', async () => {
  const { row, frame, video } = reelsPage();
  const rot = attach(video, {});
  const host = row.children.find((c) => c.shadowRoot);
  const top = host.style.getPropertyValue('top');
  frame.rect = { ...frame.rect, top: frame.rect.top - 200 };
  for (const fn of winListeners.scroll ?? []) fn(new Event('scroll'));
  await tick();
  assert.notEqual(host.style.getPropertyValue('top'), top);
  rot.destroy();
});

test('no arrows on stories or for an unknown layout', () => {
  const { video } = reelsPage();
  globalThis.location = { pathname: '/stories/someone/1/' };
  assert.equal(attach(video, {}), null);
  globalThis.location = { pathname: '/reels/abc/' };
  const lone = new FakeNode('video');
  const holder = new FakeNode('div');
  holder.append(lone);
  assert.equal(attach(lone, {}), null);
});

test('ensure reports a replaced frame', () => {
  const { page, row, frame, video } = reelsPage();
  const rot = attach(video, {});
  assert.equal(rot.ensure(), true);
  frame.remove(); // Instagram re-rendered: a new frame took its place
  const newFrame = new FakeNode('div');
  newFrame.append(video);
  row.append(newFrame);
  assert.equal(rot.ensure(), false);
  rot.destroy();
  assert.ok(page);
});
