// The game engine. A deterministic state machine: createGame / tick / build /
// serialize / deserialize. No DOM, no timers — the whole simulation replays from
// a saved RNG state, which is what makes save/load and headless play-testing easy.
//
// Units: money in thousands of dollars (k$); per-MWh rates stored in $ and divided
// by 1000 when applied, so the plant table stays readable in real-world prices.
// Power in MW, energy in MWh. One tick = one in-game hour.

import { PLANTS, PLANT_ORDER, FUEL_COST } from './plants.js';
import {
  TICKS_PER_DAY, HOURS_PER_DAY, DAYS_PER_MONTH, DAYS_PER_YEAR,
  MONTH_NAMES, MAP_COLS, MAP_ROWS, T, TERRAIN_NAMES,
  generateMap, generateCities, demandCurve, seasonOf, calendarOf, NEW_TOWN_NAMES,
} from './world.js';
import { WEATHER, weatherCandidates, HAZARDS, hazardCandidates } from './hazards.js';
import { makeRng, randomSeed } from './rng.js';

export const SAVE_VERSION = 6;   // 6: a day is 24 ticks, so a tick no longer means the
                                 // same in-game hour - an old save must be refused with
                                 // a clear message rather than resumed on a wrong clock
export const TARIFF = 12;              // $ per MWh delivered
export const START_MONEY = 70;         // k$
export const OVERDRAFT = -12;          // k$: bankrupt below this
export const BASE_LINK_MW = 80;
export const LINK_PER_LEVEL_MW = 50;
export const DEMAND_TOLERANCE = [0.02, 0.07, 0.12];

export const UPGRADES = {
  link: {
    id: 'link', name: 'Grid Link', icon: 'upgrade:link', max: 5,
    costs: [35, 55, 80, 110, 150],
    desc: 'How much power the regional tie-line can carry.',
    at: (lvl) => `${BASE_LINK_MW + LINK_PER_LEVEL_MW * lvl} MW`,
  },
  forecast: {
    id: 'forecast', name: 'Weather Desk', icon: 'upgrade:forecast', max: 2,
    costs: [15, 34],
    desc: 'Earlier disaster warnings and a longer weather outlook.',
    at: (lvl) => ['base warning', 'warning ×1.6', 'warning ×2.2'][lvl],
  },
  smart: {
    id: 'smart', name: 'Smart Grid', icon: 'upgrade:smart', max: 2,
    costs: [18, 40],
    desc: 'Customers tolerate brief shortfalls and rebuild goodwill faster.',
    at: (lvl) => ['no tolerance', 'up to 7% unmet OK', 'up to 12% unmet OK'][lvl],
  },
  crew: {
    id: 'crew', name: 'Repair Crews', icon: 'upgrade:crew', max: 2,
    costs: [12, 28],
    desc: 'Damaged plants are back online sooner.',
    at: (lvl) => ['normal speed', '30% faster', '50% faster'][lvl],
  },
};

// ---- creation ---------------------------------------------------------------

