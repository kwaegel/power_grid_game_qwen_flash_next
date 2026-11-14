// Headless play harness: drives the simulation with scripted player policies so
// balance can be measured without a browser. Run: node tools/balance.mjs
//
// Policies:
//   idle     — build nothing, never intervene (the "careless player")
//   greedy   — builds whatever is cheapest the moment cash appears (the "spammer")
//   careful  — plans around the evening peak, seasons, and warnings

import {
  createGame, tick, buildPlant, buyUpgrade, fleetSummary, demandMW, setPlantOn,
  setPlantMode, PLANTS, PLANT_ORDER, HAZARDS, serialize, deserialize,
} from '../src/sim/engine.js';
import { TICKS_PER_DAY, DAYS_PER_YEAR, calendarOf, T, TERRAIN_NAMES, MAP_ROWS, MAP_COLS } from '../src/sim/world.js';
import { demandCurve } from '../src/sim/world.js';

const ORDER = ['hydro', 'solar', 'wind', 'battery', 'gas', 'coal', 'nuclear'];

function* freeTiles(game, terrainOk) {
  const taken = new Set(game.plants.map((p) => `${p.x},${p.y}`));
  for (let y = 0; y < MAP_ROWS; y++)
    for (let x = 0; x < MAP_COLS; x++) {
      if (taken.has(`${x},${y}`)) continue;
      const t = TERRAIN_NAMES[game.map[y][x]];
      if (terrainOk.includes(t)) yield { x, y, t };
    }
}

function build(game, id, prefs = {}) {
  const def = PLANTS[id];
  if (def.maxCount && game.plants.filter((p) => p.id === id).length >= def.maxCount) return false;
  let tiles = [...freeTiles(game, def.terrain)];
  if (!tiles.length) return false;
  if (prefs.hillFirst) tiles.sort((a, b) => (b.t === 'hill') - (a.t === 'hill'));
  if (prefs.riverFirst) tiles.sort((a, b) => nearRiver(game, b) - nearRiver(game, a));
  for (const t of tiles) {
    const r = buildPlant(game, id, t.x, t.y);
    if (r.ok) return true;
  }
  return false;
}

function nearRiver(game, t) {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const ny = t.y + dy, nx = t.x + dx;
      if (ny < 0 || ny >= MAP_ROWS || nx < 0 || nx >= MAP_COLS) continue;
      if (game.map[ny][nx] === T.river || game.map[ny][nx] === T.lake) return 1;
    }
  return 0;
}

// estimate the next evening peak from the demand curve shape
function peakFactor(month) {
  let best = 0;
  for (let h = 0; h < 20; h++) {
    const d = demandCurveAt(month, h);
    if (d > best) best = d;
  }
  return best;
}
function demandCurveAt(month, hour) { return demandCurve(month, hour); }

function run(policy, seed, maxDays = 4000, quiet = false) {
  const g = createGame(seed);
  let firstHazard = null;
  while (!g.over && g.tick < maxDays * TICKS_PER_DAY) {
    if (policy) policy.act(g);
    const hBefore = g.hazard ? g.hazard.id : null;
    const phaseBefore = g.hazard ? g.hazard.phase : null;
    tick(g);
    if (!firstHazard && g.hazard && g.hazard.phase === 'active') firstHazard = g.hazard.id;
    if (policy && policy.watch) policy.watch(g);
  }
  const days = Math.floor(g.tick / TICKS_PER_DAY);
  return {
    seed,
    policy: policy ? (policy.name || 'anon') : 'anon',
    days,
    years: +(days / DAYS_PER_YEAR).toFixed(2),
    over: g.over ? g.over.title : 'not finished',
    reason: g.over ? g.over.detail : '',
    score: g.over ? g.over.score : Math.round(g.score),
    delivered: Math.round(g.deliveredTotal),
    peak: Math.round(g.peakMW),
    sat: Math.round(g.satisfaction),
    money: Math.round(g.money),
    plants: g.plants.length,
    cities: g.cities.length,
    firstHazard,
  };
}

// ---- policies ---------------------------------------------------------------

const idlePolicy = { name: 'idle', act() {} };

const greedyPolicy = { name: 'greedy', act(g) {
  for (const id of PLANT_ORDER) {
    while (g.money > PLANTS[id].capex + 5) if (!build(g, id)) break;
  }
} };

