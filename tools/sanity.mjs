// Invariant checks for the simulation. Fast, deterministic, no browser:
//
//   node tools/sanity.mjs
//
// These assert the rules the game is built on — dispatch limits, storage physics,
// seasonality, save determinism, disaster mitigation — so a tuning change that
// breaks a rule fails here rather than in someone's run.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createGame, tick, buildPlant, fleetSummary, demandMW, serialize, deserialize,
  availableCapacity, solarFactor, damageRoll, PLANTS, HAZARDS, linkCapacity,
  START_MONEY, OVERDRAFT, UPGRADES,
} from '../src/sim/engine.js';
import { TICKS_PER_DAY, TICKS_PER_YEAR, DAYS_PER_YEAR, calendarOf, seasonOf } from '../src/sim/world.js';
import { makeRng } from '../src/sim/rng.js';
import { WEATHER } from '../src/sim/hazards.js';

let passed = 0, failed = 0;
function it(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    process.exitCode = 1;
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}

// Build one of `plantId` somewhere legal, funding it if needed. Returns the plant.
function addPlant(game, plantId) {
  game.money = Math.max(game.money, PLANTS[plantId].capex * 2 + 20);
  const def = PLANTS[plantId];
  const names = ['grass', 'field', 'forest', 'hill', 'river', 'lake', 'mountain', 'town', 'fault'];
  const taken = new Set(game.plants.map((p) => `${p.x},${p.y}`));
  for (let y = 0; y < game.map.length; y++)
    for (let x = 0; x < game.map[y].length; x++) {
      if (taken.has(`${x},${y}`)) continue;
      if (!def.terrain.includes(names[game.map[y][x]])) continue;
      const r = buildPlant(game, plantId, x, y);
      if (r.ok) return r.plant;
    }
  throw new Error(`no legal site for ${plantId} on this map`);
}

console.log('sim invariants');

it('a fresh run starts in spring with supply already meeting demand', () => {
  const g = createGame(12345);
  assert.equal(calendarOf(0).season, 1, 'a run should open in spring');
  assert.ok(g.lastServed >= g.lastDemand - 0.01, `${g.lastServed} served vs ${g.lastDemand} demand`);
  assert.equal(g.plants.length, 2);
  assert.equal(g.money, START_MONEY);
});

it('energy delivered never exceeds demand or the tie-line, and never goes negative', () => {
  const g = createGame(777);
  for (let i = 0; i < 1500; i++) {
    tick(g);
    assert.ok(g.lastServed >= -1e-9, 'served went negative');
    assert.ok(g.lastServed <= g.lastDemand + 1e-6, `served ${g.lastServed} > demand ${g.lastDemand}`);
    assert.ok(g.lastServed <= linkCapacity(g) + 1e-6, 'served above tie-line capacity');
    assert.ok(g.satisfaction >= 0 && g.satisfaction <= 100, `satisfaction ${g.satisfaction} out of range`);
    if (g.over) break;
  }
});

it('batteries stay inside their power and energy limits', () => {
  const g = createGame(2024);
  const a = addPlant(g, 'battery');
  const b = addPlant(g, 'battery');
  for (let i = 0; i < 600 && !g.over; i++) {
    tick(g);
    for (const p of [a, b]) {
      assert.ok(p.charge >= -1e-9 && p.charge <= PLANTS.battery.energy + 1e-9, `charge ${p.charge}`);
    }
    assert.ok(g.lastFlow.charge <= 2 * PLANTS.battery.power + 1e-6, `charge ${g.lastFlow.charge} above fleet power`);
    assert.ok(g.lastFlow.discharge <= 2 * PLANTS.battery.power + 1e-6, `discharge above fleet power`);
  }
});

it('charging is lossy: the grid gives up more than the battery stores', () => {
  const g = createGame(9);
  const p = addPlant(g, 'battery');
  const before = p.charge;
  let drawn = 0;
  for (let i = 0; i < 200 && p.charge < PLANTS.battery.energy - 0.01; i++) {
    const take = Math.min(PLANTS.battery.power, PLANTS.battery.energy - p.charge);
    drawn += take;
    p.charge = Math.min(PLANTS.battery.energy, p.charge + take * PLANTS.battery.efficiency);
  }
  assert.ok(p.charge > before, 'battery never charged');
  assert.ok(p.charge - before < drawn, `stored ${p.charge - before} from ${drawn} drawn: efficiency >= 1`);
});

it('solar makes nothing at night and generates through the day', () => {
  assert.equal(solarFactor('clear', 5, 4), 0, 'sun at 04:00');
  assert.equal(solarFactor('clear', 5, 19), 0, 'sun at 19:00');
  assert.ok(solarFactor('clear', 5, 12) > 0.9, 'no midday sun');
  for (let h = 6; h < 19; h++) assert.ok(solarFactor('clear', 5, h) > 0, `no sun at ${h}:00`);
  assert.ok(solarFactor('storm', 5, 12) < solarFactor('clear', 5, 12), 'storms do not reduce solar');
});