export function createGame(seed = randomSeed()) {
  const rng = makeRng(seed);
  const map = generateMap(rng);
  const cities = generateCities(rng, map);

  const game = {
    version: SAVE_VERSION,
    seed,
    rng: rng.state(),
    tick: 0,
    money: START_MONEY,
    score: 0,
    deliveredTotal: 0,
    peakMW: 0,
    map,
    cities,
    plants: [],
    nextPlantId: 1,
    weather: 'clear',
    weatherTicksLeft: 6,
    forecast: [],
    hazard: null,
    // opening grace, in ticks: nothing can warn before the player has had a few
    // build cycles. A seed where a fire takes the starter coal station on day 4 is
    // not a hard decision, it is a coin flip that ends a brand-new run.
    hazardCooldown: TICKS_PER_DAY * 10,
    upgrades: { link: 0, forecast: 0, smart: 0, crew: 0 },
    satisfaction: 80,
    blackoutTicks: 0,
    lastDemand: 0,
    lastServed: 0,
    lastGen: {},
    lastFlow: { charge: 0, discharge: 0, curtail: 0, link: BASE_LINK_MW },
    nextCityTick: TICKS_PER_DAY * 26,
    lastYear: 1,
    popGrowth: 1,
    sevMult: 1,
    rateMult: 1,
    log: [],
    over: null,
  };

  // The starter fleet: one coal station and one gas peaker, pre-warmed to full
  // so the region is powered from the very first tick.
  const coalSpot = findBuildSpot(map, 'coal');
  if (coalSpot) {
    const p = placePlant(game, 'coal', coalSpot.x, coalSpot.y, true);
    p.out = PLANTS.coal.cap;
  }
  const gasSpot = findBuildSpot(map, 'gas');
  if (gasSpot) {
    const p = placePlant(game, 'gas', gasSpot.x, gasSpot.y, true);
    p.out = PLANTS.gas.cap;
  }

  // Prime the readouts so the very first frame already shows a powered region.
  const d0 = demandMW(game);
  game.lastDemand = d0;
  game.lastServed = Math.min(d0, PLANTS.coal.cap + PLANTS.gas.cap, linkCapacity(game));
  game.lastGen = { coal: PLANTS.coal.cap, gas: game.lastServed - PLANTS.coal.cap };

  const cal0 = calendarOf(0);
  game.weather = rng.weighted(weatherCandidates(cal0.season, cal0.month, null));
  game.forecast = rollForecast(game, rng);

  pushLog(game, 'Welcome to the regional grid. Keep the lights on and the books out of the red.', 'good');
  pushLog(game, 'Demand peaks near 18:00 and all through winter. The outlook strip above the map is your early warning.', 'info');
  return game;
}

function findBuildSpot(map, plantId) {
  const def = PLANTS[plantId];
  for (let r = 0; r < MAP_ROWS; r++)
    for (let c = 0; c < MAP_COLS; c++)
      if (def.terrain.includes(TERRAIN_NAMES[map[r][c]]) && map[r][c] !== T.fault) return { x: c, y: r };
  return null;
}

// ---- time helpers ------------------------------------------------------------

export function hourOf(tick) {
  return (tick % TICKS_PER_DAY) % HOURS_PER_DAY;
}

// ---- placement ---------------------------------------------------------------

export function canBuild(game, plantId, x, y) {
  const def = PLANTS[plantId];
  if (!def) return { ok: false, why: 'Unknown plant.' };
  if (x < 0 || y < 0 || x >= MAP_COLS || y >= MAP_ROWS) return { ok: false, why: 'Off the map.' };
  if (game.plants.some((p) => p.x === x && p.y === y && p.alive)) return { ok: false, why: 'That site is already used.' };
  const t = game.map[y][x];
  const tname = TERRAIN_NAMES[t];
  if (t === T.lake) return { ok: false, why: 'Open water — nothing can be built here.' };
  if (t === T.mountain) return { ok: false, why: 'Too steep to build.' };
  if (t === T.town) return { ok: false, why: 'A town stands there.' };
  if (t === T.fault) return { ok: false, why: 'Fault ground: unstable, nothing can be built on it.' };
  if (!def.terrain.includes(tname))
    return { ok: false, why: `${def.name} needs ${def.terrain.join(' or ')} — this site is ${tname}.` };
  if (def.maxCount && countType(game, plantId) >= def.maxCount)
    return { ok: false, why: `At most ${def.maxCount} ${def.name}s may operate at once.` };
  if (def.needsWater && !nearWater(game.map, x, y))
    return { ok: false, why: 'Nuclear needs river or lake water on an adjacent tile for cooling.' };
  if (game.money < def.capex)
    return { ok: false, why: `Costs $${money(def.capex)} — you have $${money(Math.max(0, game.money))}.` };

  const warnings = [];
  if (nearFault(game.map, x, y)) warnings.push('Next to fault ground — earthquakes hit harder here.');
  if (def.variable === 'solar' && nearTown(game.map, x, y)) warnings.push('Near a town: buildings shade the panels a little.');
  return { ok: true, terrain: tname, warnings };
}

