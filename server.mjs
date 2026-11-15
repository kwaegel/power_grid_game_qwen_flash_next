// Zero-dependency static file server. Start the game with:  node server.mjs
// then open http://localhost:8000 (or pass a port: node server.mjs 1234).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.gridling': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found: ' + rel);
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.on('error', (err) => {
  // The whole game is one command, so a busy port has to explain itself rather than
  // throw a stack trace: a stray server from a previous session is the common case.
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Something else is listening there -`);
    console.error(`if it is an old Gridling, use it, or start this one elsewhere:`);
    console.error(`  node server.mjs 1234`);
  } else if (err.code === 'EACCES') {
    console.error(`Port ${PORT} needs root privileges. Try a higher one:`);
    console.error(`  node server.mjs 1234`);
  } else {
    console.error(err.message);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Gridling is running at http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop.');
});
