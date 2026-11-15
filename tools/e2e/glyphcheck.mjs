// Does every icon the game asks for actually paint, and are the ones a player reads
// side by side actually distinguishable?
//
// All in-game art is drawn by src/icons.js from a spec string ("plant:solar",
// "hazard:quake", "weather:frost"). Three failure classes matter, and only the first
// is visible to a probe that asks "did something paint":
//
//   1. coverage.     A spec missing from the glyph table silently degrades to a "?"
//                    in the DOM; a half-existing plant id paints nothing at all.
//   2. confusion.    Two glyphs that are the same shape AND the same colours read as
//                    one thing. The forecast strip puts weather and disaster chips
//                    side by side and the build palette puts seven plants side by
//                    side. A screenshot review found the Windstorm disaster drawing
//                    the same cloud-and-bolt as the Storm weather condition.
//   3. legibility.   A plant that barely repaints the terrain tile it stands on is
//                    invisible on the map even though it paints fine on white.
//
// On (2): shape overlap alone is not enough and was measured to be useless on its
// own. Ink-mask IoU after bounding-box normalisation puts a genuine duplicate at
// ~0.99 (the wrench used by both "Repair Crews" and the repair mark) but legitimately
// similar pairs still score 0.87, so no shape threshold separates them. Requiring
// similar colours as well does separate them, which matches how the defect actually
// looked: the old Storm and Windstorm glyphs shared both their shape and their cloud
// grey / bolt gold.
//
//   node tools/e2e/glyphcheck.mjs                     # all three checks
//   node tools/e2e/glyphcheck.mjs "plant:solar" ...   # or specific specs
//   node tools/e2e/glyphcheck.mjs --chars "🔆" "⚡"     # legacy text-glyph tofu probe
//   node tools/e2e/glyphcheck.mjs --shape 0.8 --colour 80

import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
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
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : (name in {} ? dflt : dflt);
};
const SHAPE_CEIL = flag('--shape', 0.8);
const COLOUR_FLOOR = flag('--colour', 90);
const SEE_FLOOR = 0.08;
const named = charMode
  ? args.slice(1)
  : args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--shape' && args[i - 1] !== '--colour');

// The full set the game can ask for, derived from the sim tables rather than a
// hand-maintained list: rename a plant and this check follows automatically.
async function allSpecs() {
  const { plantSpecs, chipSpecs, upgradeSpecs } = await specGroups();
  return [...new Set([...plantSpecs, ...chipSpecs, ...upgradeSpecs,
    'mark:bolt', 'mark:town', 'mark:wrench', 'mark:money', 'mark:down', 'mark:up'])];
}

// The sets a player reads side by side. "mark:*" glyphs are excluded from the
// confusion comparison on purpose: the wrench deliberately marks both a repair in
// progress and the Repair Crews upgrade, which is intended reuse, not a collision.
async function specGroups() {
  const plants = await import('../../src/sim/plants.js');
  const hazards = await import('../../src/sim/hazards.js');
  const engine = await import('../../src/sim/engine.js');
  return {
    plantSpecs: [...new Set(Object.values(plants.PLANTS).map((p) => p.icon))],
    chipSpecs: [...new Set([...Object.values(hazards.WEATHER).map((w) => w.icon),
      ...Object.values(hazards.HAZARDS).map((h) => h.icon)])],
    upgradeSpecs: [...new Set(Object.values(engine.UPGRADES).map((u) => u.icon))],
  };
}

// Where each plant is legally allowed to stand, for the legibility check.
async function plantTerrain() {
  const { PLANTS } = await import('../../src/sim/plants.js');
  return Object.fromEntries(Object.entries(PLANTS).map(([id, p]) => [id, p.terrain]));
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
  for (const r of rows) console.log(`${r.tofu ? 'TOFU' : ' ok '}  ${String(r.ch).padEnd(5)} ink=${r.ink} colour=${r.colour} w=${r.width}`);
  console.log(`\n${tofu.length} of ${rows.length - 1} named text glyphs did not render`);
  await browser.close();
  process.exit(tofu.length ? 1 : 0);
}

