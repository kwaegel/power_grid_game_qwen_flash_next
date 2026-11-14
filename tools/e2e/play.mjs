// Browser play-test driver: loads the real game in Chromium and plays it the way a
// human does — clicking palette cards and map tiles, opening menus, saving, reloading,
// exporting and importing — while watching the console and sampling the canvas, so
// layout/readability problems can be caught without eyes on the screen.
//
//   node tools/e2e/play.mjs
//
// Writes screenshots to tools/e2e/shots/ and a machine-readable results.json there.

import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = path.join(ROOT, 'tools', 'e2e', 'shots');
const CHROME = process.env.CHROME || '/usr/local/bin/chromium';
const PORT = Number(process.env.PORT || 8143);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.gridling': 'application/json; charset=utf-8',
};

function serve(port) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(ROOT, url === '/' ? 'index.html' : url);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

const results = [];
let failures = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const srv = await serve(PORT);
const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();

const consoleErrors = [], pageErrors = [], consoleWarns = [];
page.on('console', (m) => {
  const t = m.text();
  if (/favicon/i.test(t)) return;
  if (m.type() === 'error') consoleErrors.push(t);
  else if (m.type() === 'warning') consoleWarns.push(t);
});
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('requestfailed', (r) => {
  if (!/favicon/.test(r.url())) pageErrors.push(`request failed ${r.url()}: ${r.failure()?.errorText}`);
});

const sleep = (ms) => page.waitForTimeout(ms);
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const G = (fn, arg) => page.evaluate(fn, arg);
const textOf = async (sel) => ((await page.textContent(sel)) || '').trim();

const stats = () => G(() => {
  const g = window.__gridling.state();
  return {
    tick: g.tick, money: +g.money.toFixed(2), sat: +g.satisfaction.toFixed(1),
    demand: +g.lastDemand.toFixed(1), served: +g.lastServed.toFixed(1),
    plants: g.plants.length, cities: g.cities.length, over: g.over ? g.over.title : null,
    score: Math.round(g.score), link: Math.round(g.lastFlow.link),
    hazard: g.hazard ? { id: g.hazard.id, phase: g.hazard.phase } : null,
  };
});
const setSpeed = async (n) => { await page.click(`#speeds button[data-speed="${n}"]`); await sleep(60); };

// click a palette card, then a free tile of one of the given terrains: real play
async function build(plantId, terrains) {
  const spot = await G((t) => {
    const g = window.__gridling.state();
    const names = ['grass', 'field', 'forest', 'hill', 'river', 'lake', 'mountain', 'town', 'fault'];
    const taken = new Set(g.plants.map((p) => `${p.x},${p.y}`));
    for (let y = 0; y < g.map.length; y++)
      for (let x = 0; x < g.map[y].length; x++) {
        if (taken.has(`${x},${y}`)) continue;
        if (t.includes(names[g.map[y][x]])) return { x, y };
      }
    return null;
  }, terrains);
  if (!spot) return { ok: false, why: 'no free tile of that terrain' };
  const card = await page.$(`.pcard[data-plant="${plantId}"]`);
  if (!card) return { ok: false, why: 'palette card missing' };
  await card.click();
  await sleep(80);
  const geo = await G(() => window.__gridling.ui.geo);
  await page.mouse.click(geo.ox + (spot.x + 0.5) * geo.ts, geo.oy + (spot.y + 0.5) * geo.ts);
  await sleep(140);
  const ok = await G((s) => window.__gridling.state().plants.some((p) => p.x === s.x && p.y === s.y), spot);
  return { ok, spot };
}

async function canvasHealth() {
  return G(() => {
    const c = document.getElementById('map');
    const img = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const hist = new Map();
    let n = 0;
    for (let i = 0; i < img.length; i += 4 * 41) {
      hist.set(`${img[i] >> 4},${img[i + 1] >> 4},${img[i + 2] >> 4}`, 1);
      n++;
    }
    return { distinct: hist.size, sampled: n, w: c.width, h: c.height };
  });
}

async function overflowReport() {
  return G(() => {
    const bad = [];
    for (const el of document.querySelectorAll('#topbar .stat, .pcard, .ucard, .trow, #ticker, .chip, #hazardbanner span')) {
      if (!el.offsetParent && el.tagName !== 'BODY') continue;
      if (el.scrollWidth > el.clientWidth + 3)
        bad.push(`${el.className || el.id || el.tagName}: content ${el.scrollWidth}px > box ${el.clientWidth}px`);
    }
    return bad;
  });
}