function nearWater(map, x, y) { return nearType(map, x, y, T.river) || nearType(map, x, y, T.lake); }
function nearFault(map, x, y) { return nearType(map, x, y, T.fault); }
function nearTown(map, x, y) { return nearType(map, x, y, T.town); }

function nearType(map, x, y, t) {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const ny = y + dy, nx = x + dx;
      if (ny < 0 || ny >= MAP_ROWS || nx < 0 || nx >= MAP_COLS) continue;
      if (map[ny][nx] === t) return true;
    }
  return false;
}

export function countType(game, plantId) {
  return game.plants.filter((p) => p.id === plantId && p.alive).length;
}

function placePlant(game, plantId, x, y, free = false) {
  const def = PLANTS[plantId];
  const p = {
    uid: game.nextPlantId++,
    id: plantId,
    x, y,
    alive: true,
    on: true,
    out: 0,
    mode: 'auto',
    hp: 100,
    status: 'ok',
    repair: 0,
    charge: def.kind === 'storage' ? def.energy * 0.35 : 0,
    builtTick: game.tick,
  };
  game.plants.push(p);
  if (!free) game.money -= def.capex;
  return p;
}

export function buildPlant(game, plantId, x, y) {
  const check = canBuild(game, plantId, x, y);
  if (!check.ok) return check;
  const p = placePlant(game, plantId, x, y);
  pushLog(game, `${PLANTS[plantId].name} built for $${money(PLANTS[plantId].capex)}.`, 'good');
  return { ok: true, plant: p, warnings: check.warnings };
}

export function demolish(game, uid) {
  const i = game.plants.findIndex((q) => q.uid === uid);
  if (i < 0) return { ok: false, why: 'Nothing there.' };
  const p = game.plants[i];
  const def = PLANTS[p.id];
  const salvage = Math.round(def.capex * 0.3);
  game.money += salvage;
  game.plants.splice(i, 1);
  pushLog(game, `${def.name} decommissioned — salvaged $${money(salvage)}.`, 'info');
  return { ok: true };
}

export function setPlantOn(game, uid, on) {
  const p = game.plants.find((q) => q.uid === uid);
  if (p) p.on = on;
}

export function setPlantMode(game, uid, mode) {
  const p = game.plants.find((q) => q.uid === uid);
  if (p) p.mode = mode;
}

export function buyUpgrade(game, id) {
  const u = UPGRADES[id];
  const lvl = game.upgrades[id] || 0;
  if (!u || lvl >= u.max) return { ok: false, why: 'Already at maximum level.' };
  const cost = u.costs[lvl];
  if (game.money < cost) return { ok: false, why: `Costs $${money(cost)}.` };
  game.money -= cost;
  game.upgrades[id] = lvl + 1;
  pushLog(game, `${u.name} upgraded to level ${lvl + 1} for $${money(cost)}.`, 'good');
  return { ok: true };
}

// ---- capacity factors --------------------------------------------------------

export function daylight(hour) {
  if (hour <= 5 || hour >= 19) return 0;        // sunrise ~05:30, sunset ~18:30
  return Math.sin(((hour - 5.5) / 13) * Math.PI);
}

export function solarFactor(weather, month, hour) {
  const w = WEATHER[weather];
  const seasonLight = [0.62, 1.0, 1.12, 0.9][seasonOf(month)];
  return daylight(hour) * (w ? w.solar : 1) * seasonLight;
}

export function windFactor(weather, month, hill) {
  const w = WEATHER[weather];
  const seasonWind = [1.15, 0.95, 0.7, 1.3][seasonOf(month)];
  return (w ? w.wind : 1) * seasonWind * (hill ? 1.28 : 1);
}

export function hydroFactor(game, hazardMod) {
  const cal = calendarOf(game.tick);
  return [0.62, 1.25, 1.05, 0.85][cal.season] * hazardMod;
}

export function linkCapacity(game) {
  let cap = BASE_LINK_MW + LINK_PER_LEVEL_MW * (game.upgrades.link || 0);
  const h = game.hazard;
  if (h && h.phase === 'active') cap *= HAZARDS[h.id].lineMod ?? 1;
  return cap;
}

