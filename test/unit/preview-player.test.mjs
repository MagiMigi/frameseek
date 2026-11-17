// The hover preview player against fake media elements. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const tick = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

// How each fake file behaves: 'ok' loads and seeks, 'error' fails, 'hang' never loads.
const files = {};
// How much a file's frames differ from the real video's (0 = the same picture).
const shifts = {};
const opened = [];
let draws = []; // every source drawn for a frame check

class FakeEl extends EventTarget {
  constructor() {
    super();
    this.style = {};
    this.parent = null;
    const set = new Set();
    this.classList = {
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
      toggle: (c, on) => (on ? set.add(c) : set.delete(c)),
      contains: (c) => set.has(c),
    };
  }
  setAttribute() {}
  append(...kids) {
    for (const k of kids) k.parent = this;
  }
  remove() {
    this.parent = null;
  }
}

class FakeVideo extends FakeEl {
  constructor() {
    super();
    this._src = '';
    this._time = 0;
    this.duration = NaN;
    this.readyState = 0;
    this.videoWidth = 0;
    this.videoHeight = 0;
    this.seeking = false;
    this.flat = false; // shows a frame with no detail, like a black screen
    this.shift = 0;
    this.released = false;
  }
  get src() {
    return this._src;
  }
  set src(url) {
    this._src = url;
    this.shift = shifts[url] ?? 0;
    opened.push(url);
    setTimeout(() => {
      if (this._src !== url) return;
      const how = files[url] ?? 'ok';
      if (how === 'ok') {
        Object.assign(this, { duration: 13, readyState: 4, videoWidth: 540, videoHeight: 960 });
        this.dispatchEvent(new Event('loadedmetadata'));
      } else if (how === 'error') {
        this.dispatchEvent(new Event('error'));
      }
    }, 0);
  }
  get currentTime() {
    return this._time;
  }
  set currentTime(t) {
    this._time = t;
    setTimeout(() => this.dispatchEvent(new Event('seeked')), 0);
  }
  removeAttribute(name) {
    if (name === 'src') {
      this._src = '';
      this.released = true;
    }
  }
  load() {
    this.dispatchEvent(new Event('emptied'));
  }
}

const players = [];
globalThis.document = {
  createElement(tag) {
    if (tag === 'video') {
      const v = new FakeVideo();
      players.push(v);
      return v;
    }
    if (tag === 'canvas') {
      // A detailed frame, shifted by the source's `shift`, or flat for a `flat` source.
      let last = null;
      return {
        getContext: () => ({
          drawImage(source) {
            last = source;
            draws.push(source);
          },
          getImageData: () => ({
            data: Uint8ClampedArray.from({ length: 16 * 16 * 4 }, (_, i) =>
              last.flat ? 50 : ((i * 7) % 200) + last.shift,
            ),
          }),
        }),
      };
    }
    return new FakeEl();
  },
};

let candidates = []; // a list, or a function returning one
let version = 1;
globalThis.FrameSeekSources = {
  candidatesFor: () => (typeof candidates === 'function' ? candidates() : candidates),
  version: () => version,
};

await import('../../src/content/preview.js');
const { Preview } = globalThis.FrameSeekPreview;

function makeMain() {
  const main = new FakeVideo();
  Object.assign(main, { duration: 13, readyState: 4, videoWidth: 540, videoHeight: 960 });
  return main;
}

test('releasing the preview stops a file that is still loading', async () => {
  files.slow = 'hang';
  candidates = [{ url: 'slow', check: true }];
  const preview = new Preview(makeMain(), new FakeEl());
  preview.hover(3);
  await tick();
  const loading = players.find((p) => p.src === 'slow');
  assert.ok(loading, 'the candidate started loading');
  preview.destroy();
  assert.equal(loading.released, true);
});

test('a remembered file that no longer loads falls back to the list', async () => {
  files.old = 'ok';
  candidates = [{ url: 'old', check: true }];
  const preview = new Preview(makeMain(), new FakeEl());
  preview.hover(3);
  await tick();
  assert.equal(preview.state, 'ready');

  preview.release(); // the mouse left the bar a while ago
  files.old = 'error'; // e.g. its signed URL expired
  files.fresh = 'ok';
  candidates = [{ url: 'fresh', check: true }];
  opened.length = 0;
  preview.hover(4);
  await tick();
  preview.hover(5);
  await tick();
  assert.ok(opened.includes('fresh'), `opened ${JSON.stringify(opened)}`);
  assert.equal(preview.state, 'ready');
  preview.destroy();
});

