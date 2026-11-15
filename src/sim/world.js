// Time model, terrain map, city model, weather/season demand curves.
import { PLANTS } from './plants.js';

export const TICKS_PER_HOUR = 1;      // one sim tick = one in-game hour
export const HOURS_PER_DAY = 20;
export const DAYS_PER_MONTH = 5;
export const MONTHS = 12;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS;   // 60 days
export const TICKS_PER_DAY = HOURS_PER_DAY * TICKS_PER_HOUR; // 20
export const TICKS_PER_YEAR = TICKS_PER_DAY * DAYS_PER_YEAR; // 1200

export const MONTH_NAMES = [
  'Frostbite', 'Thaw', 'Sprout', 'Bloom', 'Green', 'Longlight',
  'Scorch', 'Harvest', 'Amber', 'Gale', 'Fog', 'Hearth',
];
export const SEASON_NAMES = ['Winter', 'Spring', 'Summer', 'Autumn'];

// month index -> season index
export function seasonOf(month) {
  if (month === 11 || month <= 1) return 0; // Winter: Hearth, Frostbite, Thaw
  if (month <= 4) return 1;                 // Spring: Sprout, Bloom, Green
  if (month <= 7) return 2;                 // Summer: Longlight, Scorch, Harvest
  return 3;                                 // Autumn: Amber, Gale, Fog
}

export function seasonLabel(month) {
  return SEASON_NAMES[seasonOf(month)];
}

// ---- Terrain ----------------------------------------------------------------

export const MAP_COLS = 16;
export const MAP_ROWS = 9;

// t: 0 grass, 1 field, 2 forest, 3 hill, 4 river, 5 lake, 6 mountain, 7 town, 8 fault
export const T = { grass: 0, field: 1, forest: 2, hill: 3, river: 4, lake: 5, mountain: 6, town: 7, fault: 8 };
export const TERRAIN_NAMES = ['grass', 'field', 'forest', 'hill', 'river', 'lake', 'mountain', 'town', 'fault'];

const PALETTE = {
  [T.grass]: ['#a9d68c', '#b4dd98'],
  [T.field]: ['#d8c98f', '#e0d39c'],
  [T.forest]: ['#7cbf8f', '#8ccaa0'],
  [T.hill]: ['#9fc0b9', '#adc9c3'],
  [T.river]: ['#8fc3e8', '#9dcef0'],
  [T.lake]: ['#7fb8e6', '#8fc3ec'],
  [T.mountain]: ['#c3c6cf', '#ced1d9'],
  [T.town]: ['#e3b7a0', '#e9c3ae'],
  [T.fault]: ['#d9a3a3', '#e0afaf'],
};

export function terrainColor(t, variant = 0) {
  const p = PALETTE[t] || PALETTE[T.grass];
  return p[variant % p.length];
}

export function terrainBlocksPlant(t) {
  return t === T.lake || t === T.mountain || t === T.town || t === T.fault;
}

// ---- Map generation ---------------------------------------------------------

export function generateMap(rng) {
  const g = Array.from({ length: MAP_ROWS }, () => new Array(MAP_COLS).fill(T.grass));

  // two river systems snaking roughly vertically, plus a lake on one
  const riverCols = [];
  let c = rng.int(2, 5);
  riverCols.push(c);
  for (let r = 0; r < MAP_ROWS; r++) {
    g[r][c] = T.river;
    if (r === 4 && rng.chance(0.55)) g[r][Math.min(MAP_COLS - 1, c + 1)] = T.lake;
    c += rng.chance(0.55) ? 1 : rng.chance(0.5) ? -1 : 0;
    c = Math.max(1, Math.min(MAP_COLS - 2, c));
  }
  c = rng.int(9, 13);
  riverCols.push(c);
  for (let r = 0; r < MAP_ROWS; r++) {
    if (g[r][c] === T.river) continue;
    g[r][c] = T.river;
    if (r === 2 && rng.chance(0.5)) g[r][Math.max(0, c - 1)] = T.lake;
    c += rng.chance(0.5) ? -1 : rng.chance(0.5) ? 1 : 0;
    c = Math.max(1, Math.min(MAP_COLS - 2, c));
  }

  // hills, clustered
  for (let i = 0; i < 3; i++) {
    let hx = rng.int(1, MAP_COLS - 2), hy = rng.int(1, MAP_ROWS - 2);
    const n = rng.int(3, 6);
    for (let k = 0; k < n; k++) {
      if (g[hy][hx] === T.grass) g[hy][hx] = T.hill;
      hx = Math.max(0, Math.min(MAP_COLS - 1, hx + rng.int(-1, 1)));
      hy = Math.max(0, Math.min(MAP_ROWS - 1, hy + rng.int(-1, 1)));
    }
  }
  // mountains (impassable decoration) on some hills
  for (let r = 0; r < MAP_ROWS; r++)
    for (let c2 = 0; c2 < MAP_COLS; c2++)
      if (g[r][c2] === T.hill && rng.chance(0.14)) g[r][c2] = T.mountain;

  // fields + forest patches
  for (let i = 0; i < 4; i++) {
    let hx = rng.int(0, MAP_COLS - 1), hy = rng.int(0, MAP_ROWS - 1);
    const n = rng.int(3, 7);
    for (let k = 0; k < n; k++) {
      if (g[hy][hx] === T.grass) g[hy][hx] = T.field;
      hx = Math.max(0, Math.min(MAP_COLS - 1, hx + rng.int(-1, 1)));
      hy = Math.max(0, Math.min(MAP_ROWS - 1, hy + rng.int(-1, 1)));
    }
  }
  for (let i = 0; i < 4; i++) {
    let hx = rng.int(0, MAP_COLS - 1), hy = rng.int(0, MAP_ROWS - 1);
    const n = rng.int(2, 5);
    for (let k = 0; k < n; k++) {
      if (g[hy][hx] === T.grass) g[hy][hx] = T.forest;
      hx = Math.max(0, Math.min(MAP_COLS - 1, hx + rng.int(-1, 1)));
      hy = Math.max(0, Math.min(MAP_ROWS - 1, hy + rng.int(-1, 1)));
    }
  }

  // fault lines: cracked ground near lakes/rivers, disaster-prone but fine to build next to
  for (let r = 0; r < MAP_ROWS; r++)
    for (let c2 = 0; c2 < MAP_COLS; c2++)
      if (g[r][c2] === T.grass && nearType(g, c2, r, T.lake, 1) && rng.chance(0.3)) g[r][c2] = T.fault;

  return g;
}