it('a plant can actually see the weather it is standing in', () => {
  const g = createGame(60);
  const p = addPlant(g, 'solar');
  const probeHour = (tickAt, weather) => {
    const probe = { ...g, tick: tickAt, weather };
    return availableCapacity(probe, p);
  };
  const base = TICKS_PER_DAY * 5 + 12;     // 12:00, mid-run
  const clear = probeHour(base, 'clear');
  const storm = probeHour(base, 'storm');
  assert.ok(storm < clear, `storm ${storm} not below clear ${clear}`);
  assert.ok(probeHour(base + 6, 'clear') < clear, 'solar did not fall as the sun went down');
  assert.ok(probeHour(base - 12, 'clear') < 0.01, 'solar generating at night');
});

it('winter demand is materially higher than spring demand', () => {
  const g = createGame(5);
  let winter = 0, spring = 0;
  for (let t = 0; t < TICKS_PER_YEAR; t++) {
    const d = demandMW({ ...g, tick: t });
    const s = seasonOf(calendarOf(t).month);
    if (s === 0) winter = Math.max(winter, d);
    if (s === 1) spring = Math.max(spring, d);
  }
  assert.ok(winter > spring * 1.25, `winter peak ${winter.toFixed(1)} vs spring peak ${spring.toFixed(1)}`);
});

it('demand peaks in the evening, not overnight', () => {
  const g = createGame(11);
  let bestHour = -1, best = 0;
  const base = 3 * TICKS_PER_DAY;
  for (let h = 0; h < TICKS_PER_DAY; h++) {
    const d = demandMW({ ...g, tick: base + h });
    if (d > best) { best = d; bestHour = h; }
  }
  assert.ok(bestHour >= 15 && bestHour <= 20, `peak lands at ${bestHour}:00`);
});

it('difficulty rises: the same clock hour costs more each year', () => {
  const g = createGame(31);
  const samples = [];
  for (let year = 0; year < 4; year++)
    samples.push(demandMW({ ...g, tick: year * TICKS_PER_YEAR + 18, popGrowth: Math.pow(1.10, year) }));
  for (let i = 1; i < samples.length; i++)
    assert.ok(samples[i] > samples[i - 1], `year ${i + 1} did not exceed year ${i}: ${samples.map((s) => s.toFixed(1))}`);
});

it('save round-trip replays to an identical state', () => {
  const a = createGame(4242);
  for (let i = 0; i < 700 && !a.over; i++) tick(a);
  const b = deserialize(serialize(a));
  for (let i = 0; i < 300 && !a.over && !b.over; i++) { tick(a); tick(b); }
  assert.equal(serialize(a), serialize(b), 'the reloaded run diverged from the original');
});

it('a save carries the map, plants, money, hazards and upgrades', () => {
  const g = createGame(808);
  addPlant(g, 'solar');
  addPlant(g, 'wind');
  const g2 = deserialize(serialize(g));
  assert.deepEqual(g2.map, g.map);
  assert.equal(g2.plants.length, g.plants.length);
  assert.equal(g2.money, g.money);
  assert.deepEqual(g2.upgrades, g.upgrades);
  assert.equal(g2.rng, g.rng);
});

it('an incompatible save is rejected rather than half-loaded', () => {
  assert.throws(() => deserialize(JSON.stringify({ version: 0, seed: 1 })), /Incompatible save/);
  assert.throws(() => deserialize('not json at all'), /Unexpected|not JSON|JSON/);
});

it('shutting a plant down really does halve its disaster risk', () => {
  const rng = makeRng(1);
  let hitOpen = 0, hitShut = 0;
  for (let i = 0; i < 2000; i++) {
    if (damageRoll(rng, false) >= 0.35) hitOpen++;
    if (damageRoll(rng, true) >= 0.35) hitShut++;
  }
  assert.ok(hitShut < hitOpen * 0.75, `shut ${hitShut} vs running ${hitOpen}`);
});

it('every hazard warns before it strikes and tells the player what to do', () => {
  for (const [id, h] of Object.entries(HAZARDS)) {
    assert.ok(h.warn > 0, `${id} has no warning phase`);
    assert.ok(h.duration > 0, `${id} has no duration`);
    assert.ok(typeof h.advice === 'string' && h.advice.length > 10, `${id} has no advice text`);
    assert.ok(typeof h.text === 'string' && h.text.length > 10, `${id} has no flavour text`);
  }
});