test('a turned preview rotates its player and uses a landscape box', async () => {
  candidates = [{ url: 'turned', check: true }];
  const preview = new Preview(makeMain(), new FakeEl());
  preview.hover(3);
  await tick();
  assert.equal(preview.state, 'ready');
  preview.setTurns(3);
  preview.place(500, 80, 1000, 600);
  const box = preview.box.style;
  assert.ok(parseFloat(box.width) > parseFloat(box.height), `box ${box.width} × ${box.height} should be wide`);
  assert.match(preview.player.style.transform, /rotate\(-90deg\)/);
  preview.setTurns(0);
  assert.equal(preview.player.style.transform, '');
  preview.destroy();
});

test('no frame check while the real video is still seeking', async () => {
  candidates = [{ url: 'during-seek', check: true }];
  const main = makeMain();
  main.seeking = true; // its picture may still be the old frame
  const preview = new Preview(main, new FakeEl());
  opened.length = 0;
  preview.hover(3);
  await tick();
  assert.deepEqual(opened, []);
  assert.equal(preview.state, 'idle');
  preview.destroy();
});

test('a file listed while a check runs is tried on the next hover', async () => {
  shifts.wrong = 60;
  let calls = 0;
  candidates = () => {
    calls++;
    if (calls > 1) return [{ url: 'right', check: true }];
    setTimeout(() => {
      version++; // the right file shows up in the list while 'wrong' is being checked
    }, 0);
    return [{ url: 'wrong', check: true }];
  };
  const preview = new Preview(makeMain(), new FakeEl());
  preview.hover(3);
  await tick();
  assert.equal(preview.state, 'none');
  preview.hover(4);
  await tick();
  assert.equal(preview.state, 'ready');
  preview.destroy();
});

test('an error while matching does not leave the preview stuck', async () => {
  let calls = 0;
  candidates = () => {
    calls++;
    if (calls === 1) throw new Error('unexpected');
    return [{ url: 'after-error', check: true }];
  };
  const preview = new Preview(makeMain(), new FakeEl());
  preview.hover(3);
  await tick();
  assert.notEqual(preview.state, 'matching');
  await new Promise((r) => setTimeout(r, 350)); // past the retry gap
  preview.hover(4);
  await tick();
  assert.equal(preview.state, 'ready');
  preview.destroy();
});

test('a flat frame is checked again at most every 300 ms', async () => {
  candidates = [{ url: 'later', check: true }];
  const main = makeMain();
  main.flat = true;
  const preview = new Preview(main, new FakeEl());
  draws = [];
  for (let i = 0; i < 4; i++) {
    preview.hover(3 + i * 0.1);
    await tick(2);
  }
  assert.equal(draws.filter((s) => s === main).length, 1);
  await new Promise((r) => setTimeout(r, 350));
  preview.hover(4);
  await tick(2);
  assert.equal(draws.filter((s) => s === main).length, 2);
  preview.destroy();
});

test('setSize resizes a placed box', async () => {
  candidates = [{ url: 'sized', check: true }];
  const preview = new Preview(makeMain(), new FakeEl());
  preview.hover(3);
  await tick();
  preview.place(500, 80, 1000, 600);
  const medium = parseFloat(preview.box.style.width);
  preview.setSize('small');
  const small = parseFloat(preview.box.style.width);
  assert.ok(Math.abs(small - 0.67 * medium) < 0.1, `small ${small} is not 0.67 × medium ${medium}`);
  preview.setSize('large');
  assert.ok(parseFloat(preview.box.style.width) > medium, 'large is bigger than medium');
  preview.destroy();
});

test('a smaller preview size gives a smaller turned box', async () => {
  candidates = [{ url: 'turned-small', check: true }];
  const preview = new Preview(makeMain(), new FakeEl());
  preview.hover(3);
  await tick();
  preview.setTurns(3);
  preview.setSize('medium');
  preview.place(500, 80, 1000, 600);
  const mediumWidth = parseFloat(preview.box.style.width);
  preview.setSize('small');
  preview.place(500, 80, 1000, 600);
  const box = preview.box.style;
  assert.ok(parseFloat(box.width) > parseFloat(box.height), `box ${box.width} × ${box.height} should be wide`);
  assert.ok(parseFloat(box.width) < mediumWidth, 'narrower than at medium');
  assert.match(preview.player.style.transform, /rotate\(-90deg\)/);
  preview.destroy();
});
