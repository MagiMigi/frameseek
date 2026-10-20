// Tiny static file server for the local test pages:
//   http://localhost:5173/test/harness.html     feed and Reels
//   http://localhost:5173/stories/test/1/       stories viewer (test/stories.html)
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // The extension decides it's in the stories viewer from the URL, so serve the stories
  // test page under a /stories/ path like Instagram's.
  const pathname = url.pathname.startsWith('/stories/') ? '/test/stories.html' : decodeURIComponent(url.pathname);
  const path = normalize(join(ROOT, pathname));
  if (!path.startsWith(ROOT + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (!statSync(path).isFile()) throw new Error('not a file');
  } catch {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(path).pipe(res);
}).listen(PORT, () => console.log(`serving ${ROOT} at http://localhost:${PORT}/test/harness.html`));