function nearType(g, x, y, t, radius) {
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const ny = y + dy, nx = x + dx;
      if (ny >= 0 && ny < MAP_ROWS && nx >= 0 && nx < MAP_COLS && g[ny][nx] === t) return true;
    }
  return false;
}

export function adjacencyBonusFor(map, x, y, plantId) {
  let m = 1;
  const def = PLANTS[plantId];
  if (def && def.needsWater) {
    m *= nearType(map, x, y, T.river, 1) || nearType(map, x, y, T.lake, 1) ? 1 : 0.55;
  }
  return m;
}
// ---- Cities -----------------------------------------------------------------

const CITY_NAMES = [
  'Pebbleton', 'Willowmere', 'Acornvale', 'Mistral Bay', 'Tumblewood', 'Hearthstead',
];

// towns that connect later in a run, kept distinct from the founding names so a
// map never shows the same label twice
export const NEW_TOWN_NAMES = [
  'Copperfield', 'Fernbrook', 'Stonegate', 'Larkspur', 'Bramblewick', 'Dunmoor',
];

export function generateCities(rng, map) {
  const spots = [];
  for (let r = 1; r < MAP_ROWS - 1; r++)
    for (let c = 0; c < MAP_COLS; c++)
      if (!terrainBlocksPlant(map[r][c])) spots.push([c, r]);
  rng.shuffle(spots);
  const cities = [];
  const names = rng.shuffle(CITY_NAMES.slice());
  let tries = 0;
  for (const [x, y] of spots) {
    if (cities.length >= 3 || tries > 200) break;
    tries++;
    let ok = true;
    for (const o of cities) {
      if (Math.abs(o.x - x) + Math.abs(o.y - y) < 4) { ok = false; break; }
    }
    if (!ok) continue;
    map[y][x] = T.town;
    cities.push({
      x, y, name: names[cities.length],
      pop: 6 + cities.length * 4 + rng.int(0, 4),
      mood: 70,
      satisfaction: 70,
      delivered: 0, served: 0,
    });
  }
  return cities;
}

// ---- Demand curves ----------------------------------------------------------
// hour in [0, HOURS_PER_DAY), month in [0, 12). Returns a multiplier around 1.

export function demandCurve(month, hour) {
  const season = seasonOf(month);
  // daily shape: morning bump ~h7, big evening peak ~h18, trough ~h3
  const morning = 0.30 * Math.exp(-((hour - 7) ** 2) / 6);
  const evening = 0.62 * Math.exp(-((hour - 18) ** 2) / 7);
  const base = 0.52 + morning + evening;

  const winterPeak = 0.46 * Math.exp(-((hour - 6) ** 2) / 9) + 0.40 * Math.exp(-((hour - 19) ** 2) / 9);
  const summerPeak = 0.42 * Math.exp(-((hour - 15) ** 2) / 12);
  let seasonMult = 1;
  if (season === 0) seasonMult = 1.10 + winterPeak;        // heating
  else if (season === 2) seasonMult = 1.02 + summerPeak;   // cooling
  else if (season === 3) seasonMult = 1.0 + 0.06 * Math.sin((hour / HOURS_PER_DAY) * Math.PI);
  else seasonMult = 1.0;
  return base * seasonMult;
}

export function timeString(tick) {
  const h = Math.floor((tick % TICKS_PER_DAY) / TICKS_PER_HOUR);
  const m = Math.round(((tick % TICKS_PER_HOUR) / TICKS_PER_HOUR) * 60 / 15) * 15;
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function dayOf(tick) {
  return Math.floor(tick / TICKS_PER_DAY);
}

// A run always begins in Spring (month 2, "Sprout") so the opening days are
// gentle and the first winter lands ~45 days in as the first real test.
export const YEAR_START_MONTH = 2;

export function calendarOf(tick) {
  const d = dayOf(tick);
  const year = Math.floor(d / DAYS_PER_YEAR) + 1;
  const doy = d % DAYS_PER_YEAR;
  const month = (YEAR_START_MONTH + Math.floor(doy / DAYS_PER_MONTH)) % MONTHS;
  const dom = (doy % DAYS_PER_MONTH) + 1;
  return { year, month, dom, season: seasonOf(month) };
}
