// Weather regimes and disasters.
//
// Weather is a small Markov-ish state machine; it drives solar/wind output and
// demand modifiers, and it *telegraphs* many disasters, so a player who watches
// the forecast strip can prepare.
//
// Disasters always arrive in two phases:
//   warning  -> visible forecast + countdown, player can prepare (charge batteries,
//               bring firm plants online, shut down vulnerable plants to halve damage)
//   active   -> damage / modifiers applied over `duration` ticks

export const WEATHER = {
  clear:    { name: 'Clear',      icon: 'weather:clear', solar: 1.05, wind: 0.7,  demand: 1.00 },
  cloudy:   { name: 'Cloudy',     icon: 'weather:cloudy', solar: 0.55, wind: 1.0,  demand: 0.98 },
  overcast: { name: 'Overcast',   icon: 'weather:overcast', solar: 0.35, wind: 0.9,  demand: 0.99 },
  windy:    { name: 'Windy',      icon: 'weather:windy', solar: 0.75, wind: 1.55, demand: 1.05 },
  calm:     { name: 'Calm',       icon: 'weather:calm', solar: 0.9,  wind: 0.15, demand: 1.00 },
  rain:     { name: 'Rain',       icon: 'weather:rain', solar: 0.22, wind: 1.1,  demand: 1.02 },
  storm:    { name: 'Storm',      icon: 'weather:storm', solar: 0.12, wind: 1.9,  demand: 1.12 },
  snow:     { name: 'Snow',       icon: 'weather:snow', solar: 0.20, wind: 1.0,  demand: 1.25 },
  heat:     { name: 'Heatwave',   icon: 'weather:heat', solar: 1.0,  wind: 0.45, demand: 1.38 },
  frost:    { name: 'Deep Frost', icon: 'weather:frost', solar: 0.5,  wind: 0.8,  demand: 1.42 },
};

// seasonal transition weights: [from][to] not needed; we sample candidates per season
export function weatherCandidates(season, month, from) {
  const W = WEATHER;
  let pairs;
  if (season === 0) {
    pairs = [['snow', 3], ['frost', 3], ['overcast', 2.5], ['cloudy', 2], ['clear', 1.4], ['storm', 1], ['calm', 0.7], ['windy', 1]];
  } else if (season === 1) {
    pairs = [['rain', 3], ['cloudy', 3], ['clear', 2.4], ['windy', 2.4], ['overcast', 2], ['storm', 1.2], ['calm', 1]];
  } else if (season === 2) {
    pairs = [['clear', 3.4], ['heat', 2.4], ['cloudy', 2], ['storm', 1.6], ['windy', 1.3], ['rain', 1.6], ['calm', 1.1]];
  } else {
    pairs = [['windy', 3], ['cloudy', 2.6], ['rain', 2.4], ['clear', 2.2], ['storm', 2], ['overcast', 1.8], ['calm', 1.2]];
  }
  // persistence
  if (W[from]) pairs = pairs.map(([v, w]) => (v === from ? [v, w * 1.9] : [v, w]));
  // month nudge
  if (month === 6 || month === 7) pairs = pairs.map(([v, w]) => (v === 'heat' ? [v, w * 1.6] : [v, w]));
  if (month === 9) pairs = pairs.map(([v, w]) => (v === 'windy' ? [v, w * 1.5] : [v, w]));
  return pairs;
}

