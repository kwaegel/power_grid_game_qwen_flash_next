// Browser play-test driver: loads the real game in Chromium and plays it the way a
// human does — clicking palette cards and map tiles, opening menus, saving, reloading,
// exporting and importing — while watching the console and sampling the canvas, so
// layout/readability problems can be caught without eyes on the screen.
//
//   node tools/e2e/play.mjs
//
// Screenshots and a machine-readable results.json land in tools/e2e/shots/.

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
    speed: window.__gridling.ui.speed,
  };
});

// What the game itself announced, read out of its own event log.
const report = () => G(() => {
  const g = window.__gridling.state();
  const text = g.log.map((l) => l.text);
  const seasons = new Set();
  for (const t of text) {
    const m = t.match(/·\s*(Winter|Spring|Summer|Autumn)\s*—/);
    if (m) seasons.add(m[1].toLowerCase());
  }
  const clean = (s) => (s || '').replace(/[^\w ]/g, '').trim();
  return {
    seasons: [...seasons],
    warned: text.filter((t) => /Forecast warning/.test(t)).map((t) => clean((t.match(/warning: (.+?) incoming/) || [])[1])),
    struck: text.filter((t) => /has struck!/.test(t)).map((t) => clean((t.match(/^(.+?) has struck/) || [])[1])),
    repairs: text.filter((t) => /is repaired/.test(t)).length,
    damage: text.filter((t) => /damaged — crew|was destroyed|MELTDOWN/.test(t)).length,
    yearUps: text.filter((t) => /begins\. Demand is climbing/.test(t)).length,
    // the event log is capped at 80 entries, so early events scroll out: year and
    // town count are read from the run state instead.
    year: window.__gridling.cal.calendarOf(g.tick).year,
    cities: g.cities.length,
  };
});

// atomic snapshot + save, so a running clock cannot race the assertion
const saveNowAndRead = () => G(() => {
  const g = window.__gridling.state();
  window.__gridling.saveNow();
  return { tick: g.tick, plants: g.plants.length, score: Math.round(g.score), money: +g.money.toFixed(2) };
});

async function setSpeed(n) {
  await page.click(`#speeds button[data-speed="${n}"]`);
  await sleep(80);
}

// tile -> viewport point. ui.geo offsets are canvas-local; page.mouse wants page coords.
async function tilePoint(tx, ty) {
  return G(({ tx, ty }) => {
    const geo = window.__gridling.ui.geo;
    const r = document.getElementById('map').getBoundingClientRect();
    return { x: r.left + geo.ox + (tx + 0.5) * geo.ts, y: r.top + geo.oy + (ty + 0.5) * geo.ts };
  }, { tx, ty });
}

async function firstFreeTile(terrains) {
  return G((t) => {
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
}

// click a palette card, then a free tile: exactly how a person builds
async function build(plantId, terrains) {
  const spot = await firstFreeTile(terrains);
  if (!spot) return { ok: false, why: `no free ${terrains.join('/')} tile` };
  const card = await page.$(`.pcard[data-plant="${plantId}"]`);
  if (!card) return { ok: false, why: 'palette card missing' };
  await card.click();
  await sleep(80);
  const pt = await tilePoint(spot.x, spot.y);
  await page.mouse.click(pt.x, pt.y);
  await sleep(170);
  const ok = await G((s) => window.__gridling.state().plants.some((p) => p.x === s.x && p.y === s.y), spot);
  return { ok, spot };
}

const lastToast = () => G(() => [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' | '));

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
    const ch = document.getElementById('chart');
    return { distinct: hist.size, sampled: n, mapW: c.width, mapH: c.height, chartW: ch.width, chartH: ch.height };
  });
}

async function overflowReport() {
  return G(() => {
    const bad = [];
    for (const el of document.querySelectorAll('#topbar .stat, .pcard, .ucard, .trow, #ticker, .chip, #detail h3, #coach')) {
      if (!el.offsetParent) continue;
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
      if (r.height < 12) bad.push(`${sel} collapsed to height ${Math.round(r.height)}`);
    }
    const map = document.getElementById('map').getBoundingClientRect();
    if (map.height < vh * 0.34) bad.push(`map only ${Math.round(map.height)}px tall of ${vh}`);
    const ts = window.__gridling.ui.geo ? window.__gridling.ui.geo.ts : 0;
    if (ts < 26) bad.push(`tiles only ${ts}px wide, too small to read`);
    return bad;
  });
}