async function offscreenReport() {
  return G(() => {
    const bad = [];
    const vw = innerWidth, vh = innerHeight;
    for (const sel of ['#topbar', '#map', '#chart', '#panel', '#forecast', '#ticker']) {
      const el = document.querySelector(sel);
      if (!el) { bad.push(`${sel} missing`); continue; }
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1) bad.push(`${sel} right ${Math.round(r.right)} > ${vw}`);
      if (r.bottom > vh + 1) bad.push(`${sel} bottom ${Math.round(r.bottom)} > ${vh}`);
      if (r.width < 60 || r.height < 24) bad.push(`${sel} collapsed to ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return bad;
  });
}

// ===================================================================== boot
console.log('--- boot ---');
await page.goto(`http://127.0.0.1:${PORT}/`);
await sleep(450);
check('title screen appears', await page.isVisible('#modal-card h1'), await textOf('#modal-card h1'));
await shot('01-title');
check('no page errors on load', pageErrors.length === 0, pageErrors.join(' | '));

await page.click('[data-a="new"]');
await sleep(350);
check('first-run coach marks appear', await page.isVisible('#coach'));
await shot('02-coach');
for (let i = 0; i < 8 && await page.isVisible('#coach .dismiss'); i++) {
  await (await page.$('#coach .dismiss')).click();
  await sleep(120);
}
check('coach marks dismiss', !(await page.isVisible('#coach')));
await setSpeed(0);
check('app shell visible after new run', await page.isVisible('#map'));
const st0 = await stats();
check('run starts powered: 2 plants, goodwill intact', st0.plants === 2 && st0.sat > 70 && st0.served > 0, JSON.stringify(st0));

// ---- how-to-play ------------------------------------------------------------
await page.click('#btn-help');
await sleep(250);
check('help lists all seven plant types', (await page.$$eval('#modal-card table tr', (r) => r.length)) >= 8);
await shot('03-help');
await page.click('#modal-card [data-a="close"]');
await sleep(150);

// ---- build by clicking, like a player ---------------------------------------
console.log('--- building ---');
await page.click('.tabs button[data-tab="build"]');
for (const [plant, terrain] of [['hydro', ['river']], ['solar', ['grass', 'field']], ['wind', ['hill', 'grass', 'field']], ['battery', ['grass', 'field', 'forest']]]) {
  const r = await build(plant, terrain);
  check(`build ${plant} by clicking a tile`, r.ok, r.why || '');
}
await shot('04-after-builds');
const st1 = await stats();
check('fleet grew to 6 plants', st1.plants >= 6, JSON.stringify({ plants: st1.plants, money: st1.money }));

// invalid placement is refused with a reason, not silently
{
  const geo = await G(() => window.__gridling.ui.geo);
  const town = await G(() => { const c = window.__gridling.state().cities[0]; return { x: c.x, y: c.y }; });
  await page.click('.pcard[data-plant="coal"]');
  await sleep(80);
  await page.mouse.click(geo.ox + (town.x + 0.5) * geo.ts, geo.oy + (town.y + 0.5) * geo.ts);
  await sleep(200);
  const why = await G(() => [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' | '));
  check('building on a town is refused with an explanation', /town/i.test(why), why.slice(0, 120));
  await page.keyboard.press('Escape');
}

// clicking an existing plant opens its card
{
  const geo = await G(() => window.__gridling.ui.geo);
  const target = await G(() => { const p = window.__gridling.state().plants[0]; return { x: p.x, y: p.y, uid: p.uid }; });
  await page.mouse.click(geo.ox + (target.x + 0.5) * geo.ts, geo.oy + (target.y + 0.5) * geo.ts);
  await sleep(250);
  check('clicking a plant opens its detail card', await page.isVisible('#detail'));
  check('detail card stays inside the panel', await G(() => {
    const d = document.getElementById('detail').getBoundingClientRect();
    const p = document.getElementById('panel').getBoundingClientRect();
    return d.left >= p.left - 1 && d.right <= p.right + 1 && d.top >= p.top - 1 && d.bottom <= p.bottom + 1;
  }));
  await shot('05-detail');
  await page.click('#detail [data-act="toggle"]');
  await sleep(120);
  check('detail card shuts a plant down', await G((uid) => window.__gridling.state().plants.find((q) => q.uid === uid).on === false, target.uid));
  await page.click('#detail [data-act="toggle"]');
  await sleep(120);
  await page.keyboard.press('Escape');
  await sleep(120);
  check('Escape closes the detail card', !(await page.isVisible('#detail')));
}

// ---- keyboard ---------------------------------------------------------------
await page.keyboard.press('Space');
await sleep(200);
const pA = await G(() => window.__gridling.state().tick);
await sleep(800);
const pB = await G(() => window.__gridling.state().tick);
check('Space pauses', pA === pB, `${pA} vs ${pB}`);
await page.keyboard.press('Space');
await sleep(300);
check('Space resumes', await G((t) => window.__gridling.state().tick > t, pB));

// ---- play a careful run through several seasons ------------------------------
console.log('--- playing seasons (careful play, clicking the palette) ---');
await G(() => window.__gridling.setTps(6));
await setSpeed(4);
const seasons = new Set();
let warned = null, struck = null;
const t0 = Date.now();
let lastBuildTick = -999;
while (Date.now() - t0 < 120_000) {
  const s = await stats();
  const cal = await G((t) => window.__gridling.cal.calendarOf(t), s.tick);
  seasons.add(['winter', 'spring', 'summer', 'autumn'][cal.season]);
  if (s.hazard?.phase === 'warn' && !warned) { warned = s.hazard.id; await shot('06-hazard-warning'); }
  if (s.hazard?.phase === 'active' && !struck) { struck = s.hazard.id; await shot('07-hazard-active'); }

  // keep investing like a careful player: firm capacity first, then renewables/storage
  if (s.tick - lastBuildTick > 30 && s.money > 70) {
    const want = await G(() => {
      const g = window.__gridling.state();
      const s = window.__gridling.summary(g);
      const n = (id) => g.plants.filter((p) => p.id === id).length;
      if (n('hydro') < 3 && g.money > 95) return ['hydro', ['river']];
      if (s.firm < g.lastDemand * 1.35 && n('coal') < 3 && g.money > 130) return ['coal', ['grass', 'field']];
      if (s.firm < g.lastDemand * 1.35 && g.money > 55) return ['gas', ['grass', 'field', 'hill']];
      if (n('battery') < 6 && g.money > 70) return ['battery', ['grass', 'field', 'forest']];
      if (g.money > 40) return ['solar', ['grass', 'field']];
      return null;
    });
    if (want) { await build(want[0], want[1]); lastBuildTick = s.tick; }
  }
  // buy upgrades when comfortably funded
  if (s.money > 130) {
    await page.click('.tabs button[data-tab="upgrade"]');
    await sleep(120);
    const btn = await page.$('#upgrades button[data-up="link"]:not([disabled])')
      || await page.$('#upgrades button[data-up="forecast"]:not([disabled])')
      || await page.$('#upgrades button[data-up="crew"]:not([disabled])');
    if (btn) { await btn.click(); await sleep(120); }
    await page.click('.tabs button[data-tab="build"]');
    await sleep(80);
  }
  if (s.over) break;
  if (seasons.size >= 3 && s.tick > 330) break;
  await sleep(350);
}
const st2 = await stats();
check('careful play survives three seasons and 300+ hours', st2.tick >= 330 && !st2.over, JSON.stringify(st2));
check('three distinct seasons observed', seasons.size >= 3, [...seasons].join(','));
check('a disaster warning appeared', !!warned, warned || 'none');
check('a disaster actually struck', !!struck, struck || 'none');
await shot('08-mid-run');
check('goodwill stayed above 50 during careful play', st2.sat > 50, `sat=${st2.sat}`);

// ---- layout / readability ---------------------------------------------------
const health = await canvasHealth();
check('map canvas renders varied content', health.distinct > 14, JSON.stringify(health));
check('no UI runs off screen at 1440x900', (await offscreenReport()).length === 0, (await offscreenReport()).join(' | '));
check('no text overflows its container', (await overflowReport()).length === 0, (await overflowReport()).join(' | '));
await page.setViewportSize({ width: 1120, height: 720 });
await sleep(500);
const ov2 = await offscreenReport();
check('layout holds at 1120x720', ov2.length === 0, ov2.join(' | '));
await shot('10-narrow-window');
await page.setViewportSize({ width: 1440, height: 900 });
await sleep(400);

// ---- save, reload, continue -------------------------------------------------
console.log('--- save / reload / continue ---');
await setSpeed(0);
const before = await stats();
await G(() => window.__gridling.saveNow());
await sleep(200);
check('save written to localStorage', await G(() => !!localStorage.getItem('gridling:autosave')));
await page.reload();
await sleep(600);
check('title offers Continue after reload', await page.isVisible('[data-a="continue"]'), await textOf('[data-a="continue"]'));
await shot('11-after-reload');
await page.click('[data-a="continue"]');
await sleep(500);
const after = await stats();
check('run resumes after reload (tick/plants/score preserved)',
  after.tick === before.tick && after.plants === before.plants && Math.abs(after.score - before.score) <= 2,
  JSON.stringify({ before: [before.tick, before.plants, before.score], after: [after.tick, after.plants, after.score] }));
await setSpeed(4);
await sleep(2500);
const live = await stats();
check('loaded save keeps simulating', live.tick > after.tick && !live.over, `${after.tick} -> ${live.tick}`);

// ---- export / clear / import -------------------------------------------------
console.log('--- export / clear / import ---');
await setSpeed(0);
const preExport = await stats();
await page.click('#btn-menu');
await sleep(250);
await shot('12-menu');
const dlP = page.waitForEvent('download', { timeout: 10000 });
await page.click('#modal-card [data-a="export"]');
const dl = await dlP.catch(() => null);
check('export produces a save file', !!dl, dl ? dl.suggestedFilename() : 'no download event');
const savePath = path.join(SHOTS, 'exported.gridling');
if (dl) {
  await dl.saveAs(savePath);
  const size = fs.statSync(savePath).size;
  const parsed = JSON.parse(fs.readFileSync(savePath, 'utf8'));
  check('exported file is a real Gridling save', parsed.app === 'gridling' && size > 800, `${size} bytes`);
}

await G(() => localStorage.clear());
await sleep(150);
await page.reload();
await sleep(500);
check('storage cleared: Continue is gone', !(await page.isVisible('[data-a="continue"]')));
await page.click('#modal-card [data-a="new"]');
await sleep(400);
for (let i = 0; i < 8 && await page.isVisible('#coach .dismiss'); i++) {
  await (await page.$('#coach .dismiss')).click();
  await sleep(100);
}
const freshTick = await G(() => window.__gridling.state().tick);
check('new run really started fresh (tick 0, 2 plants)', freshTick < 5, `tick=${freshTick}`);
await page.click('#btn-menu');
await sleep(200);
await page.click('#modal-card [data-a="import"]');
await sleep(250);
if (dl) await page.setInputFiles('#filein', savePath);
await sleep(250);
await page.click('#modal-card [data-a="go"]');
await sleep(700);
const imported = await stats();
check('file import restores the exported run',
  imported.tick === preExport.tick && imported.plants === preExport.plants && Math.abs(imported.score - preExport.score) <= 2,
  JSON.stringify({ want: [preExport.tick, preExport.plants, preExport.score], got: [imported.tick, imported.plants, imported.score] }));
await shot('13-imported-run');
// and the paste-JSON path
await page.click('#btn-menu');
await sleep(200);
await page.click('#modal-card [data-a="import"]');
await sleep(200);
await page.fill('#pastetext', fs.readFileSync(savePath, 'utf8'));
await page.click('#modal-card [data-a="go"]');
await sleep(700);
const pasted = await stats();
check('pasted-JSON import works too', pasted.tick === preExport.tick, `tick ${pasted.tick} vs ${preExport.tick}`);

// ---- careless player must lose ----------------------------------------------
console.log('--- a passive player loses ---');
await G(() => { window.__gridling.newGame(); window.__gridling.setTps(14); });
await sleep(400);
for (let i = 0; i < 8 && await page.isVisible('#coach .dismiss'); i++) {
  await (await page.$('#coach .dismiss')).click();
  await sleep(100);
}
await setSpeed(4);
let lost = null;
const deadline = Date.now() + 150_000;
while (Date.now() < deadline) {
  const s = await stats();
  if (s.over) { lost = s; break; }
  await sleep(400);
}
check('a passive player loses eventually', !!lost, lost ? `${lost.over} at tick ${lost.tick}` : 'still alive');
check('game-over screen shows the score', await page.isVisible('.bigscore'), await textOf('.bigscore'));
await shot('14-game-over');
const shown = parseInt((await textOf('.bigscore')).replace(/[^0-9]/g, ''), 10);
check('shown score matches the run state', lost && shown > 0 && Math.abs(shown - lost.score) <= 2, `shown ${shown} vs state ${lost?.score}`);
const scores = await G(() => JSON.parse(localStorage.getItem('gridling:scores') || '[]'));
check('best-score table persisted', scores.length >= 1, JSON.stringify(scores[0] || {}).slice(0, 160));

// ---- console hygiene --------------------------------------------------------
check('no uncaught page errors across the session', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
check('no console errors across the session', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
if (consoleWarns.length) console.log('note, console warnings:', consoleWarns.slice(0, 5));

fs.writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify({ results, consoleErrors, pageErrors, consoleWarns }, null, 2));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
await browser.close();
srv.close();
process.exit(failures ? 1 : 0);