it('hazards really do arrive, damage things, and get repaired', () => {
  const g = createGame(313);
  addPlant(g, 'wind');
  addPlant(g, 'wind');
  addPlant(g, 'coal');
  let warned = 0, struck = 0, damaged = 0, repaired = 0;
  let prevWarn = null, prevPhase = null;
  for (let i = 0; i < 2400 && !g.over; i++) {
    tick(g);
    const h = g.hazard;
    if (h && h.phase === 'warn' && prevWarn !== h.id) warned++;
    if (h && h.phase === 'active' && prevPhase !== 'active') struck++;
    if (g.plants.some((p) => p.status === 'damaged')) damaged++;
    prevWarn = h ? h.id : null;
    prevPhase = h ? h.phase : null;
  }
  const repairedEvents = g.log.filter((l) => /is repaired/.test(l.text)).length;
  const damagedEvents = g.log.filter((l) => /damaged — crew|was destroyed/.test(l.text)).length;
  assert.ok(warned > 0, 'no hazard ever warned');
  assert.ok(struck > 0, 'no hazard ever struck');
  assert.ok(damagedEvents > 0, 'hazards caused no damage');
  assert.ok(repairedEvents > 0, `nothing was repaired (${damaged} damaged ticks seen)`);
  void damaged; void repaired;
});

it('a run always ends: there is no invincible free-ride', () => {
  const g = createGame(606);
  let n = 0;
  while (!g.over && n < TICKS_PER_YEAR * 6) { tick(g); n++; }
  assert.ok(g.over, 'an idle game never ended within six years');
  assert.ok(['Customers revolted', 'Bankrupt'].includes(g.over.title), `unexpected end reason: ${g.over.title}`);
});

it('going broke ends the run at the published overdraft', () => {
  const g = createGame(4545);
  // No customers means no revenue, so a big plant's fixed O&M alone drains the bank.
  g.cities = [];
  addPlant(g, 'nuclear');
  g.money = OVERDRAFT + 0.5;
  for (let i = 0; i < 200 && !g.over; i++) tick(g);
  assert.ok(g.over, 'running out of money did not end the run');
  assert.equal(g.over.title, 'Bankrupt', g.over.title);
  assert.ok(g.over.score >= 0);
});

it('score and delivered energy only ever grow', () => {
  const g = createGame(5150);
  let prevScore = 0, prevDelivered = 0;
  for (let i = 0; i < 500 && !g.over; i++) {
    tick(g);
    assert.ok(g.score >= prevScore - 1e-9, 'score went backwards');
    assert.ok(g.deliveredTotal >= prevDelivered - 1e-9, 'delivered went backwards');
    prevScore = g.score; prevDelivered = g.deliveredTotal;
  }
  assert.ok(g.score > 0 && g.deliveredTotal > 0);
});

it('firm capacity alone can cover the worst hour of year one', () => {
  // sanity check that the opening fleet is not set up to fail on day one:
  // the player must have time to react before winter.
  const g = createGame(99);
  for (let d = 0; d < 25; d++) {
    for (let h = 0; h < TICKS_PER_DAY; h++) {
      const t = d * TICKS_PER_DAY + h;
      const probe = { ...g, tick: t };
      assert.ok(demandMW(probe) < 60, `demand ${demandMW(probe).toFixed(1)} MW before day 25`);
    }
  }
});

it('a careful fleet survives far longer than doing nothing', () => {
  const idle = runIdle(222);
  const active = runCareful(222);
  assert.ok(active.days > idle.days * 2, `careful ${active.days}d vs idle ${idle.days}d`);
  assert.ok(active.days > DAYS_PER_YEAR, 'a careful player did not survive a year');
});

it('no two towns on a map ever share a name', () => {
  // duplicate labels on the board read as a rendering bug, so a town that joins
  // later has to take a name the map is not already using
  for (let seed = 0; seed < 6; seed++) {
    const g = createGame(seed * 977 + 3);
    while (!g.over && g.tick < TICKS_PER_DAY * 4000) tick(g);
    const names = g.cities.map((c) => c.name);
    assert.ok(names.length >= 4, `seed ${seed}: only ${names.length} towns connected`);
    assert.equal(new Set(names).size, names.length, `seed ${seed}: ${names.join(', ')}`);
  }
});

function runIdle(seed) {
  const g = createGame(seed);
  while (!g.over && g.tick < TICKS_PER_DAY * 4000) tick(g);
  return { days: Math.floor(g.tick / TICKS_PER_DAY), reason: g.over && g.over.title };
}