async function dismissCoach() {
  for (let i = 0; i < 8 && await page.isVisible('#coach .dismiss'); i++) {
    await (await page.$('#coach .dismiss')).click();
    await sleep(120);
  }
}

// ===================================================================== boot
console.log('--- boot ---');
await page.goto(`http://127.0.0.1:${PORT}/`);
await sleep(500);
check('stylesheet applied', await G(() => document.styleSheets.length >= 1 &&
  getComputedStyle(document.querySelector('main')).display === 'grid'));
check('title screen appears', await page.isVisible('#modal-card h1'), await textOf('#modal-card h1'));
await shot('01-title');
check('no page errors on load', pageErrors.length === 0, pageErrors.join(' | '));

await page.click('[data-a="new"]');
await sleep(900);   // coach marks appear a beat after the run starts
check('first-run coach marks appear', await page.isVisible('#coach'));
await shot('02-coach');
await dismissCoach();
check('coach marks dismiss', !(await page.isVisible('#coach')));
check('app shell visible after new run', await page.isVisible('#map'));
const st0 = await stats();
check('run starts powered: 2 plants, goodwill intact', st0.plants === 2 && st0.sat > 70 && st0.served > 0, JSON.stringify(st0));

// the real-time loop must advance by itself (one in-game day ≈ 10 s at 1x)
await setSpeed(1);
const t0 = await G(() => window.__gridling.state().tick);
await sleep(3000);
const t1 = await G(() => window.__gridling.state().tick);
check('real-time loop advances the simulation', t1 > t0 + 3, `tick ${t0} -> ${t1} in 3 s at 1x`);
const geo0 = await G(() => window.__gridling.ui.geo && { ts: window.__gridling.ui.geo.ts, w: window.__gridling.ui.geo.w });
check('canvas sized to the layout', !!geo0 && geo0.w > 600 && geo0.ts >= 26, JSON.stringify(geo0));

// ---- how-to-play ------------------------------------------------------------
await page.click('#btn-help');
await sleep(300);
check('help lists all seven plant types', (await page.$$eval('#modal-card table tr', (r) => r.length)) >= 8);
await shot('03-help');
await page.click('#modal-card [data-a="close"]');
await sleep(200);

// ---- build by clicking, like a player (with funds available) ----------------
console.log('--- building ---');
await setSpeed(0);
await G(() => { window.__gridling.state().money = 900; });   // pretend the region has earned
await page.click('.tabs button[data-tab="build"]');
await sleep(150);
for (const [plant, terrain] of [['hydro', ['river']], ['solar', ['grass', 'field']], ['wind', ['hill', 'grass', 'field']], ['battery', ['grass', 'field', 'forest']]]) {
  const r = await build(plant, terrain);
  check(`build ${plant} by clicking a tile`, r.ok, r.why || '');
}
await shot('04-after-builds');
const st1 = await stats();
check('fleet grew to 6 plants', st1.plants >= 6, JSON.stringify({ plants: st1.plants, money: st1.money }));

// refusal path A: cannot afford
{
  await G(() => { window.__gridling.state().money = 1; });
  await page.click('.pcard[data-plant="solar"]');   // selecting re-renders the palette
  await sleep(150);
  const marked = await G(() => document.querySelectorAll('.pcard.cant').length);
  check('plants you cannot afford are dimmed in the panel', marked >= 4, `${marked} marked`);
  const spot = await firstFreeTile(['grass', 'field']);
  const pt = await tilePoint(spot.x, spot.y);
  await page.mouse.click(pt.x, pt.y);
  await sleep(250);
  const why = await lastToast();
  check('unaffordable build is refused with the price', /Costs \$\d+ — you have/.test(why), why.slice(-130));
  await G(() => { window.__gridling.state().money = 420; });
  await page.keyboard.press('Escape');
  await sleep(150);
}

// refusal path B: wrong terrain
{
  const town = await G(() => { const c = window.__gridling.state().cities[0]; return { x: c.x, y: c.y }; });
  await page.click('.pcard[data-plant="coal"]');
  await sleep(120);
  const pt = await tilePoint(town.x, town.y);
  await page.mouse.click(pt.x, pt.y);
  await sleep(250);
  const why = await lastToast();
  check('building on a town is refused with an explanation', /town stands there/i.test(why), why.slice(-140));
  await page.keyboard.press('Escape');
  await sleep(150);
}

