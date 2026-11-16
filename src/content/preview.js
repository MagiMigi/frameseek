// Hover preview: a hidden, low-quality copy of the video that seeks to the time under the
// mouse and is shown in a small box above the seek bar's time label. A file found in the
// page's resource timing is only used once a frame of it matches the real video's.
// Loaded as a classic content script; exposes globalThis.FrameSeekPreview.
(() => {
  'use strict';

  // Mean greyscale difference per pixel at 16×16: measured 8.6 for the right file and
  // 60–73 for other reels.
  const MATCH_MAX_DIFF = 25;
  // A nearly flat frame (black, white, a fade) would match any other flat frame.
  const MIN_SPREAD = 40;
  const MIN_BOX_WIDTH = 80;
  const EDGE = 4;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function frameDiff(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
  }

  function frameSpread(g) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of g) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return hi - lo;
  }

  function boxSize(rootW, rootH, aspect) {
    const a = aspect > 0 ? aspect : 16 / 9;
    const width = Math.max(MIN_BOX_WIDTH, Math.min(0.32 * rootW, 0.4 * rootH * a));
    return { width, height: width / a };
  }

  function boxLeft(centerX, width, rootW) {
    return clamp(centerX - width / 2, EDGE, rootW - width - EDGE);
  }

  // Tries the candidates in order and returns the first one that is this video's file:
  // { player, candidate }, 'retry' when the real video has no usable frame to compare
  // with yet, or null when none matches. Players that don't match are closed.
  async function pickSource(candidates, ops) {
    for (const candidate of candidates) {
      let ref = null;
      if (candidate.check) {
        // Look at the real video first, so a flat frame costs no download.
        ref = ops.reference();
        if (!ref || frameSpread(ref.grey) < MIN_SPREAD) return 'retry';
      }
      const player = await ops.open(candidate.url, candidate.check);
      if (!player) continue;
      if (!candidate.check) return { player, candidate };
      const grey = await ops.frameAt(player, ref.time);
      if (grey && frameDiff(ref.grey, grey) <= MATCH_MAX_DIFF) return { player, candidate };
      ops.close(player);
    }
    return null;
  }

  globalThis.FrameSeekPreview = Object.freeze({
    MATCH_MAX_DIFF,
    MIN_SPREAD,
    frameDiff,
    frameSpread,
    boxSize,
    boxLeft,
    pickSource,
  });
})();