export function plantOutputFactor(game, p) {
  const def = PLANTS[p.id];
  let f = 1;
  const cal = calendarOf(game.tick);
  const hz = game.hazard;
  const hm = hz && hz.phase === 'active' ? HAZARDS[hz.id] : null;

  if (def.variable === 'solar') {
    f *= solarFactor(game.weather, cal.month, hourOf(game.tick));
    if (nearTown(game.map, p.x, p.y)) f *= 0.94;
  } else if (def.variable === 'wind') {
    let wf = windFactor(game.weather, cal.month, game.map[p.y][p.x] === T.hill);
    if (hm && hm.windMod != null) wf *= hm.windMod;
    f *= Math.min(1.35, wf);
  } else if (def.variable === 'hydro') {
    f *= Math.min(1, hydroFactor(game, hm && hm.hydroMod != null ? hm.hydroMod : 1));
  }
  if (p.status === 'damaged') f *= 0.35;
  return f;
}

export function availableCapacity(game, p) {
  const def = PLANTS[p.id];
  if (!p.alive || !p.on) return 0;
  if (def.kind === 'storage') return def.power;
  return def.cap * plantOutputFactor(game, p);
}

export function fleetSummary(game) {
  const byKind = {};
  let potential = 0, firm = 0, batteryPower = 0, stored = 0, storageCap = 0;
  for (const p of game.plants) {
    if (!p.alive) continue;
    const def = PLANTS[p.id];
    const av = availableCapacity(game, p);
    potential += av;
    if (def.kind === 'storage') {
      batteryPower += p.on ? def.power : 0;
      stored += p.charge;
      storageCap += def.energy;
      continue;
    }
    if (def.firm) firm += av;
    const k = byKind[p.id] || (byKind[p.id] = { cap: 0, out: 0, n: 0 });
    k.cap += av; k.out += p.out; k.n++;
  }
  return { byKind, potential, firm, batteryPower, stored, storageCap, link: linkCapacity(game) };
}

export function demandMW(game) {
  const hour = hourOf(game.tick);
  const cal = calendarOf(game.tick);
  const w = WEATHER[game.weather];
  let mult = demandCurve(cal.month, hour) * (w ? w.demand : 1);
  const hz = game.hazard;
  if (hz && hz.phase === 'active') mult *= HAZARDS[hz.id].demandMod ?? 1;
  let d = 0;
  for (const c of game.cities) d += c.pop * (game.popGrowth || 1) * mult * (c.cityMult || 1);
  return d;
}

// ---- the tick ----------------------------------------------------------------

