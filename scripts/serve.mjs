// Minimal static file server for local preview and for the Playwright suite.
// Deliberately dependency-free: the site itself ships no runtime dependencies
// and a test harness shouldn't be the thing that introduces one.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 8099;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  // Strip the query string, then normalise before joining so a path such as
  // /../../etc/passwd can't escape the site root.
  const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const rel = normalize(requested).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  let file = join(ROOT, rel || 'index.html');

  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(PORT, () => console.log(`Serving ${ROOT} on http://localhost:${PORT}`));