const specs = named.length ? [...new Set(named)] : await allSpecs();
const groups = named.length
  ? { plantSpecs: specs, chipSpecs: specs, upgradeSpecs: [] }
  : await specGroups();
const legibles = named.length ? {} : await plantTerrain();
const PORT = 8123 + (process.pid % 300);
const srv = await serve(PORT);
await page.goto(`http://127.0.0.1:${PORT}/`);

// Import the real modules in the page, so this measures the shipped art.
const result = await page.evaluate(async ({ specs, groups, legibles, SEE_FLOOR }) => {
  const icons = await import('/src/icons.js');
  const { drawIcon, drawPlantIcon, rr } = icons;
  const { drawDecoration } = await import('/src/render.js');
  const { T, terrainColor } = await import('/src/sim/world.js');
  const { PLANTS } = await import('/src/sim/plants.js');

  const S = 48;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const GRID = 32;

  // Measure whatever is currently on the canvas: coverage numbers, a bounding-box
  // normalised shape grid for comparing silhouettes, and a coarse colour histogram.
  const measure = (spec) => {
    const d = g.getImageData(0, 0, S, S).data;
    const px = (x, y) => {
      const i = (y * S + x) * 4;
      return [d[i], d[i + 1], d[i + 2], d[i + 3]];
    };
    const on = ([r, gr, bb, a]) => r < 245 || gr < 245 || bb < 245 || a < 245;
    const shades = new Set();
    const hist = new Map();
    let ink = 0, minX = S, maxX = -1, minY = S, maxY = -1, sr = 0, sg = 0, sb = 0;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const p = px(x, y);
        if (!on(p)) continue;
        ink++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        sr += p[0]; sg += p[1]; sb += p[2];
        const key = `${p[0] >> 5}-${p[1] >> 5}-${p[2] >> 5}`;
        shades.add(`${p[0] >> 4}-${p[1] >> 4}-${p[2] >> 4}`);
        hist.set(key, (hist.get(key) || 0) + 1);
      }

    const grid = new Uint8Array(GRID * GRID);
    if (ink) {
      const w = Math.max(1, maxX - minX + 1), h = Math.max(1, maxY - minY + 1);
      for (let gy = 0; gy < GRID; gy++)
        for (let gx = 0; gx < GRID; gx++) {
          const sx = minX + Math.min(w - 1, Math.floor((gx + 0.5) / GRID * w));
          const sy = minY + Math.min(h - 1, Math.floor((gy + 0.5) / GRID * h));
          grid[gy * GRID + gx] = on(px(sx, sy)) ? 1 : 0;
        }
    }
    const mean = ink ? [sr / ink, sg / ink, sb / ink] : [0, 0, 0];
    return { spec, ink, shades: shades.size, grid, hist, mean, frac: ink / (S * S) };
  };

  const shoot = (spec) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
    let painted = false, threw = null;
    try { painted = drawIcon(g, spec, S); } catch (e) { threw = String(e && e.message || e); }
    return { ...measure(spec), painted: !!painted, threw };
  };

  const shots = specs.map(shoot);
  const bySpec = Object.fromEntries(shots.map((s) => [s.spec, s]));

  const iou = (a, b) => {
    let inter = 0, union = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] && b[i]) inter++;
      if (a[i] || b[i]) union++;
    }
    return union ? inter / union : 0;
  };
  // colour distance: mean ink difference plus how little the two colour histograms
  // share, so a green plant and a grey plant of similar shape are not "confusing"
  const colourGap = (a, b) => {
    const mean = Math.abs(a.mean[0] - b.mean[0]) + Math.abs(a.mean[1] - b.mean[1]) + Math.abs(a.mean[2] - b.mean[2]);
    let shared = 0, total = 0;
    for (const [k, v] of a.hist) {
      total += v;
      shared += Math.min(v, b.hist.get(k) || 0);
    }
    const overlap = total ? shared / total : 0;      // 0 = no colours in common
    return mean * (1 - overlap) + 200 * (1 - overlap);
  };

  const ranked = [];
  for (const list of [groups.chipSpecs, groups.plantSpecs])
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        if (list[i] !== list[j] && bySpec[list[i]] && bySpec[list[j]])
          ranked.push({
            a: list[i], b: list[j],
            shape: +iou(bySpec[list[i]].grid, bySpec[list[j]].grid).toFixed(3),
            colour: Math.round(colourGap(bySpec[list[i]], bySpec[list[j]])),
          });
  ranked.sort((x, y) => y.shape - x.shape);

  // Legibility: draw the plant on a real terrain tile, then check how much of that
  // tile the plant actually changes.
  const legibility = [];
  for (const [id, terrains] of Object.entries(legibles)) {
    for (const tname of terrains) {
      const tt = T[tname];
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
      const pal = [terrainColor(tt, 0), terrainColor(tt, 1)];
      g.fillStyle = pal[0];
      rr(g, 1.5, 1.5, S - 3, S - 3, S * 0.2);
      g.fill();
      drawDecoration(g, tt, 0, 0, S, 3, 4, 0.7);
      const bare = g.getImageData(0, 0, S, S).data;
      drawPlantIcon(g, id, 0, 0, S, 1, 0.7,
        { id, on: true, out: PLANTS[id].cap * 0.6, charge: 30, status: 'ok', x: 3, y: 4 }, null);
      const full = g.getImageData(0, 0, S, S).data;
      let changed = 0;
      for (let i = 0; i < full.length; i += 4) {
        const dd = Math.abs(full[i] - bare[i]) + Math.abs(full[i + 1] - bare[i + 1]) + Math.abs(full[i + 2] - bare[i + 2]);
        if (dd > 60) changed++;
      }
      legibility.push({ plant: id, terrain: tname, frac: +(changed / (full.length / 4)).toFixed(3) });
    }
  }

  for (const s of shots) { delete s.grid; delete s.hist; delete s.mean; }
  return { rows: shots, ranked, legibility };
}, { specs, groups, legibles, SEE_FLOOR });