export function tick(game) {
  if (game.over) return game;
  game.tick++;
  const rng = makeRng(0);
  rng.setState(game.rng);

  stepWeather(game, rng);
  stepHazard(game, rng);

  const hz = game.hazard;
  const hm = hz && hz.phase === 'active' ? HAZARDS[hz.id] : null;

  const demand = demandMW(game);
  game.lastDemand = demand;

  const thermal = game.plants.filter((p) => p.alive && PLANTS[p.id].kind === 'thermal' && p.on);
  const renewables = game.plants.filter((p) => p.alive && PLANTS[p.id].kind === 'renewable' && p.on);
  const stores = game.plants.filter((p) => p.alive && PLANTS[p.id].kind === 'storage' && p.on);

  // 1. renewables run flat out (zero marginal cost)
  let green = 0;
  const gen = {};
  for (const p of renewables) {
    p.out = availableCapacity(game, p);
    gen[p.id] = (gen[p.id] || 0) + p.out;
    green += p.out;
  }

  // 2. thermal fills the rest, cheapest fuel first, ramp-limited
  let need = Math.max(0, demand - green);
  let thermalOut = 0;
  thermal.sort((a, b) => FUEL_COST[a.id] - FUEL_COST[b.id]);
  for (const p of thermal) {
    const def = PLANTS[p.id];
    const want = Math.min(def.cap * plantOutputFactor(game, p), p.out + def.ramp * def.cap, need);
    p.out = Math.max(0, want);
    need -= p.out;
    thermalOut += p.out;
    gen[p.id] = (gen[p.id] || 0) + p.out;
  }
  const supply = green + thermalOut;

  // 3. batteries. Discharge serves the gap first (forced modes, then auto);
  //    charging only soaks up surplus, so charging can never itself cause a blackout.
  let charge = 0, discharge = 0;
  for (const p of stores) {
    const def = PLANTS[p.id];
    p._d = 0;
    if (p.mode === 'discharge') { const d = Math.min(def.power, p.charge); p._d = -d; discharge += d; }
  }
  let deficit = Math.max(0, demand - supply - discharge);
  for (const p of stores) {
    if (p.mode !== 'auto' || deficit <= 0) continue;
    const def = PLANTS[p.id];
    const d = Math.min(def.power, p.charge, deficit);
    if (d > 0) { p._d = -d; discharge += d; deficit -= d; }
  }
  let surplus = Math.max(0, supply + discharge - demand);
  for (const p of stores) {
    if (p.mode === 'discharge' || surplus <= 0) continue;
    const def = PLANTS[p.id];
    const c = Math.min(def.power, def.energy - p.charge, surplus);
    if (c > 0) { p._d = c; charge += c; surplus -= c; }
  }
  for (const p of stores) {
    const def = PLANTS[p.id];
    const d = p._d;
    p._d = 0;
    if (d > 0) p.charge = Math.min(def.energy, p.charge + d * def.efficiency);
    else if (d < 0) p.charge = Math.max(0, p.charge + d);
  }
  const curtail = surplus;

  // 4. the tie-line caps what actually reaches customers
  const available = Math.max(0, supply + discharge - charge);
  const served = Math.min(demand, available, linkCapacity(game));
  const unmet = Math.max(0, demand - served);

  // 5. money. Fixed O&M is priced per MW of rated capacity (k$/h = opex * cap / 1000),
  //    fuel is per MWh actually generated.
  const revenue = served * TARIFF / 1000;
  let fuelCost = 0, opexCost = 0;
  for (const p of game.plants) {
    if (!p.alive) continue;
    const def = PLANTS[p.id];
    opexCost += def.opex * def.cap / 1000;
    if (def.kind === 'thermal') fuelCost += p.out * def.fuel / 1000;
  }
  game.money += revenue - fuelCost - opexCost;

  // 6. satisfaction
  const tol = DEMAND_TOLERANCE[game.upgrades.smart || 0];
  const unmetFrac = demand > 0 ? unmet / demand : 0;
  let sat = game.satisfaction;
  if (unmetFrac > tol) {
    const over = unmetFrac - tol;
    sat -= over * 2.0;              // a total blackout is fatal in about three days
    game.blackoutTicks++;
    for (const c of game.cities) c.mood = Math.max(0, c.mood - over * 3);
  } else {
    let smog = 0;
    for (const p of game.plants) if (p.alive && PLANTS[p.id].smog && p.out > 0.01) smog += PLANTS[p.id].smog;
    const ceiling = 100 - smog * 3;
    if (sat < ceiling) sat += 0.45 * (1 + (game.upgrades.smart || 0) * 0.5);
    else sat -= 0.10;
    for (const c of game.cities) c.mood = Math.min(100, c.mood + 0.3);
  }
  game.satisfaction = clamp(sat, 0, 100);

  // 7. score
  game.deliveredTotal += served;
  game.peakMW = Math.max(game.peakMW, served);
  game.score += served * (0.5 + game.satisfaction / 100);

  game.lastServed = served;
  game.lastGen = gen;
  game.lastFlow = { charge, discharge, curtail, link: linkCapacity(game) };

  stepDamageAndRepair(game, rng, hm);
  stepCalendar(game, rng);

  if (game.satisfaction <= 0.5) {
    endGame(game, 'Customers revolted',
      'Sustained blackouts ended it: the regulator revoked your licence and the board dissolved the utility.');
  } else if (game.money < OVERDRAFT) {
    endGame(game, 'Bankrupt',
      'The fuel bills came due and there was nothing left in the bank.');
  }

  game.rng = rng.state();
  trimLog(game);
  return game;
}

// ---- systems -----------------------------------------------------------------

