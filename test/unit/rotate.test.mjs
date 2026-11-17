// Turn arithmetic, layout classification, sizes and the style ledger. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../../src/content/rotate.js');
const { nextTurns, angleFor, isQuarter, classifyRow, reelsSize, postSize, fitScale, StyleLedger } = globalThis.FrameSeekRotate;

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.1, `${actual} is not about ${expected}`);

test('turns wrap around', () => {
  assert.equal(nextTurns(0, -1), 3);
  assert.equal(nextTurns(3, 1), 0);
  assert.equal(nextTurns(1, 1), 2);
  assert.equal(angleFor(0), 0);
  assert.equal(angleFor(1), 90);
  assert.equal(angleFor(2), 180);
  assert.equal(angleFor(3), -90);
  assert.equal(isQuarter(1), true);
  assert.equal(isQuarter(3), true);
  assert.equal(isQuarter(2), false);
  assert.equal(isQuarter(0), false);
});

test('classifyRow tells the reels row, the post card and neither apart', () => {
  assert.equal(classifyRow({ sideWidth: 60, sideHasIcons: true, sideHasCommentBox: false }), 'reels');
  assert.equal(classifyRow({ sideWidth: 335, sideHasIcons: true, sideHasCommentBox: true }), 'post');
  assert.equal(classifyRow({ sideWidth: 335, sideHasIcons: true, sideHasCommentBox: false }), null);
  assert.equal(classifyRow({ sideWidth: 60, sideHasIcons: false, sideHasCommentBox: false }), null);
  // A carousel's next slide: wide, no icons, no comment box.
  assert.equal(classifyRow({ sideWidth: 600, sideHasIcons: false, sideHasCommentBox: false }), null);
});

test('reelsSize uses the old height as the new width', () => {
  const full = reelsSize({ w: 487, h: 869, maxWidth: 2000 });
  near(full.width, 869);
  near(full.height, 487);
  const capped = reelsSize({ w: 487, h: 869, maxWidth: 700 });
  near(capped.width, 700);
  near(capped.height, 392.3);
});

test("postSize keeps the card's height until the window caps it", () => {
  const full = postSize({ w: 338, h: 601, panelWidth: 335, maxCardWidth: 1800 });
  near(full.width, 1068.6);
  near(full.height, 601);
  const capped = postSize({ w: 338, h: 601, panelWidth: 335, maxCardWidth: 1200 });
  near(capped.width, 865);
  near(capped.height, 486.5);
});

test('fitScale shrinks a turning picture just enough to stay inside its frame', () => {
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.001, `${actual} is not about ${expected}`);
  close(fitScale({ vw: 487, vh: 869, deg: 0, fw: 487, fh: 869 }), 1);
  close(fitScale({ vw: 487, vh: 869, deg: -90, fw: 869, fh: 487 }), 1);
  close(fitScale({ vw: 487, vh: 869, deg: 180, fw: 487, fh: 869 }), 1);
  // Halfway: a 487×869 picture at 45° needs a 959 px square, and the frame is 678 px.
  close(fitScale({ vw: 487, vh: 869, deg: -45, fw: 678, fh: 678 }), 0.7071);
  assert.equal(fitScale({ vw: 100, vh: 100, deg: 0, fw: 500, fh: 500 }), 1, 'never larger than the picture');
});

class FakeStyle {
  constructor(init = {}) {
    this.map = new Map(Object.entries(init).map(([k, [value, priority = '']]) => [k, { value, priority }]));
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
}

test('StyleLedger keeps a value someone else wrote while it was set', () => {
  // React writes style.x = v, which replaces our !important value.
  const el = { style: new FakeStyle({ '--x-height': ['869px'] }) };
  const ledger = new StyleLedger();
  ledger.set(el, '--x-height', '487px');
  el.style.setProperty('--x-height', '420px');
  ledger.restore();
  assert.equal(el.style.getPropertyValue('--x-height'), '420px');
});

test('StyleLedger set takes a value written from outside as the new previous one', () => {
  const el = { style: new FakeStyle({ width: ['100px'] }) };
  const ledger = new StyleLedger();
  ledger.set(el, 'width', '300px');
  el.style.setProperty('width', '120px'); // Instagram resized it meanwhile
  ledger.set(el, 'width', '310px');
  ledger.restore();
  assert.equal(el.style.getPropertyValue('width'), '120px');
});

test('StyleLedger restores the exact inline styles', () => {
  const el = { style: new FakeStyle({ '--x-height': ['869px'], display: ['block', 'important'] }) };
  const ledger = new StyleLedger();
  ledger.set(el, 'width', '869px');
  ledger.set(el, '--x-height', '487px');
  ledger.set(el, 'display', 'none');
  ledger.set(el, 'width', '900px');
  assert.equal(el.style.getPropertyValue('width'), '900px');
  assert.equal(el.style.getPropertyPriority('width'), 'important');
  assert.equal(el.style.getPropertyValue('--x-height'), '487px');
  assert.equal(ledger.size, 3);

  ledger.restore();
  assert.equal(el.style.getPropertyValue('width'), '');
  assert.equal(el.style.map.has('width'), false);
  assert.equal(el.style.getPropertyValue('--x-height'), '869px');
  assert.equal(el.style.getPropertyPriority('--x-height'), '');
  assert.equal(el.style.getPropertyValue('display'), 'block');
  assert.equal(el.style.getPropertyPriority('display'), 'important');
  assert.equal(ledger.size, 0);
});