export const HAZARDS = {
  storm: {
    id: 'storm', name: 'Windstorm', icon: 'hazard:storm',
    warn: 12, duration: 12, severity: 1,
    lineMod: 0.75, windMod: 0.55, solarMod: 0.2, demandMod: 1.1,
    targets: ['wind', 'solar'], repairCost: 0.35,
    text: 'High winds are bearing down on the region. Turbines may be damaged.',
    advice: 'Shut down exposed turbines to halve the damage, and bank energy now.',
  },
  ice: {
    id: 'ice', name: 'Ice Storm', icon: 'hazard:ice',
    seasons: [0, 3], warn: 15, duration: 18, severity: 1.3,
    lineMod: 0.65, windMod: 0.2, solarMod: 0.35, demandMod: 1.35,
    targets: ['wind', 'hydro'], repairCost: 0.45,
    text: 'An ice storm is incoming. Lines will ice up and demand will spike.',
    advice: 'Charge every battery and bring firm plants online before it hits.',
  },
  heatwave: {
    id: 'heatwave', name: 'Heatwave', icon: 'hazard:heatwave',
    seasons: [2], warn: 15, duration: 24, severity: 1.2,
    lineMod: 0.85, solarMod: 1.05, demandMod: 1.5, hydroMod: 0.8,
    targets: ['transmission'], repairCost: 0.3,
    text: 'A heatwave is building. Air conditioning demand will soar.',
    advice: 'Cheap daytime energy is plentiful — pump it into storage for the evening.',
  },
  drought: {
    id: 'drought', name: 'Drought', icon: 'hazard:drought',
    seasons: [1, 2, 3], warn: 24, duration: 60, severity: 0.8,
    hydroMod: 0.3, demandMod: 1.12,
    targets: [], repairCost: 0,
    text: 'River levels are falling fast. Hydro output will collapse for a while.',
    advice: 'Expect a long dry spell: spread the load across other plants.',
  },
  quake: {
    id: 'quake', name: 'Earthquake', icon: 'hazard:quake',
    warn: 6, duration: 6, severity: 1.6,
    targets: ['any'], damageNear: 2, repairCost: 0.6,
    text: 'Seismic activity detected along the fault line!',
    advice: 'Little warning. This is why you keep spare capacity and insurance money.',
  },
  linefault: {
    id: 'linefault', name: 'Line Fault', icon: 'hazard:linefault',
    warn: 8, duration: 14, severity: 1,
    lineMod: 0.5,
    targets: ['transmission'], repairCost: 0.5,
    text: 'A major transmission line is about to trip.',
    advice: 'Your grid link will be throttled — pre-charge batteries to cover the cities.',
  },
  plantfire: {
    id: 'plantfire', name: 'Plant Fire', icon: 'hazard:plantfire',
    warn: 4, duration: 20, severity: 1.4,
    targets: ['thermal'], repairCost: 0.55,
    text: 'A fire has broken out at one of your thermal stations.',
    advice: 'Fire crews will repair it; the cost is unavoidable, the blackout is not.',
  },
  coldsnap: {
    id: 'coldsnap', name: 'Cold Snap', icon: 'hazard:coldsnap',
    seasons: [0, 1, 11], warn: 18, duration: 20, severity: 1.1,
    demandMod: 1.45, windMod: 1.15, solarMod: 0.6,
    targets: [], repairCost: 0,
    text: 'Arctic air is moving in. Heating demand is about to spike hard.',
    advice: 'Long warning, big spike. Buy fuel, charge storage, or build firm capacity.',
  },
};

export const HAZARD_ORDER = Object.keys(HAZARDS);

// Which hazards can fire, weighted, for the current calendar position.
export function hazardCandidates(month, year, rng) {
  const seasonW = [];
  for (const id of HAZARD_ORDER) {
    const h = HAZARDS[id];
    if (h.seasons && !h.seasons.includes(month)) continue;
    let w = h.severity;
    if (id === 'quake' || id === 'linefault' || id === 'plantfire') w = 0.8; // evergreen
    if (id === 'storm' && (month === 9 || month === 10 || month === 0)) w = 1.4;
    if (id === 'ice' && (month === 11 || month === 0 || month === 1)) w = 1.5;
    if (id === 'heatwave' && (month === 6 || month === 7)) w = 1.6;
    if (id === 'drought' && month === 7) w = 1.5;
    seasonW.push([id, Math.max(0.15, w)]);
  }
  return rng.weighted(seasonW);
}
