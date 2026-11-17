// Settings defaults and sanitizing for hover preview. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

let stored = {};
globalThis.chrome = {
  storage: {
    sync: { get: async () => stored },
    onChanged: { addListener() {}, removeListener() {} },
  },
};
await import('../../src/shared/settings.js');
const { DEFAULTS, getSettings } = globalThis.FrameSeekSettings;

test('hoverPreview defaults to off', async () => {
  assert.equal(DEFAULTS.hoverPreview, false);
  stored = {};
  assert.equal((await getSettings()).hoverPreview, false);
});

test('hoverPreview keeps a stored boolean', async () => {
  stored = { hoverPreview: true };
  assert.equal((await getSettings()).hoverPreview, true);
});

test('hoverPreview ignores non-booleans', async () => {
  stored = { hoverPreview: 'yes' };
  assert.equal((await getSettings()).hoverPreview, false);
});

test('turnButtons defaults to on', async () => {
  assert.equal(DEFAULTS.turnButtons, true);
  stored = {};
  assert.equal((await getSettings()).turnButtons, true);
});

test('turnButtons keeps a stored false', async () => {
  stored = { turnButtons: false };
  assert.equal((await getSettings()).turnButtons, false);
});

test('turnButtons ignores non-booleans', async () => {
  stored = { turnButtons: 0 };
  assert.equal((await getSettings()).turnButtons, true);
});

test('previewSize defaults to medium', async () => {
  assert.equal(DEFAULTS.previewSize, 'medium');
  stored = {};
  assert.equal((await getSettings()).previewSize, 'medium');
});

test('previewSize keeps a stored size', async () => {
  stored = { previewSize: 'small' };
  assert.equal((await getSettings()).previewSize, 'small');
});

test('previewSize ignores unknown values', async () => {
  stored = { previewSize: 'huge' };
  assert.equal((await getSettings()).previewSize, 'medium');
  stored = { previewSize: 2 };
  assert.equal((await getSettings()).previewSize, 'medium');
});