// clicking an owned plant opens its card
{
  const target = await G(() => { const p = window.__gridling.state().plants[0]; return { x: p.x, y: p.y, uid: p.uid }; });
  const pt = await tilePoint(target.x, target.y);
  await page.mouse.click(pt.x, pt.y);
  await sleep(350);
  check('clicking a plant opens its detail card', await page.isVisible('#detail'));
  check('detail card stays inside the panel', await G(() => {
    const d = document.getElementById('detail').getBoundingClientRect();
    const p = document.getElementById('panel').getBoundingClientRect();
    return d.left >= p.left - 1 && d.right <= p.right + 1 && d.top >= p.top - 1 && d.bottom <= p.bottom + 1;
  }));
  await shot('05-detail');
  await page.click('#detail [data-act="toggle"]');
  await sleep(150);
  check('detail card shuts a plant down',
    await G((uid) => window.__gridling.state().plants.find((q) => q.uid === uid).on === false, target.uid));
  await page.click('#detail [data-act="toggle"]');
  await sleep(150);
  await page.keyboard.press('Escape');
  await sleep(150);
  check('Escape closes the detail card', !(await page.isVisible('#detail')));
}

// batteries are interactive, and selling a plant pays salvage
{
  const batt = await G(() => {
    const p = window.__gridling.state().plants.find((q) => q.id === 'battery');
    return p ? { uid: p.uid, x: p.x, y: p.y } : null;
  });
  if (batt) {
    const pt = await tilePoint(batt.x, batt.y);
    await page.mouse.click(pt.x, pt.y);
    await sleep(300);
    await page.click('#detail [data-act="mode"][data-mode="charge"]');
    await sleep(150);
    check('battery can be forced to charge from its card',
      await G((uid) => window.__gridling.state().plants.find((q) => q.uid === uid).mode === 'charge', batt.uid));
    await page.click('#detail [data-act="mode"][data-mode="auto"]');
    await sleep(120);
    await page.keyboard.press('Escape');
    await sleep(120);
  } else {
    check('battery can be forced to charge from its card', false, 'no battery on the map');
  }
  const sold = await G(() => {
    const g = window.__gridling.state();
    const victim = g.plants[g.plants.length - 1];
    const before = { n: g.plants.length, money: g.money };
    window.__gridling.sell(victim.uid);
    return { before, after: { n: g.plants.length, money: g.money } };
  });
  check('selling a plant removes it and pays salvage',
    sold.after.n === sold.before.n - 1 && sold.after.money > sold.before.money,
    `${sold.before.n}->${sold.after.n} plants, $${sold.before.money.toFixed(0)}->$${sold.after.money.toFixed(0)}`);
}

// ---- keyboard ---------------------------------------------------------------
await setSpeed(1);
await page.keyboard.press('Space');
await sleep(250);
const pA = await G(() => window.__gridling.state().tick);
await sleep(900);
const pB = await G(() => window.__gridling.state().tick);
check('Space pauses', pA === pB, `${pA} vs ${pB}`);
await page.keyboard.press('1');
await sleep(1100);
const pC = await G(() => window.__gridling.state().tick);
check('number key resumes the clock', pC > pB, `${pB} -> ${pC}`);

// ---- careful play across a couple of years ----------------------------------
console.log('--- playing several years ---');
await G(() => window.__gridling.setTps(10));
await page.click('#speeds button[data-speed="4"]');
const start = Date.now();
let built = 0, upgradesBought = 0, lastBuildTick = -999;
while (Date.now() - start < 150_000) {
  const s = await stats();
  if (s.over) break;
  const rep = await report();

  if (s.tick - lastBuildTick > 25 && s.money > 70) {
    const want = await G(() => {
      const g = window.__gridling.state();
      const sum = window.__gridling.summary(g);
      const n = (id) => g.plants.filter((p) => p.id === id).length;
      if (n('hydro') < 4 && g.money > 120) return ['hydro', ['river']];
      if (sum.firm < g.lastDemand * 1.45 && n('coal') < 3 && g.money > 150) return ['coal', ['grass', 'field']];
      if (sum.firm < g.lastDemand * 1.45 && g.money > 70) return ['gas', ['grass', 'field', 'hill']];
      if (n('battery') < 8 && g.money > 90) return ['battery', ['grass', 'field', 'forest']];
      if (g.money > 60) return ['solar', ['grass', 'field']];
      return null;
    });
    if (want) {
      const r = await build(want[0], want[1]);
      if (r.ok) built++;
      lastBuildTick = s.tick;
    }
  }
  if (s.money > 170) {
    await page.click('.tabs button[data-tab="upgrade"]');
    await sleep(150);
    for (const id of ['link', 'forecast', 'crew', 'smart']) {
      const btn = await page.$(`#upgrades button[data-up="${id}"]:not([disabled])`);
      if (btn) { await btn.click(); upgradesBought++; await sleep(120); }
    }
    await page.click('.tabs button[data-tab="build"]');
    await sleep(100);
  }
  const rep2 = await report();
  if (rep2.yearUps >= 2 && rep2.struck.length >= 2 && rep2.seasons.length >= 4) break;
  if (s.tick > 3200) break;
  await sleep(150);
}
const st2 = await stats();
const rep = await report();
await shot('08-mid-run');
check('run gets well past the opening minutes (2 years+)', st2.tick > 2400 && !st2.over,
  `tick=${st2.tick} (${Math.floor(st2.tick / 20)} days, ${rep.yearUps} new years)`);