function stepWeather(game, rng) {
  const cal = calendarOf(game.tick);
  game.weatherTicksLeft--;
  if (game.weatherTicksLeft > 0) return;
  game.weather = game.forecast[0] ?? rng.weighted(weatherCandidates(cal.season, cal.month, game.weather));
  game.weatherTicksLeft = rng.int(6, 16);
  game.forecast = rollForecast(game, rng);
}

function rollForecast(game, rng) {
  const cal = calendarOf(game.tick);
  const n = [1, 2, 3][game.upgrades.forecast || 0];
  const out = [];
  let cur = game.weather;
  for (let i = 0; i < n; i++) {
    cur = rng.weighted(weatherCandidates(cal.season, cal.month, cur));
    out.push(cur);
  }
  return out;
}

function warnTicks(game, h) {
  return Math.round(h.warn * [1, 1.6, 2.2][game.upgrades.forecast || 0]);
}

function stepHazard(game, rng) {
  const cal = calendarOf(game.tick);
  const h = game.hazard;
  if (h) {
    h.ticksLeft--;
    if (h.phase === 'warn' && h.ticksLeft <= 0) {
      h.phase = 'active';
      h.ticksLeft = Math.round(HAZARDS[h.id].duration * game.sevMult);
      pushLog(game, `${HAZARDS[h.id].name} has struck! ${HAZARDS[h.id].text}`, 'bad', HAZARDS[h.id].icon);
      applyInitialDamage(game, rng, h);
    } else if (h.phase === 'active' && h.ticksLeft <= 0) {
      pushLog(game, `The ${HAZARDS[h.id].name.toLowerCase()} has passed.`, 'good', HAZARDS[h.id].icon);
      game.hazard = null;
      game.hazardCooldown = Math.round(rng.range(22, 52) / game.rateMult);
    }
    return;
  }
  game.hazardCooldown--;
  if (game.hazardCooldown > 0) return;
  const pPer = 0.011 * (1 + 0.32 * (cal.year - 1));
  if (!rng.chance(pPer)) return;
  const id = hazardCandidates(cal.month, cal.year, rng);
  const hdef = HAZARDS[id];
  const w = warnTicks(game, hdef);
  game.hazard = { id, phase: 'warn', ticksLeft: w, warnTotal: w };
  pushLog(game, `Forecast warning: ${hdef.name} incoming. ${hdef.advice}`, 'warn', hdef.icon);
}

function eligibleTargets(game, hdef) {
  if (!hdef.targets || hdef.targets.length === 0) return [];
  const list = [];
  for (const p of game.plants) {
    if (!p.alive) continue;
    const def = PLANTS[p.id];
    if (hdef.targets.includes('any') || (hdef.targets.includes('thermal') && def.kind === 'thermal')
      || hdef.targets.includes(p.id)) list.push(p);
  }
  return list;
}

// epicentre for quake-type events: biased toward fault tiles, so siting matters
function epicentre(game, rng) {
  const faults = [];
  for (let r = 0; r < MAP_ROWS; r++)
    for (let c = 0; c < MAP_COLS; c++) if (game.map[r][c] === T.fault) faults.push({ x: c, y: r });
  if (faults.length && rng.chance(0.75)) return rng.pick(faults);
  return { x: rng.int(0, MAP_COLS - 1), y: rng.int(0, MAP_ROWS - 1) };
}

function applyInitialDamage(game, rng, h) {
  const hdef = HAZARDS[h.id];
  if (hdef.damageNear) {
    const ep = epicentre(game, rng);
    let hit = 0;
    for (const p of game.plants) {
      if (!p.alive) continue;
      const d = Math.max(Math.abs(p.x - ep.x), Math.abs(p.y - ep.y));
      if (d > hdef.damageNear) continue;
      if (rng.chance(d === 0 ? 0.85 : d === 1 ? 0.55 : 0.25)) { damagePlant(game, rng, p, hdef); hit++; }
    }
    if (hit) pushLog(game, `Quake damage centred near ${ep.x},${ep.y}.`, 'bad', HAZARDS.quake.icon);
    return;
  }
  const targets = eligibleTargets(game, hdef);
  if (!targets.length) return;
  const n = rng.int(1, Math.min(targets.length, 2));
  rng.shuffle(targets);
  for (let i = 0; i < n; i++) damagePlant(game, rng, targets[i], hdef);
}

