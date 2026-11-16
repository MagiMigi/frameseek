// Turn buttons: two arrows at a video's top corners turn it a quarter turn. The video's
// frame is reshaped to the turned size, so Instagram's own layout moves its like column,
// caption, comments and mute button to stay beside it. Every inline style FrameSeek sets
// on Instagram's elements goes through a StyleLedger, which puts each one back exactly.
// Loaded as a classic content script; exposes globalThis.FrameSeekRotate.
(() => {
  'use strict';

  const ANGLES = [0, 90, 180, -90];
  const REELS_SIDE_MAX = 120; // the Reels page's like column is about 60 px wide
  const POST_SIDE_MIN = 250; // the post card's comments panel is 335–500 px wide

  // ↻ is +1 and ↺ is −1; four quarter turns bring the video back upright.
  const nextTurns = (turns, dir) => (((turns + dir) % 4) + 4) % 4;
  const angleFor = (turns) => ANGLES[turns];
  const isQuarter = (turns) => turns % 2 === 1;

  // What sits to the right of the video decides the layout: the Reels page's narrow like
  // column, or a post card's comments panel. Anything else (a carousel's next slide) is
  // neither, and that video gets no arrows.
  function classifyRow({ sideWidth, sideHasIcons, sideHasCommentBox }) {
    if (sideWidth < REELS_SIDE_MAX && sideHasIcons) return 'reels';
    if (sideWidth > POST_SIDE_MIN && sideHasCommentBox) return 'post';
    return null;
  }

  // Reels page: the old height becomes the new width, unless the window is narrower.
  function reelsSize({ w, h, maxWidth }) {
    const width = Math.min(h, maxWidth);
    return { width, height: (width * w) / h };
  }

  // Post card: the picture keeps the card's height, so its width is h × h / w, unless the
  // card (picture + comments panel) would be wider than the window allows.
  function postSize({ w, h, panelWidth, maxCardWidth }) {
    const width = Math.min((h * h) / w, maxCardWidth - panelWidth);
    return { width, height: (width * w) / h };
  }

  // Sets inline styles with !important and remembers what each property was before, so
  // restore() can put every one of them back exactly (value and priority), newest first.
  class StyleLedger {
    constructor() {
      this.entries = []; // { el, prop, value, priority }
    }

    get size() {
      return this.entries.length;
    }

    set(el, prop, value) {
      if (!this.entries.some((e) => e.el === el && e.prop === prop)) {
        this.entries.push({
          el,
          prop,
          value: el.style.getPropertyValue(prop),
          priority: el.style.getPropertyPriority(prop),
        });
      }
      el.style.setProperty(prop, value, 'important');
    }

    restore() {
      for (let i = this.entries.length - 1; i >= 0; i--) {
        const { el, prop, value, priority } = this.entries[i];
        if (value) el.style.setProperty(prop, value, priority);
        else el.style.removeProperty(prop);
      }
      this.entries = [];
    }
  }

  globalThis.FrameSeekRotate = Object.freeze({
    nextTurns,
    angleFor,
    isQuarter,
    classifyRow,
    reelsSize,
    postSize,
    StyleLedger,
  });
})();
