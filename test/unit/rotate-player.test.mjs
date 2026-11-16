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

test('turning back restores every inline style exactly', () => {
  const { row, frame, wrapper, video } = reelsPage();
  const before = texts([row, frame, wrapper, video]);
  const rot = attach(video, {});
  rot.turn(-1);
  rot.turn(1);
  assert.deepEqual(texts([row, frame, wrapper, video]), before);
  rot.destroy();
});

test('with motion, the transitions are gone once the turn back has run', async () => {
  globalThis.matchMedia = () => ({ matches: false });
  try {
    const { row, frame, wrapper, video } = reelsPage();
    const before = texts([row, frame, wrapper, video]);
    const rot = attach(video, {});
    rot.turn(-1);
    assert.match(frame.style.getPropertyValue('transition-property'), /width/);
    rot.turn(1);
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(texts([row, frame, wrapper, video]), before);
    rot.destroy();
  } finally {
    globalThis.matchMedia = () => ({ matches: true });
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

test('onChange reports the turns', () => {
  const { video } = reelsPage();
  const calls = [];
  const rot = attach(video, { onChange: (t) => calls.push(t) });
  rot.turn(-1);
  rot.turn(1);
  assert.deepEqual(calls, [3, 0]);
  rot.destroy();
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
    // Card centred at 350 on a 700 px page: 2 × 350 − 2 × 24 = 652 for the card, 352 for the video.
    assert.equal(frame.style.getPropertyValue('width'), '352px');
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
    assert.equal(frame.style.getPropertyValue('width'), '352px');
    assert.notEqual(wide, '352px');
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

test('a double click on an arrow cannot reach the page under it', () => {
  const { row, video } = reelsPage();
  const rot = attach(video, {});
  const btn = arrowOf(row, 'l');
  btn.rect = { left: 680, top: 10, width: 30, height: 30 };
  btn.dispatchEvent(clickEvent());
  const shields = [...(winListeners.dblclick ?? [])];
  assert.ok(shields.length > 0, 'a shield listens for the second click');
  const hit = (x, y) => {
    let stopped = false;
    const ev = { clientX: x, clientY: y, composedPath: () => [], stopPropagation: () => { stopped = true; }, preventDefault() {} };
    for (const fn of shields) fn(ev);
    return stopped;
  };
  assert.equal(hit(695, 25), true, 'where the arrow was');
  assert.equal(hit(1000, 500), false, 'elsewhere');
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
    // Centre 926.5: 2 × min(926.5 − 244, 1536 − 926.5) − 2 × 24 = 1171 for the card, 836 for the video.
    assert.equal(Math.round(parseFloat(frame.style.getPropertyValue('width'))), 836);
    rot.destroy();
  } finally {
    delete globalThis.document.documentElement;
  }
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