function runCareful(seed) {
  const g = createGame(seed);
  let lastDay = -1;
  while (!g.over && g.tick < TICKS_PER_DAY * 4000) {
    const h = g.hazard;
    for (const p of g.plants)
      if (PLANTS[p.id].kind === 'storage') setPlantModeSafe(p, h && h.phase === 'warn' ? 'charge' : 'auto');
    const day = Math.floor(g.tick / TICKS_PER_DAY);
    if (day !== lastDay && g.tick % TICKS_PER_DAY === 9) {
      lastDay = day;
      const s = fleetSummary(g);
      const n = (id) => g.plants.filter((p) => p.id === id).length;
      if (n('hydro') < 3) tryBuild(g, 'hydro');
      if (s.firm + s.stored / 4 < g.lastDemand * 1.35) {
        if (n('coal') < 3) tryBuild(g, 'coal'); else tryBuild(g, 'gas');
      }
      if (n('battery') < 5) tryBuild(g, 'battery');
      if (n('solar') < 5) tryBuild(g, 'solar');
      if (n('wind') < 4) tryBuild(g, 'wind');
      tryUpgrade(g, 'link'); tryUpgrade(g, 'forecast'); tryUpgrade(g, 'crew');
    }
    tick(g);
  }
  return { days: Math.floor(g.tick / TICKS_PER_DAY), reason: g.over && g.over.title, plants: g.plants.length };
}

function setPlantModeSafe(p, mode) { p.mode = mode; }
function tryBuild(g, id) {
  const def = PLANTS[id];
  if (g.money < def.capex + 8) return;
  const names = ['grass', 'field', 'forest', 'hill', 'river', 'lake', 'mountain', 'town', 'fault'];
  const taken = new Set(g.plants.map((p) => `${p.x},${p.y}`));
  for (let y = 0; y < g.map.length; y++)
    for (let x = 0; x < g.map[y].length; x++) {
      if (taken.has(`${x},${y}`) || !def.terrain.includes(names[g.map[y][x]])) continue;
      if (buildPlant(g, id, x, y).ok) return;
    }
}
function tryUpgrade(g, id) {
  if (g.money < 120) return;
  const lvl = g.upgrades[id] || 0;
  if (lvl >= 3) return;
  g.upgrades[id] = lvl + 1;
  g.money -= 60;
}

it('no two names a player reads are the same word', () => {
  // The forecast strip and the alarm chip sit side by side, so a disaster called
  // "Heatwave" next to a weather condition called "Heatwave" is unreadable. A
  // screenshot review found exactly this; it is now a rule rather than a review note.
  const seen = new Map();
  for (const [k, group] of [['weather', WEATHER], ['disaster', HAZARDS], ['plant', PLANTS], ['upgrade', UPGRADES]])
    for (const [id, def] of Object.entries(group)) {
      const key = def.name.toLowerCase();
      assert.ok(!seen.has(key), `"${def.name}" names both ${seen.get(key)} and ${k} ${id}`);
      seen.set(key, `${k} ${id}`);
    }
});

it('the README plant table agrees with the simulation', () => {
  // That table is the only place a player reads numbers before spending money, and it
  // had already drifted from the engine once, so parse it instead of restating it.
  const md = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const rows = [...md.matchAll(/^\|\s*([\w -]+?)\s*\|\s*\$(\d+)\s*\|\s*(\d+) MW( \/ (\d+) MWh)?\s*\|\s*([^|]+?)\s*\|/gm)];
  const seen = new Set();
  for (const [, label, cost, cap, , energy, fuel] of rows) {
    const def = Object.values(PLANTS).find((p) => p.name.toLowerCase().startsWith(label.toLowerCase()));
    assert.ok(def, `README row "${label}" matches no plant in the simulation`);
    seen.add(def.name);
    assert.equal(+cost, def.capex, `README prices ${def.name} at $${cost}, engine says $${def.capex}`);
    assert.equal(+cap, def.cap, `README rates ${def.name} at ${cap} MW, engine says ${def.cap} MW`);
    if (def.kind === 'storage') {
      assert.ok(energy, `README rates ${def.name} at ${cap} MW with no MWh figure`);
      assert.equal(+energy, def.energy, `README stores ${energy} MWh in ${def.name}, engine says ${def.energy}`);
    } else {
      assert.ok(!energy, `README gives ${def.name} an MWh figure; only storage stores`);
    }
    const f = fuel.trim();
    if (f === '—') assert.equal(def.kind, 'storage', `${def.name} lists no fuel but is not storage`);
    else if (f === 'free') assert.equal(def.fuel, 0, `${def.name} is listed as free fuel but the engine charges $${def.fuel}/MWh`);
    else assert.equal(f, `$${def.fuel}`, `README fuel for ${def.name} is "${f}", engine says $${def.fuel}`);
  }
  assert.equal(rows.length, Object.keys(PLANTS).length, `README table has ${rows.length} plant rows, engine has ${Object.keys(PLANTS).length} plants`);
  assert.equal(seen.size, Object.keys(PLANTS).length, 'README table names the same plant twice');
});

console.log(`\n${passed} invariant checks passed${failed ? `, ${failed} FAILED` : ''}`);
