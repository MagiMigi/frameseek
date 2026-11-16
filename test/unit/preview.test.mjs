// Frame comparison, box placement and choosing a source for hover preview. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../../src/content/preview.js');
const { frameDiff, frameSpread, boxSize, boxLeft, pickSource, MATCH_MAX_DIFF, MIN_SPREAD } = globalThis.FrameSeekPreview;

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.1, `${actual} is not about ${expected}`);

test('the frame check limits match the measured gap', () => {
  assert.equal(MATCH_MAX_DIFF, 25);
  assert.equal(MIN_SPREAD, 40);
});

test('frameDiff and frameSpread', () => {
  assert.equal(frameDiff([0, 10], [4, 4]), 5);
  assert.equal(frameSpread([3, 50, 9]), 47);
});

test('boxSize fits portrait and landscape videos', () => {
  const portrait = boxSize(400, 711, 0.5625);
  near(portrait.width, 128);
  near(portrait.height, 227.6);
  const landscape = boxSize(470, 264, 16 / 9);
  near(landscape.width, 150.4);
  near(landscape.height, 84.6);
  assert.equal(boxSize(150, 100, 0.5625).width, 80);
});

test('boxLeft keeps the box inside', () => {
  assert.equal(boxLeft(10, 100, 400), 4);
  assert.equal(boxLeft(200, 100, 400), 150);
  assert.equal(boxLeft(395, 100, 400), 296);
});

// A detailed reference frame, and frames that differ from it by a set amount.
const REF = Array.from({ length: 256 }, (_, i) => (i * 7) % 200);
const shifted = (by) => REF.map((v) => v + by);

function fakeOps({ frames = {}, reference = { grey: REF, time: 4.2 }, failOpen = [] } = {}) {
  const calls = { open: [], close: [], reference: 0, frameAt: [] };
  return {
    calls,
    open: async (url, check) => {
      calls.open.push({ url, check });
      return failOpen.includes(url) ? null : { url };
    },
    reference: () => {
      calls.reference++;
      return typeof reference === 'function' ? reference() : reference;
    },
    frameAt: async (player, time) => {
      calls.frameAt.push({ url: player.url, time });
      return frames[player.url] ?? null;
    },
    close: (player) => calls.close.push(player.url),
  };
}

test('pickSource accepts the first checked candidate under the limit', async () => {
  const ops = fakeOps({ frames: { wrong: shifted(60), right: shifted(8) } });
  const result = await pickSource([{ url: 'wrong', check: true }, { url: 'right', check: true }], ops);
  assert.equal(result.candidate.url, 'right');
  assert.equal(result.player.url, 'right');
  assert.deepEqual(ops.calls.close, ['wrong']);
  assert.deepEqual(ops.calls.frameAt.map((c) => c.time), [4.2, 4.2]);
});

test('pickSource accepts an unchecked candidate without a reference frame', async () => {
  const ops = fakeOps();
  const result = await pickSource([{ url: 'plain', check: false }], ops);
  assert.equal(result.candidate.url, 'plain');
  assert.equal(ops.calls.reference, 0);
  assert.deepEqual(ops.calls.close, []);
});

test('pickSource skips a candidate that fails to open', async () => {
  const ops = fakeOps({ frames: { right: shifted(3) }, failOpen: ['expired'] });
  const result = await pickSource([{ url: 'expired', check: true }, { url: 'right', check: true }], ops);
  assert.equal(result.candidate.url, 'right');
  assert.deepEqual(ops.calls.close, []);
});

test('pickSource moves on when a seek never lands', async () => {
  const ops = fakeOps({ frames: { right: shifted(3) } }); // 'stuck' has no frame: frameAt gives null
  const result = await pickSource([{ url: 'stuck', check: true }, { url: 'right', check: true }], ops);
  assert.equal(result.candidate.url, 'right');
  assert.deepEqual(ops.calls.close, ['stuck']);
});

test('pickSource waits for a usable frame before loading anything', async () => {
  const none = fakeOps({ reference: null });
  assert.equal(await pickSource([{ url: 'a', check: true }], none), 'retry');
  assert.deepEqual(none.calls.open, []);

  const flat = fakeOps({ reference: { grey: Array(256).fill(12).map((v, i) => v + (i % 39)), time: 1 } });
  assert.equal(await pickSource([{ url: 'a', check: true }], flat), 'retry');
  assert.deepEqual(flat.calls.open, []);
});

test('pickSource gives up and closes every player when nothing matches', async () => {
  const ops = fakeOps({ frames: { a: shifted(60), b: shifted(73) } });
  assert.equal(await pickSource([{ url: 'a', check: true }, { url: 'b', check: true }], ops), null);
  assert.deepEqual(ops.calls.close, ['a', 'b']);
});