check('all four seasons observed', rep.seasons.length >= 4, rep.seasons.join(','));
check('clicking to build keeps working over a long run', built >= 8, `${built} mouse builds`);
check('upgrading through the panel works', upgradesBought >= 2, `${upgradesBought} upgrades bought`);
check('disaster warnings appeared', rep.warned.length > 0, rep.warned.join(','));
check('disasters actually struck', rep.struck.length >= 2, rep.struck.join(','));
check('disasters did damage that crews repaired', rep.damage > 0 && rep.repairs > 0, `damage=${rep.damage} repairs=${rep.repairs}`);
check('difficulty ramps: new towns connected and the calendar advanced',
  rep.cities >= 4 && rep.year >= 3, `${rep.cities} towns, in year ${rep.year}`);
check('goodwill stayed above 55 with careful play', st2.sat > 55, `sat=${st2.sat}`);
const off1 = await offscreenReport();
check('layout / readability at 1440x900', off1.length === 0, off1.join(' | '));
const health = await canvasHealth();
check('map canvas renders varied content', health.distinct > 24, JSON.stringify(health));
const over1 = await overflowReport();
check('no text overflows its container', over1.length === 0, over1.join(' | '));

// narrower window
await page.setViewportSize({ width: 1120, height: 720 });
await sleep(800);
const off2 = await offscreenReport();
check('layout holds at 1120x720', off2.length === 0, off2.join(' | '));
await shot('10-narrow-window');
await page.setViewportSize({ width: 1440, height: 900 });
await sleep(600);

// ---- save, reload, continue -------------------------------------------------
console.log('--- save / reload / continue ---');
await setSpeed(0);
const saved = await saveNowAndRead();
check('save written to localStorage', await G(() => !!localStorage.getItem('gridling:autosave')));
await page.reload();
await sleep(900);
check('title offers Continue after reload', await page.isVisible('[data-a="continue"]'), await textOf('[data-a="continue"]'));
await shot('11-after-reload');
await page.click('[data-a="continue"]');
await sleep(800);
const after = await stats();
// Continue hands the run straight back to the clock, so tick and score may already
// have moved on a little; what must hold is the identity of the run.
check('run resumes after reload (plants / score / clock preserved)',
  saved.tick > 0 && after.plants === saved.plants && after.tick >= saved.tick &&
  after.tick <= saved.tick + 6 && after.score >= saved.score,
  JSON.stringify({ saved: [saved.tick, saved.plants, saved.score], after: [after.tick, after.plants, after.score] }));
await page.click('#speeds button[data-speed="4"]');
await sleep(2500);
const live = await stats();
check('loaded save keeps simulating', live.tick > after.tick && !live.over, `${after.tick} -> ${live.tick}`);

// ---- export, delete the saved run, import -----------------------------------
console.log('--- export / delete save / import ---');
await setSpeed(0);
await page.click('#btn-menu');
await sleep(400);
await shot('12-menu');
const dlP = page.waitForEvent('download', { timeout: 10000 });
await page.click('#modal-card [data-a="export"]');
const dl = await dlP.catch(() => null);
check('export produces a save file', !!dl, dl ? dl.suggestedFilename() : 'no download event');
const savePath = path.join(SHOTS, 'exported.gridling');
let exportedSnap = null;
if (dl) {
  await dl.saveAs(savePath);
  const parsed = JSON.parse(fs.readFileSync(savePath, 'utf8'));
  exportedSnap = { tick: parsed.data.tick, plants: parsed.data.plants.length, score: Math.round(parsed.data.score) };
  check('exported file is a real Gridling save',
    parsed.app === 'gridling' && parsed.kind === 'save' && fs.statSync(savePath).size > 800,
    `${fs.statSync(savePath).size} bytes, tick ${exportedSnap.tick}`);
}