// A plant that is shut down is far less likely to be hurt by a hazard.
export function damageRoll(rng, shielded) {
  return shielded ? rng.next() * 0.5 : rng.next();
}
function damagePlant(game, rng, p, hdef) {
  const def = PLANTS[p.id];
  const shielded = !p.on;                     // shutting a plant down halves its risk
  if (damageRoll(rng, shielded) < 0.35) return;
  const dmg = Math.round(hdef.repairCost * 100 * (shielded ? 0.5 : 1) * game.sevMult * rng.range(0.7, 1.3));
  p.hp -= dmg;
  if (p.hp <= 0) {
    if (p.id === 'nuclear') return meltdown(game, p);
    const i = game.plants.findIndex((q) => q.uid === p.uid);
    if (i >= 0) game.plants.splice(i, 1);
    pushLog(game, `${def.name} was destroyed. The site is clear, but you must rebuild.`, 'bad', def.icon);
  } else {
    p.status = 'damaged';
    p.repair = Math.round((5 + dmg * 0.3) * [1, 0.7, 0.5][game.upgrades.crew || 0]);
    const cost = Math.max(1, Math.round(def.capex * 0.02 * game.sevMult));
    game.money -= cost;
    pushLog(game, `${def.name} damaged — crew dispatched ($${money(cost)}).`, 'bad', def.icon);
  }
}

function meltdown(game, p) {
  const i = game.plants.findIndex((q) => q.uid === p.uid);
  if (i >= 0) game.plants.splice(i, 1);
  game.map[p.y][p.x] = T.mountain;           // permanent exclusion zone
  game.money -= 60;
  game.satisfaction = clamp(game.satisfaction - 22, 0, 100);
  pushLog(game, 'MELTDOWN! The reactor core is lost and the site is a permanent exclusion zone.', 'bad', 'plant:nuclear');
}

function stepDamageAndRepair(game, rng, hm) {
  for (const p of game.plants) {
    if (p.status !== 'damaged') continue;
    p.repair--;
    if (p.repair <= 0) {
      p.status = 'ok';
      p.hp = 100;
      pushLog(game, `${PLANTS[p.id].name} is repaired and back to full output.`, 'good', PLANTS[p.id].icon);
    }
  }
  if (hm && hm.targets && hm.targets.length && game.tick % 12 === 0) {
    const targets = eligibleTargets(game, hm);
    if (targets.length && rng.chance(0.3)) damagePlant(game, rng, rng.pick(targets), hm);
  }
}

function stepCalendar(game, rng) {
  const cal = calendarOf(game.tick);
  const onDayEdge = game.tick % TICKS_PER_DAY === 0;
  if (onDayEdge && cal.dom === 1)
    pushLog(game, `— ${MONTH_NAMES[cal.month]}, Year ${cal.year} · ${seasonName(cal.season)} —`, 'info');

  if (onDayEdge && cal.year > game.lastYear) {
    game.lastYear = cal.year;
    game.popGrowth *= 1.10;
    game.sevMult = 1 + 0.14 * (cal.year - 1);
    game.rateMult = 1 + 0.30 * (cal.year - 1);
    pushLog(game, `Year ${cal.year} begins. Demand is climbing and the weather is turning meaner.`, 'warn', 'mark:town');
  }

  if (game.tick >= game.nextCityTick && game.cities.length < 6) {
    const spot = findCitySpot(game);
    if (spot) {
      // never reuse a name already on the map: two "Fernbrook" labels read as a bug
      const taken = new Set(game.cities.map((c) => c.name));
      const fresh = NEW_TOWN_NAMES.filter((n) => !taken.has(n));
      const name = fresh.length ? rng.pick(fresh) : `Town ${game.cities.length + 1}`;
      game.map[spot.y][spot.x] = T.town;
      game.cities.push({
        x: spot.x, y: spot.y, name,
        pop: 6 + game.cities.length * 2, cityMult: 0.9, mood: 60, satisfaction: 60,
        delivered: 0, served: 0,
      });
      game.nextCityTick = game.tick + TICKS_PER_DAY * (30 + rng.int(0, 22));
      pushLog(game, `${name} has joined the grid — demand rises for good.`, 'warn', 'mark:town');
    } else {
      game.nextCityTick = game.tick + TICKS_PER_DAY * 12;
    }
  }
}

