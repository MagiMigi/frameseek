// Finds the file behind each Instagram video, for hover preview. Instagram plays video
// through Media Source (a blob: URL), so the file itself only shows up in the page's
// resource timing: its player fetches pieces of each quality version with `bytestart` and
// `byteend` in the URL, plus an `efg` label (base64 JSON) naming the video and its length.
// Dropping the byte range gives a URL a plain <video> can load whole.
// Loaded as a classic content script; exposes globalThis.FrameSeekSources.
(() => {
  'use strict';

  const HOSTS = ['.fbcdn.net', '.cdninstagram.com'];
  const MAX_ASSETS = 50; // a long scroll must not grow the list without limit
  const MAX_CANDIDATES = 3;
  const LENGTH_SLACK = 1; // efg's duration_s is the length rounded down to whole seconds

  function decodeEfg(value) {
    try {
      let text = String(value);
      try {
        text = decodeURIComponent(text);
      } catch {
        // Already decoded.
      }
      // base64url, or standard base64 whose "+" a query string turned into a space.
      const b64 = text.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const labels = JSON.parse(new TextDecoder().decode(bytes));
      return labels && typeof labels === 'object' ? labels : null;
    } catch {
      return null;
    }
  }

  // One resource timing entry → { assetId, durationS, bitrate, url, at }, or null when
  // it isn't a piece of an Instagram video track.
  function parseEntry(name, at) {
    if (typeof name !== 'string' || !name.includes('bytestart=') || !name.includes('efg=')) return null;
    let u;
    try {
      u = new URL(name);
    } catch {
      return null;
    }
    if (u.protocol !== 'https:' || !HOSTS.some((h) => u.hostname.endsWith(h))) return null;
    if (!u.searchParams.has('bytestart') || !u.searchParams.has('byteend')) return null;
    const labels = decodeEfg(u.searchParams.get('efg'));
    if (!labels || labels.xpv_asset_id == null) return null;
    if (String(labels.vencode_tag ?? '').includes('audio')) return null;
    const durationS = Number(labels.duration_s);
    if (!Number.isFinite(durationS) || durationS <= 0) return null;
    const bitrate = Number(labels.bitrate);
    u.searchParams.delete('bytestart');
    u.searchParams.delete('byteend');
    return {
      assetId: String(labels.xpv_asset_id),
      durationS,
      bitrate: Number.isFinite(bitrate) && bitrate > 0 ? bitrate : Infinity,
      url: u.href,
      at,
    };
  }

  // The videos seen so far: per asset, its lowest-bitrate file and when it was last fetched.
  class SourceList {
    constructor() {
      this.assets = new Map(); // assetId -> { durationS, bitrate, url, at }
      this.version = 0;
    }

    add(entry) {
      const known = this.assets.get(entry.assetId);
      if (!known) {
        this.assets.set(entry.assetId, { durationS: entry.durationS, bitrate: entry.bitrate, url: entry.url, at: entry.at });
        this.version++;
        this.evict();
        return;
      }
      if (entry.bitrate < known.bitrate) {
        known.bitrate = entry.bitrate;
        known.url = entry.url;
      }
      if (entry.at > known.at) known.at = entry.at;
    }

    evict() {
      while (this.assets.size > MAX_ASSETS) {
        let oldest = null;
        for (const [id, a] of this.assets) if (!oldest || a.at < oldest.at) oldest = { id, at: a.at };
        this.assets.delete(oldest.id);
      }
    }

    candidates(duration) {
      return [...this.assets.values()]
        .filter((a) => Math.abs(a.durationS - duration) <= LENGTH_SLACK)
        .sort((a, b) => b.at - a.at)
        .slice(0, MAX_CANDIDATES)
        .map((a) => a.url);
    }

    clear() {
      this.assets.clear();
    }
  }

  const list = new SourceList();
  let observer = null;

  function start() {
    if (observer || typeof PerformanceObserver !== 'function') return;
    const next = new PerformanceObserver((entries) => {
      for (const e of entries.getEntries()) {
        const entry = parseEntry(e.name, e.startTime);
        if (entry) list.add(entry);
      }
    });
    try {
      next.observe({ type: 'resource', buffered: true });
      observer = next;
    } catch {
      // No resource timing here: hover preview finds nothing and the bar shows the time only.
    }
  }

  function stop() {
    observer?.disconnect();
    observer = null;
    list.clear();
  }

  // Files that may be this video's: a plain file is certain; ones from the list must
  // still pass the frame check.
  function candidatesFor(video) {
    if (!observer) return [];
    const src = video.currentSrc || video.src || '';
    if (/^https?:/i.test(src)) return [{ url: src, check: false }];
    const d = video.duration;
    if (!Number.isFinite(d) || d <= 0) return [];
    return list.candidates(d).map((url) => ({ url, check: true }));
  }

  globalThis.FrameSeekSources = Object.freeze({
    decodeEfg,
    parseEntry,
    SourceList,
    start,
    stop,
    candidatesFor,
    version: () => list.version,
  });
})();
