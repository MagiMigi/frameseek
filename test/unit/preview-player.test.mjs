// The hover preview player against fake media elements. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const tick = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

// How each fake file behaves: 'ok' loads and seeks, 'error' fails, 'hang' never loads.
const files = {};
const opened = [];

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
    this.released = false;
  }
  get src() {
    return this._src;
  }
  set src(url) {
    this._src = url;
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
      // Every frame looks the same and has plenty of detail, so any loaded file matches.
      const data = Uint8ClampedArray.from({ length: 16 * 16 * 4 }, (_, i) => (i * 7) % 200);
      return { getContext: () => ({ drawImage() {}, getImageData: () => ({ data }) }) };
    }
    return new FakeEl();
  },
};

let candidates = [];
globalThis.FrameSeekSources = { candidatesFor: () => candidates, version: () => 1 };

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