function findCitySpot(game) {
  const spots = [];
  for (let r = 1; r < MAP_ROWS - 1; r++)
    for (let c = 0; c < MAP_COLS; c++) {
      const t = game.map[r][c];
      if (t !== T.grass && t !== T.field && t !== T.forest) continue;
      if (game.plants.some((p) => p.alive && p.x === c && p.y === r)) continue;
      spots.push({ x: c, y: r });
    }
  if (!spots.length) return null;
  let best = spots[0], bestScore = -1;
  for (const s of spots) {
    let near = 0;
    for (const c of game.cities) near += 1 / (1 + Math.abs(c.x - s.x) + Math.abs(c.y - s.y));
    if (near > bestScore) { bestScore = near; best = s; }
  }
  return best;
}

export function seasonName(i) {
  return ['Winter', 'Spring', 'Summer', 'Autumn'][i];
}

// ---- misc --------------------------------------------------------------------

// Money is k$ everywhere in the simulation, so every amount on screen is printed in
// the same unit the labels state. An earlier version switched to "4.68m" past a
// million, which contradicted the "Cash (k$)" stat sitting right above it.
export function money(k) {
  return Math.round(k).toLocaleString('en-US');
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function pushLog(game, text, kind = 'info', icon = null) { game.log.push({ tick: game.tick, text, kind, icon }); }
function trimLog(game) { if (game.log.length > 80) game.log.splice(0, game.log.length - 80); }

function endGame(game, title, detail) {
  game.over = {
    title, detail,
    tick: game.tick,
    score: Math.round(game.score),
    days: Math.floor(game.tick / TICKS_PER_DAY),
    delivered: Math.round(game.deliveredTotal),
    peak: Math.round(game.peakMW),
    satisfaction: Math.round(game.satisfaction),
  };
  pushLog(game, `${title}: ${detail}`, 'bad');
}

// ---- save / load -------------------------------------------------------------

const SAVE_KEYS = [
  'version', 'seed', 'rng', 'tick', 'money', 'score', 'deliveredTotal', 'peakMW',
  'map', 'cities', 'plants', 'nextPlantId', 'weather', 'weatherTicksLeft', 'forecast',
  'hazard', 'hazardCooldown', 'upgrades', 'satisfaction', 'blackoutTicks', 'nextCityTick',
  'lastYear', 'popGrowth', 'sevMult', 'rateMult', 'log', 'over',
];

export function serialize(game) {
  const out = {};
  for (const k of SAVE_KEYS) out[k] = game[k];
  out.version = SAVE_VERSION;
  return JSON.stringify(out);
}

export function deserialize(text) {
  const d = typeof text === 'string' ? JSON.parse(text) : text;
  if (!d || d.version !== SAVE_VERSION)
    throw new Error(`Incompatible save (version ${d && d.version}, this build wants ${SAVE_VERSION})`);
  const g = {
    lastDemand: 0, lastServed: 0, lastGen: {},
    lastFlow: { charge: 0, discharge: 0, curtail: 0, link: BASE_LINK_MW },
    plants: [], cities: [], log: [], upgrades: { link: 0, forecast: 0, smart: 0, crew: 0 },
  };
  for (const k of SAVE_KEYS) if (k in d) g[k] = d[k];
  if (g.popGrowth == null) g.popGrowth = 1;
  if (g.sevMult == null) g.sevMult = 1;
  if (g.rateMult == null) g.rateMult = 1;
  if (!g.upgrades) g.upgrades = { link: 0, forecast: 0, smart: 0, crew: 0 };
  return g;
}

export { PLANTS, PLANT_ORDER, MONTH_NAMES, HAZARDS, WEATHER, T, TERRAIN_NAMES, MAP_COLS, MAP_ROWS };
