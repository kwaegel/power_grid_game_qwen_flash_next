// Renders every plant at real map tile size on each terrain it is legally allowed to
// occupy, plus every weather and hazard chip at forecast-strip size, into one image
// for review by eye (or by a vision model, when one is wired up).
//
// This exists because numeric checks can prove a glyph paints, that two glyphs
// differ, and that a plant repaints enough of its tile to be seen — but not that a
// human can *name* the plant or that a drawing reads as finished. Open
// tools/e2e/shots/sheet.png. Reviewing this sheet is what found the battery bank
// nearly vanishing on a forest tile and a hazard chip duplicating a weather chip.
//
//   node tools/e2e/spritesheet.mjs
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SHOT = path.join(HERE, 'shots', 'sheet.png');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
};

function serve(port) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404); res.end('nope'); return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/local/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const PORT = 8300 + (process.pid % 300);
const srv = await serve(PORT);
await page.goto(`http://127.0.0.1:${PORT}/`);

const info = await page.evaluate(async () => {
  const { PLANTS } = await import('/src/sim/plants.js');
  const { T, terrainColor } = await import('/src/sim/world.js');
  const { WEATHER, HAZARDS } = await import('/src/sim/hazards.js');
  const { drawPlantIcon, paintIcons } = await import('/src/icons.js');
  const { drawDecoration } = await import('/src/render.js');

  const TS = 64;                       // tile size the real map uses at 1440x900
  const LABEL = 240;                   // left column for the plant name
  const GAP = 12;
  const plantIds = Object.keys(PLANTS);
  const maxTerrain = Math.max(...plantIds.map((id) => PLANTS[id].terrain.length));
  const caption = 'every plant at real map tile size (64 px), on each terrain it may occupy';

  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:10px;background:#f6f2ea';

  const chip = (d, title) => `<span title="${title}" style="display:inline-flex;align-items:center;gap:4px;`
    + 'background:#fffdf9;border:1px solid #d9d3c8;border-radius:12px;padding:4px 8px;'
    + `font:11px ui-rounded,system-ui,sans-serif;color:#4a4453"><span data-icon="${d.icon}" data-size="18"></span>${d.name}</span>`;

  const strip = document.createElement('div');
  strip.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px 0;max-width:1480px';
  strip.innerHTML = [
    ...Object.entries(WEATHER).map(([id, d]) => chip(d, `weather ${id}`)),
    ...Object.entries(HAZARDS).map(([id, d]) => chip(d, `disaster ${id}`)),
  ].join('');
  document.body.appendChild(strip);
  paintIcons(strip);

  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = '700 12px ui-rounded, system-ui, sans-serif';
  c.width = Math.max(LABEL + maxTerrain * (TS + GAP) + GAP, g.measureText(caption).width + 16);
  c.height = 54 + plantIds.length * (TS + 30);
  document.body.appendChild(c);

  g.fillStyle = '#4a4453';
  g.font = '700 12px ui-rounded, system-ui, sans-serif';
  g.fillText(caption, 8, 22);

  plantIds.forEach((id, r) => {
    const y0 = 54 + r * (TS + 30);
    PLANTS[id].terrain.forEach((t, k) => {
      const x0 = LABEL + k * (TS + GAP);
      const tt = T[t];
      const pal = [terrainColor(tt, 0), terrainColor(tt, 1)];
      g.fillStyle = pal[(r + k) % 2];
      g.beginPath();
      g.roundRect(x0, y0, TS, TS, TS * 0.2);
      g.fill();
      drawDecoration(g, tt, x0, y0, TS, k + 2, r + 1, 0.7);
      drawPlantIcon(g, id, x0, y0, TS, 1, 0.7,
        { id, on: true, out: PLANTS[id].cap * 0.6, charge: 30, status: 'ok', x: k, y: r }, null);
      g.fillStyle = '#6a6473';
      g.font = '10px ui-rounded, system-ui, sans-serif';
      g.fillText(t, x0 + 2, y0 + TS + 11);
    });
    g.fillStyle = '#4a4453';
    g.font = '700 12px ui-rounded, system-ui, sans-serif';
    g.fillText(PLANTS[id].name, 8, y0 + TS / 2 + 4);
  });

  return { plants: plantIds.length, maxTerrain, chips: Object.keys(WEATHER).length + Object.keys(HAZARDS).length };
});

await page.waitForTimeout(300);
await page.screenshot({ path: SHOT, fullPage: true });
console.log(`wrote ${SHOT}  (${info.plants} plants x up to ${info.maxTerrain} terrains, plus ${info.chips} weather/hazard chips)`);
srv.close();
await browser.close();
