// Plant catalogue. Costs in thousands of dollars (k$), capacity in MW, fuel in $/MWh.
//
// Design intent: no dominant choice. Each plant is strong on one axis and weak on
// another, so the right answer depends on season, site, weather and the state of
// the bank account.
//
//   solar   cheapest per MW, free fuel — but zero output at night and weak in winter
//   wind    free fuel, strong in autumn/winter and storms, useless in a calm spell
//   hydro   free *and* dispatchable, but river-limited (4 sites) and seasonal
//   coal    firm around the clock, moderate fuel, slow ramp, smog caps goodwill
//   gas     tiny capex and instant ramp, ruinous fuel cost — disaster insurance
//   nuclear huge, cheap to run, always on; needs cooling water, and a disaster
//           hitting it is catastrophic (meltdown)
//   battery energy shifting: buys firmness without fuel, capped power and energy,
//           90% round-trip efficiency

export const PLANTS = {
  solar: {
    id: 'solar', name: 'Solar Farm', emoji: '🔆',
    cap: 12, capex: 40, opex: 0.3, fuel: 0, ramp: 1,
    kind: 'renewable', variable: 'solar', firm: false,
    terrain: ['grass', 'field'],
    blurb: 'Free power in daylight. Nothing at night; weak in winter and storms.',
    tip: 'Cheap energy, but it cannot cover the evening peak. Pair it with batteries or hydro.',
  },
  wind: {
    id: 'wind', name: 'Wind Turbine', emoji: '🌀',
    cap: 10, capex: 65, opex: 0.6, fuel: 0, ramp: 1,
    kind: 'renewable', variable: 'wind', firm: false,
    terrain: ['grass', 'hill', 'field'],
    hillBonus: 1.28,
    blurb: 'Best on hills. Strong in autumn, winter and storms; can go quiet for days.',
    tip: 'Wind lulls are the classic blackout cause. Keep firm backup or storage.',
  },
  hydro: {
    id: 'hydro', name: 'Run-of-River Station', emoji: '💧',
    cap: 14, capex: 95, opex: 0.8, fuel: 0, ramp: 0.6,
    kind: 'renewable', variable: 'hydro', firm: true, dispatchable: true,
    terrain: ['river'], maxCount: 4,
    blurb: 'Dispatchable clean power. Swells in spring melt, shrinks in drought.',
    tip: 'The only free dispatchable plant — take every viable river site early.',
  },
  coal: {
    id: 'coal', name: 'Coal Station', emoji: '🏭',
    cap: 30, capex: 130, opex: 1.2, fuel: 3.2, ramp: 0.12,
    kind: 'thermal', firm: true, dispatchable: true, maxCount: 3, smog: 1,
    terrain: ['grass', 'field'],
    blurb: 'Reliable day and night, moderate fuel. Slow to ramp, and neighbours grumble.',
    tip: 'Needs a few hours to climb to full power. Do not count on it for a sudden spike.',
  },
  gas: {
    id: 'gas', name: 'Gas Peaker', emoji: '🔥',
    cap: 12, capex: 55, opex: 0.5, fuel: 7.5, ramp: 0.5,
    kind: 'thermal', firm: true, dispatchable: true, smog: 0.5,
    terrain: ['grass', 'field', 'hill'],
    blurb: 'Cheap to build, starts in minutes, costs a fortune in fuel.',
    tip: 'Your disaster insurance. Running it through a whole winter is how grids go bankrupt.',
  },
  nuclear: {
    id: 'nuclear', name: 'Nuclear Plant', emoji: '⚛️',
    cap: 60, capex: 320, opex: 3.0, fuel: 0.5, ramp: 0.05,
    kind: 'thermal', firm: true, dispatchable: true, maxCount: 2, needsWater: true,
    terrain: ['grass', 'field'],
    blurb: 'Enormous, cheap to run, always on. Needs river or lake water for cooling.',
    tip: 'One disaster here can end the run. Keep spare capacity when you build one.',
  },
  battery: {
    id: 'battery', name: 'Battery Bank', emoji: '🔋',
    cap: 10, capex: 70, opex: 0.4, fuel: 0, ramp: 1,
    kind: 'storage', power: 10, energy: 60, efficiency: 0.9, maxCount: 8,
    terrain: ['grass', 'field', 'forest'],
    blurb: 'Stores spare energy for the evening peak and the disaster hours.',
    tip: '10 MW / 60 MWh each. Charging is free when renewables over-produce.',
  },
};

export const PLANT_ORDER = ['solar', 'wind', 'hydro', 'battery', 'gas', 'coal', 'nuclear'];

// Merit order for automatic dispatch: cheapest marginal cost first.
export const FUEL_COST = { hydro: 0.05, nuclear: 0.5, coal: 3.2, gas: 7.5 };

export function plantDef(id) {
  return PLANTS[id];
}

export function isDispatchable(def) {
  return !!def.dispatchable;
}

export function isStorage(def) {
  return def.kind === 'storage';
}