// delete the saved run from the title screen, then confirm nothing is resumable
await page.reload();
await sleep(800);
await page.click('[data-a="forget"]');
await sleep(500);
const afterForget = await G(() => !!localStorage.getItem('gridling:autosave'));
check('Delete saved run clears the slot', afterForget === false);
await page.reload();
await sleep(800);
const titleBtns = await page.$$eval('#modal-card .acts button', (b) => b.map((x) => x.textContent.trim()));
check('cleared storage: no Continue offered on the title screen', !titleBtns.some((t) => /Continue/i.test(t)), titleBtns.join(' / '));

// start a fresh run and import the exported one over it
await page.click('#modal-card [data-a="new"]');
await sleep(600);
await dismissCoach();
const fresh = await stats();
check('new run really started fresh', fresh.tick < 10 && fresh.plants === 2, JSON.stringify({ tick: fresh.tick, plants: fresh.plants }));
await page.click('#btn-menu');
await sleep(350);
await page.click('#modal-card [data-a="import"]');
await sleep(400);
if (dl) await page.setInputFiles('#filein', savePath);
await sleep(400);
await page.click('#modal-card [data-a="go"]');
await sleep(1000);
const imported = await stats();
check('file import restores the exported run',
  exportedSnap && imported.plants === exportedSnap.plants &&
  imported.tick >= exportedSnap.tick && imported.tick <= exportedSnap.tick + 6 &&
  imported.score >= exportedSnap.score,
  JSON.stringify({ want: [exportedSnap?.tick, exportedSnap?.plants, exportedSnap?.score], got: [imported.tick, imported.plants, imported.score] }));
await shot('13-imported-run');

await page.click('#btn-menu');
await sleep(350);
await page.click('#modal-card [data-a="import"]');
await sleep(350);
await page.fill('#pastetext', fs.readFileSync(savePath, 'utf8'));
await page.click('#modal-card [data-a="go"]');
await sleep(1000);
const pasted = await stats();
check('pasted-JSON import works too', exportedSnap && pasted.plants === exportedSnap.plants &&
  pasted.tick >= exportedSnap.tick && pasted.tick <= exportedSnap.tick + 6, `tick ${pasted.tick} vs ${exportedSnap?.tick}`);

// ---- a careless player must lose --------------------------------------------
console.log('--- a careless player loses ---');
await G(() => { window.__gridling.newGame(); window.__gridling.setTps(16); });
await sleep(700);
await dismissCoach();
await page.click('#speeds button[data-speed="4"]');
let lost = null;
const deadline = Date.now() + 150_000;
while (Date.now() < deadline) {
  const s = await stats();
  if (s.over) { lost = s; break; }
  await sleep(300);
}
check('a careless player loses', !!lost, lost ? `${lost.over} after ${Math.floor(lost.tick / 20)} days` : 'still alive');
check('game-over screen shows the score', await page.isVisible('.bigscore'), await textOf('.bigscore'));
await shot('14-game-over');
const shown = parseInt((await textOf('.bigscore')).replace(/[^0-9]/g, ''), 10);
check('shown score matches the run state', !!lost && shown > 0 && Math.abs(shown - lost.score) <= 2, `shown ${shown} vs state ${lost && lost.score}`);
const scores = await G(() => JSON.parse(localStorage.getItem('gridling:scores') || '[]'));
check('best-score table persisted', scores.length >= 1, JSON.stringify(scores[0] || {}).slice(0, 200));

await page.reload();
await sleep(800);
await page.click('[data-a="continue"]');
await sleep(900);
const dead = await stats();
check('loading a finished save reports game over, not a live run', !!dead.over, dead.over || 'alive');

// ---- console hygiene --------------------------------------------------------
check('no uncaught page errors across the session', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
check('no console errors across the session', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
if (consoleWarns.length) console.log('note, console warnings:', consoleWarns.slice(0, 5));

fs.writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify({ results, consoleErrors, pageErrors, consoleWarns }, null, 2));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
await browser.close();
srv.close();
process.exit(failures ? 1 : 0);
