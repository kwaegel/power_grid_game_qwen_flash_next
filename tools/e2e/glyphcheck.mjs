// Does every icon the game asks for actually paint?
//
// All in-game art is drawn by src/icons.js from a spec string ("plant:solar",
// "hazard:quake", "weather:frost"). A spec missing from the glyph table silently
// degrades to a "?" placeholder in the DOM, and a plant id that only half-exists
// paints nothing at all. That is the kind of defect a screenshot review catches
// late, so check it directly: paint every spec the sim can name and measure pixels.
//
//   node tools/e2e/glyphcheck.mjs                     # coverage of the whole set
//   node tools/e2e/glyphcheck.mjs "plant:solar" ...   # or specific specs
//   node tools/e2e/glyphcheck.mjs --chars "🔆" "⚡"     # legacy text-glyph tofu probe

import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
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

const args = process.argv.slice(2);
const charMode = args[0] === '--chars';
const named = charMode ? args.slice(1) : args;

// The full set the game can ask for, derived from the sim tables rather than a
// hand-maintained list: rename a plant and this check follows automatically.
async function allSpecs() {
  const plants = await import('../../src/sim/plants.js');
  const hazards = await import('../../src/sim/hazards.js');
  const engine = await import('../../src/sim/engine.js');
  return [
    ...Object.values(plants.PLANTS).map((p) => p.icon),
    ...Object.values(hazards.HAZARDS).map((h) => h.icon),
    ...Object.values(hazards.WEATHER).map((w) => w.icon),
    ...Object.values(engine.UPGRADES).map((u) => u.icon),
    ...engine.PLANT_ORDER.map((id) => `plant:${id}`),
    'mark:bolt', 'mark:town', 'mark:wrench', 'mark:money', 'mark:down', 'mark:up',
  ];
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/local/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();

if (charMode) {
  await page.goto('data:text/html,<!doctype html><meta charset=utf-8><title>glyphs</title>');
  const rows = await page.evaluate(({ chars }) => {
    const c = document.createElement('canvas');
    c.width = 140; c.height = 90;
    const g = c.getContext('2d');
    const probe = (ch) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 140, 90);
      g.font = '44px system-ui, sans-serif';
      g.textBaseline = 'top'; g.fillStyle = '#000';
      g.fillText(ch, 8, 12);
      const d = g.getImageData(0, 0, 140, 90).data;
      let ink = 0, colour = 0;
      for (let i = 0; i < d.length; i += 4) {
        const [r, gr, bb, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
        if (r < 240 || gr < 240 || bb < 240 || a < 240) ink++;
        if (Math.max(r, gr, bb) - Math.min(r, gr, bb) > 40) colour++;
      }
      return { ink, colour, width: +g.measureText(ch).width.toFixed(1) };
    };
    const control = probe('\uFFFF');          // guaranteed unrenderable: the tofu box
    return chars.map((ch) => {
      const p = probe(ch);
      return { ch, tofu: p.ink === control.ink && p.colour === 0, ...p };
    }).concat([{ ch: '\\uFFFF (control)', tofu: false, ...control }]);
  }, { chars: named.length ? named : ['🔆', '⚡', '☀️', '▶', '☰', '❚❚'] });

  const tofu = rows.filter((r) => r.tofu);
  for (const r of rows) {
    console.log(`${r.tofu ? 'TOFU' : ' ok '}  ${String(r.ch).padEnd(5)} ink=${r.ink} colour=${r.colour} w=${r.width}`);
  }
  console.log(`\n${tofu.length} of ${rows.length - 1} named text glyphs did not render`);
  await browser.close();
  process.exit(tofu.length ? 1 : 0);
}

const specs = named.length ? named : await allSpecs();
const PORT = 8123 + (process.pid % 300);
const srv = await serve(PORT);
await page.goto(`http://127.0.0.1:${PORT}/`);

// Import the real module in the page, so this measures the shipped art.
const rows = await page.evaluate(async ({ specs }) => {
  const { drawIcon } = await import('/src/icons.js');
  const S = 48;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  return specs.map((spec) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
    let painted = false, threw = null;
    try { painted = drawIcon(g, spec, S); } catch (e) { threw = String(e && e.message || e); }
    const d = g.getImageData(0, 0, S, S).data;
    const buckets = new Set();
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [r, gr, bb, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
      if (r < 245 || gr < 245 || bb < 245 || a < 245) ink++;
      buckets.add(`${r >> 4}-${gr >> 4}-${bb >> 4}`);
    }
    return { spec, painted: !!painted, threw, ink, shades: buckets.size };
  });
}, { specs });

srv.close();

let bad = 0;
for (const r of rows) {
  // A good glyph reports success, puts real pixels down, and uses more than one
  // shade — one flat blob means the shapes collapsed.
  const ok = r.painted && !r.threw && r.ink > 40 && r.shades >= 3;
  if (!ok) bad++;
  console.log(`${ok ? ' ok ' : 'BAD '}  ${r.spec.padEnd(18)} painted=${r.painted} ink=${String(r.ink).padStart(4)} shades=${String(r.shades).padStart(3)}${r.threw ? ' threw: ' + r.threw : ''}`);
}
console.log(`\n${bad}/${rows.length} icon specs failed to paint` +
  (bad ? ' — the glyph table is missing or broken entries' : ''));
await browser.close();
process.exit(bad ? 1 : 0);