const carefulPolicy = { name: 'careful', act(g) {
  const cal = calendarOf(g.tick);
  const hour = g.tick % TICKS_PER_DAY;
  const s = fleetSummary(g);
  const demand = g.lastDemand;

  // 1. river sites first: hydro is free dispatchable power
  if (g.money > PLANTS.hydro.capex + 12 && g.plants.filter((p) => p.id === 'hydro').length < 2)
    build(g, 'hydro', { riverFirst: true });

  // 2. size firm capacity against the next evening peak, with a margin
  const wantPeak = demandMW(g) * peakFactor(cal.month) / Math.max(0.4, demandCurveAt(cal.month, hour)) * 0.9;
  const firm = s.firm + s.stored / 3;
  if (g.money > 40 && firm < wantPeak * 1.05) {
    const short = wantPeak - firm;
    if (short > 25 && g.money > PLANTS.nuclear.capex + 60 && nearRiverTiles(g)) build(g, 'nuclear');
    else if (short > 12 && g.money > PLANTS.coal.capex + 25) build(g, 'coal');
    else if (g.money > PLANTS.gas.capex + 15) build(g, 'gas');
  }

  // 3. renewables as fuel savings once firm capacity is adequate
  if (firm > wantPeak * 1.15 && g.money > 30) {
    if (cal.season !== 0 && g.plants.filter((p) => p.id === 'solar').length < 6) build(g, 'solar');
    else build(g, 'wind', { hillFirst: true });
  }

  // 4. storage: at least a few hours of margin at peak
  const nBatt = g.plants.filter((p) => p.id === 'battery').length;
  if (nBatt < 5 && g.money > PLANTS.battery.capex + 20 && s.stored < wantPeak * 2) build(g, 'battery');

  // 5. upgrades when affordable — link first, then forecast
  if (g.money > 90) buyUpgrade(g, 'link');
  if (g.money > 70 && (g.upgrades.forecast || 0) < 2) buyUpgrade(g, 'forecast');
  if (g.money > 60 && (g.upgrades.crew || 0) < 2) buyUpgrade(g, 'crew');
  if (g.money > 60 && (g.upgrades.smart || 0) < 2) buyUpgrade(g, 'smart');

  // 6. hazard response
  const h = g.hazard;
  if (h) {
    const def = HAZARDS[h.id];
    const exposed = g.plants.filter((p) => {
      if (!p.alive) return false;
      const d = PLANTS[p.id];
      return def.targets.includes('any') || def.targets.includes('thermal') && d.kind === 'thermal' || def.targets.includes(p.id);
    });
    if (h.phase === 'warn') {
      // charge everything while there is still headroom, unless the hit is imminent and cheap to skip
      for (const p of g.plants) if (PLANTS[p.id].kind === 'storage') setPlantMode(g, p.uid, 'charge');
      // shield turbines in a windstorm / ice storm; they are the thing that breaks
      if (def.targets.includes('wind')) for (const p of exposed) if (p.id === 'wind') setPlantOn(g, p.uid, false);
    } else {
      for (const p of g.plants) if (PLANTS[p.id].kind === 'storage') setPlantMode(g, p.uid, 'auto');
      if (def.targets.includes('wind')) for (const p of exposed) if (p.id === 'wind') setPlantOn(g, p.uid, false);
      else for (const p of exposed) if (p.id === 'wind' && !p.on && !h) setPlantOn(g, p.uid, true);
    }
  } else {
    for (const p of g.plants) if (p.id === 'wind' && !p.on) setPlantOn(g, p.uid, true);
  }

  // 7. keep a cash floor: do not go below 8
  if (g.money < 8) for (const p of g.plants) if (PLANTS[p.id].kind === 'storage') setPlantMode(g, p.uid, 'discharge');
} };

function nearRiverTiles(g) {
  for (const t of freeTiles(g, ['grass', 'field'])) if (nearRiver(g, t)) return true;
  return false;
}

// ---- main -------------------------------------------------------------------

const args = process.argv.slice(2);
const nSeeds = Number(args[0] || 8);
const policies = [idlePolicy, greedyPolicy, carefulPolicy];
const rows = [];
for (const pol of policies) {
  for (let i = 0; i < nSeeds; i++) rows.push(run(pol, 1000 + i * 7919));
}

const byPol = {};
for (const r of rows) (byPol[r.policy] ||= []).push(r);
console.log('policy      seeds  median days  years  min–max days        median score  first hazards');
for (const [name, rs] of Object.entries(byPol)) {
  const days = rs.map((r) => r.days).sort((a, b) => a - b);
  const med = days[Math.floor(days.length / 2)];
  const score = rs.map((r) => r.score).sort((a, b) => a - b)[Math.floor(rs.length / 2)];
  const hz = [...new Set(rs.map((r) => r.firstHazard))].join(',');
  console.log(
    name.padEnd(11), String(rs.length).padEnd(6),
    String(med).padEnd(12), (med / DAYS_PER_YEAR).toFixed(1).padEnd(6),
    `${days[0]}–${days[days.length - 1]}`.padEnd(18),
    String(score).padEnd(13), hz);
}
console.log('\nper-seed detail');
for (const r of rows) {
  console.log(`${r.policy.padEnd(9)} seed ${String(r.seed).padEnd(7)} ${String(r.days).padStart(4)}d y${r.years} over=${r.over.padEnd(22)} sat=${String(r.sat).padStart(3)} money=${String(r.money).padStart(6)} plants=${String(r.plants).padStart(2)} cities=${r.cities}`);
}

// round-trip check: serialize mid-run, deserialize, and replay identically
const a = createGame(4242);
for (let i = 0; i < 500; i++) tick(a);
const snap = serialize(a);
const b = deserialize(snap);
for (let i = 0; i < 200; i++) { tick(a); tick(b); }
const same = serialize(a) === serialize(b);
console.log(`\nsave round-trip replay identical: ${same}`);
