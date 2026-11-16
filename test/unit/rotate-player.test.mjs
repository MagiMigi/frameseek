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
  getBoundingClientRect() {
    const { left, top, width, height } = this.rect;
    return { left, top, width, height, right: left + width, bottom: top + height };
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
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

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
    assert.match(frame.style.getPropertyValue('transition'), /width/);
    rot.turn(1);
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(texts([row, frame, wrapper, video]), before);
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
    // 700 − 2 × 72 (navigation) − 300 (comments) = 256
    assert.equal(frame.style.getPropertyValue('width'), '256px');
    rot.destroy();
  } finally {
    delete globalThis.document.documentElement;
  }
});

test('ensure re-applies the turn when the page width changed without a resize event', () => {
  const doc = { clientWidth: 1920 };
  globalThis.document.documentElement = doc;
  try {
    const { frame, video } = postPage();
    const rot = attach(video, {});
    rot.turn(-1);
    const wide = frame.style.getPropertyValue('width');
    doc.clientWidth = 700;
    assert.equal(rot.ensure(), true);
    assert.equal(frame.style.getPropertyValue('width'), '256px');
    assert.notEqual(wide, '256px');
    rot.destroy();
  } finally {
    delete globalThis.document.documentElement;
  }
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
