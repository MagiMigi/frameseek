// Finding Instagram's video files in the page's resource timing. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../../src/content/sources.js');
const { decodeEfg, parseEntry, SourceList, start, stop, candidatesFor } = globalThis.FrameSeekSources;

const LABELS = {
  xpv_asset_id: 1127941113300063,
  duration_s: 13,
  bitrate: 134484,
  vencode_tag: 'ig-xpvds.clips.igwww-C3.dash_r2evevp9-r1gen2vp9_q20',
};
const efg = (labels) => Buffer.from(JSON.stringify(labels)).toString('base64url');
const cdnUrl = (labels, extra = '&bytestart=818&byteend=885') =>
  `https://scontent-x.fbcdn.net/o1/v/a.mp4?efg=${efg(labels)}&oh=1${extra}`;

test("decodeEfg reads Instagram's labels", () => {
  assert.deepEqual(decodeEfg(efg(LABELS)), LABELS);
  // Standard base64 with padding, percent-encoded, decodes too.
  const padded = encodeURIComponent(Buffer.from(JSON.stringify(LABELS)).toString('base64'));
  assert.deepEqual(decodeEfg(padded), LABELS);
  assert.equal(decodeEfg('%%%'), null);
});

test('parseEntry strips the byte range and skips audio and other hosts', () => {
  const entry = parseEntry(cdnUrl(LABELS), 42);
  assert.equal(entry.url, `https://scontent-x.fbcdn.net/o1/v/a.mp4?efg=${efg(LABELS)}&oh=1`);
  assert.equal(entry.durationS, 13);
  assert.equal(entry.assetId, '1127941113300063');
  assert.equal(entry.bitrate, 134484);
  assert.equal(entry.at, 42);

  const audio = { ...LABELS, vencode_tag: 'ig-xpvds.clips.igwww-C3.dash_ln_heaac_vbr3_audio' };
  assert.equal(parseEntry(cdnUrl(audio), 42), null);
  assert.equal(parseEntry(cdnUrl(LABELS).replace('scontent-x.fbcdn.net', 'evil.example.com'), 42), null);
  assert.equal(parseEntry(cdnUrl(LABELS, '&byteend=885'), 42), null);
});

const entryFor = (id, durationS, at, bitrate = 100) => ({
  assetId: id,
  durationS,
  bitrate,
  url: `https://x.fbcdn.net/${id}-${bitrate}.mp4`,
  at,
});

test('SourceList picks candidates by length, most recent first', () => {
  const list = new SourceList();
  list.add(entryFor('13a', 13, 10));
  list.add(entryFor('13b', 13, 30));
  list.add(entryFor('12', 12, 20));
  list.add(entryFor('19', 19, 5));
  // 12 is 1.0017 s away from 13.0017, outside the 1 s window.
  assert.deepEqual(list.candidates(13.0017), ['https://x.fbcdn.net/13b-100.mp4', 'https://x.fbcdn.net/13a-100.mp4']);
  assert.deepEqual(list.candidates(12.9), [
    'https://x.fbcdn.net/13b-100.mp4',
    'https://x.fbcdn.net/12-100.mp4',
    'https://x.fbcdn.net/13a-100.mp4',
  ]);
  assert.deepEqual(list.candidates(19.92), ['https://x.fbcdn.net/19-100.mp4']);
});

test('SourceList returns at most 3 candidates', () => {
  const list = new SourceList();
  for (let i = 0; i < 5; i++) list.add(entryFor(`a${i}`, 13, i));
  assert.deepEqual(list.candidates(13.2), [
    'https://x.fbcdn.net/a4-100.mp4',
    'https://x.fbcdn.net/a3-100.mp4',
    'https://x.fbcdn.net/a2-100.mp4',
  ]);
});

test('SourceList keeps the lowest bitrate per asset', () => {
  const list = new SourceList();
  list.add(entryFor('a', 13, 1, 500));
  list.add(entryFor('a', 13, 2, 134));
  list.add(entryFor('a', 13, 3, 900));
  assert.deepEqual(list.candidates(13.5), ['https://x.fbcdn.net/a-134.mp4']);
});

test('SourceList caps at 50 assets, dropping the least recent', () => {
  const list = new SourceList();
  list.add(entryFor('old', 13, 0));
  for (let i = 1; i <= 50; i++) list.add(entryFor(`n${i}`, 30, i));
  assert.deepEqual(list.candidates(13.5), []);
  assert.equal(list.candidates(30.5).length, 3);
});

test('version changes only for new assets', () => {
  const list = new SourceList();
  const v0 = list.version;
  list.add(entryFor('a', 13, 1, 500));
  assert.equal(list.version, v0 + 1);
  list.add(entryFor('a', 13, 2, 134));
  assert.equal(list.version, v0 + 1);
  list.add(entryFor('b', 13, 3));
  assert.equal(list.version, v0 + 2);
});

test('candidatesFor gives nothing while stopped and plain files as they are', () => {
  const plain = { currentSrc: 'https://example.com/clip.mp4', duration: 10 };
  stop();
  assert.deepEqual(candidatesFor(plain), []);
  start();
  try {
    assert.deepEqual(candidatesFor(plain), [{ url: 'https://example.com/clip.mp4', check: false }]);
    assert.deepEqual(candidatesFor({ currentSrc: 'blob:https://www.instagram.com/x', duration: 13 }), []);
  } finally {
    stop();
  }
});