srv.close();

let bad = 0;
console.log('1. coverage — does each spec paint real, multi-shade pixels?');
for (const r of result.rows) {
  const ok = r.painted !== false && !r.threw && r.ink > 40 && r.shades >= 3;
  if (!ok) bad++;
  console.log(`${ok ? ' ok ' : 'BAD '}  ${r.spec.padEnd(18)} painted=${r.painted} ink=${String(r.ink).padStart(4)} shades=${String(r.shades).padStart(3)}${r.threw ? ' threw: ' + r.threw : ''}`);
}
console.log(`  ${bad}/${result.rows.length} failed to paint${bad ? ' — the glyph table has missing or broken entries' : ''}`);

console.log(`\n2. confusion — same silhouette (IoU > ${SHAPE_CEIL}) AND similar colours (gap < ${COLOUR_FLOOR})`);
console.log(`   compared only inside groups the player reads side by side: forecast chips, and the build palette.`);
console.log(`   all pairs, most similar first:`);
for (const p of result.ranked.slice(0, 12)) {
  const conf = p.shape > SHAPE_CEIL && p.colour < COLOUR_FLOOR;
  if (conf) bad++;
  console.log(`   ${conf ? 'CONFUSE' : ' ok   '}  shape=${p.shape.toFixed(3)} colourgap=${String(p.colour).padStart(4)}  ${p.a} vs ${p.b}`);
}

console.log(`\n3. legibility — is each plant visible on each terrain it may stand on`);
console.log(`   (fraction of the tile repainted by the plant, floor ${SEE_FLOOR})?`);
for (const l of result.legibility) {
  const ok = l.frac >= SEE_FLOOR;
  if (!ok) bad++;
  console.log(`   ${ok ? ' ok ' : 'BAD '}  ${l.plant.padEnd(8)} on ${l.terrain.padEnd(8)} ${l.frac.toFixed(3)}`);
}

console.log(`\n${bad} problem(s)`);
await browser.close();
process.exit(bad ? 1 : 0);
