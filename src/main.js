// Gridling — browser shell: game loop, mouse/keyboard input, panels, coach marks.

import {
  createGame, tick, buildPlant, demolish, canBuild, setPlantOn, setPlantMode,
  buyUpgrade, fleetSummary, serialize, PLANTS, PLANT_ORDER, HAZARDS, WEATHER,
  UPGRADES, money as fmtMoney, seasonName, hourOf, availableCapacity,
  MAP_COLS, MAP_ROWS,
} from './sim/engine.js';
import { MONTH_NAMES, TICKS_PER_DAY, calendarOf } from './sim/world.js';
import { drawWorld, layout, tileAt, drawChart } from './render.js';
import { paintIcons } from './icons.js';
import {
  saveGame, loadGame, saveMeta, clearSave, exportFile, importFileFromText,
  listScores, addScore, seenCoach, markCoach, storageAvailable,
} from './storage.js';

const el = (id) => document.getElementById(id);
const app = el('app');
const mapCanvas = el('map');

/** Repaint one [data-icon] span with a new glyph spec. */
function setIcon(span, spec, size) {
  if (!span || !spec) return;
  if (span.dataset.icon !== spec || span.dataset.size !== String(size)) {
    span.dataset.icon = spec;
    span.dataset.size = String(size);
    span.dataset.painted = '0';
  }
  paintIcons(span.parentNode || document);
}
const chartCanvas = el('chart');

const ui = {
  game: null,
  preview: false,          // the decorative run behind the title card, never saved
  speed: 0,
  buildSel: null,
  hover: null,
  hoverOk: false,
  selected: null,
  tab: 'build',
  hist: [],
  modalOpen: false,
  lastLogLen: 0,
  geo: null,
  coachStep: -1,
  autosaveAt: Date.now(),  // ms stamp of the last autosave
};

// ---------------------------------------------------------------- loop -------

let BASE_TPS = 2;         // sim ticks per real second at 1x (one in-game day ≈ 10 s)
let acc = 0;
let lastFrame = performance.now();

function frame(now) {
  const dt = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  if (ui.preview && ui.game) {
    // decorative backdrop: the world behind the title card keeps turning so the
    // first thing a player sees is a living grid, not four empty boxes
    acc += dt * 3;
    let steps = 0;
    while (acc >= 1 && steps < 6) { tick(ui.game); pushHist(); acc -= 1; steps++; }
    if (acc > 6) acc = 0;
    if (ui.game.over || ui.game.tick > TICKS_PER_DAY * 40) startPreview();
    render();
    requestAnimationFrame(frame);
    return;
  }
  if (ui.game && !ui.modalOpen && ui.speed > 0 && !ui.game.over) {
    acc += dt * BASE_TPS * ui.speed;
    let steps = 0;
    while (acc >= 1 && steps < 12) { step(); acc -= 1; steps++; }
    if (acc > 12) acc = 0;
  }
  render();
  requestAnimationFrame(frame);
}

function pushHist() {
  const g = ui.game;
  const s = fleetSummary(g);
  ui.hist.push({
    day: Math.floor(g.tick / TICKS_PER_DAY) + 1,
    hour: hourOf(g.tick),
    demand: g.lastDemand,
    served: g.lastServed,
    potential: s.potential + s.batteryPower,
    link: s.link,
    deficit: g.lastDemand - g.lastServed,
  });
  if (ui.hist.length > 140) ui.hist.shift();
}

function step() {
  const g = ui.game;
  const beforeOver = g.over;
  tick(g);
  pushHist();
  syncEvents();
  if (g.over && !beforeOver) onGameOver();
}

// ---------------------------------------------------------------- render -----

function render() {
  if (!ui.game) return;
  const g = ui.game;
  ui.geo = layout(mapCanvas, MAP_COLS, MAP_ROWS);
  // the chart is exactly as wide as the map card, so the two stack tidily
  if (ui.chartW !== ui.geo.w) {
    ui.chartW = ui.geo.w;
    chartCanvas.style.width = `${ui.geo.w}px`;
  }
  if (ui.hover && ui.buildSel) {
    ui.hoverOk = canBuild(g, ui.buildSel, ui.hover.x, ui.hover.y).ok;
  }
  drawWorld(g, ui.geo, ui);
  drawChart(chartCanvas, g, ui.hist);
  syncStats();
  if (ui.preview) el('hazardbanner').hidden = true;   // no alarms behind the title card
  else syncHazard();
  syncForecast();
  if (Date.now() - ui.autosaveAt > 12000) {
    ui.autosaveAt = Date.now();
    if (!g.over && !ui.preview) saveGame(g);
  }
}

function calendarText(tickNo) {
  const c = calendarOf(tickNo);
  return `Year ${c.year} · ${MONTH_NAMES[c.month]} ${c.dom}`;
}

function clockText(tickNo) {
  const h = hourOf(tickNo);
  return `${String(h).padStart(2, '0')}:00`;
}

function syncStats() {
  const g = ui.game;
  const s = fleetSummary(g);
  el('v-date').textContent = seasonName(calendarOf(g.tick).season);
  el('stat-date').querySelector('.k').textContent =
    ui.preview ? `Demo world · ${calendarText(g.tick)}` : calendarText(g.tick);
  el('v-clock').textContent = clockText(g.tick);
  const w = WEATHER[g.weather];
  el('v-weather').textContent = w.name;
  setIcon(el('v-weather-ico'), w.icon, 18);
  el('stat-weather').title = `Weather: ${w.name} — sun ×${w.solar}, wind ×${w.wind}`;
  el('v-money').textContent = `${g.money < 0 ? '-' : ''}$${fmtMoney(Math.abs(g.money))}`;
  el('stat-money').classList.toggle('neg', g.money < 0);
  const sat = Math.round(g.satisfaction);
  el('v-sat').textContent = `${sat}%`;
  const fill = el('v-satfill');
  fill.style.width = `${sat}%`;
  fill.style.background = sat > 55 ? 'var(--leaf)' : sat > 30 ? 'var(--warn)' : 'var(--alert)';
  el('stat-sat').classList.toggle('warnstate', sat <= 30);
  el('v-score').textContent = Math.round(g.score).toLocaleString('en-US');

  // supply headroom, so the thing you are actually managing is a glanceable bar
  const coverage = g.lastDemand > 0 ? (g.lastServed / g.lastDemand) * 100 : 100;
  const sfill = el('v-supplyfill');
  sfill.style.width = `${Math.min(100, coverage)}%`;
  sfill.style.background = coverage >= 99.5 ? 'var(--leaf)' : coverage >= 90 ? 'var(--warn)' : 'var(--alert)';
  el('v-supply').textContent = `${Math.round(coverage)}%`;
  el('stat-supply').classList.toggle('warnstate', coverage < 90);

  // the chart above already prints demand / served / available, so this line only
  // carries what the chart cannot show: the flows across the wire and into storage
  const s2 = g.lastFlow;
  const parts = [`tie-line ${Math.round(s.link)} MW`];
  if (s.storageCap) parts.push(`stored ${Math.round(s.stored)}/${Math.round(s.storageCap)} MWh`);
  if (s2.charge > 0.5) parts.push(`charging ${Math.round(s2.charge)} MW`);
  if (s2.discharge > 0.5) parts.push(`discharging ${Math.round(s2.discharge)} MW`);
  if (s2.curtail > 2) parts.push(`curtailed ${Math.round(s2.curtail)} MW`);
  if (g.lastDemand - g.lastServed > 0.5) {
    parts.push(`shortfall ${Math.round(g.lastDemand - g.lastServed)} MW`);
  }
  el('ticker').textContent = parts.join('  ·  ');
}

function syncHazard() {
  const g = ui.game;
  const b = el('hazardbanner');
  const h = g.hazard;
  if (!h) { b.hidden = true; ui.hzKey = null; ui.hzWhen = null; return; }
  const def = HAZARDS[h.id];
  const when = h.phase === 'warn'
    ? `expected in ~${fmtDur(h.ticksLeft)}`
    : `under way for ~${fmtDur(h.ticksLeft)} more`;
  const key = `${h.id}:${h.phase}`;
  if (ui.hzKey !== key) {
    ui.hzKey = key;
    b.hidden = false;
    b.className = h.phase === 'warn' ? 'warn' : 'active';
    b.innerHTML = `<span class="bico" data-icon="${def.icon}" data-size="22"></span>`
      + `<span class="hzhead"></span> <span class="count">${def.advice}</span>`;
    ui.hzWhen = b.querySelector('.hzhead');
    paintIcons(b);
  }
  if (ui.hzWhen) ui.hzWhen.textContent = `${def.name} — ${when}`;
}

function fmtDur(ticks) {
  if (ticks >= TICKS_PER_DAY) {
    const d = Math.round(ticks / TICKS_PER_DAY);
    return `${d} day${d === 1 ? '' : 's'}`;
  }
  return `${ticks} h`;
}

function syncForecast() {
  const g = ui.game;
  const warn = g.hazard && g.hazard.phase === 'warn' ? g.hazard.id : '';
  const key = `${warn}|${g.forecast.join(',')}`;
  if (ui.fcKey === key) return;
  ui.fcKey = key;
  const chips = [];
  if (warn) {
    const def = HAZARDS[warn];
    chips.push(`<span class="chip alarm" title="${escapeHtml(def.text)}"><span class="lico" data-icon="${def.icon}" data-size="18"></span><b>${def.name}!</b></span>`);
  }
  for (const w of g.forecast) {
    const def = WEATHER[w];
    const eff = w === 'calm' || w === 'storm' || w === 'heat' || w === 'frost' ? `wind ×${def.wind} · sun ×${def.solar}` : '';
    chips.push(`<span class="chip" title="${def.name}${eff ? ' — ' + eff : ''}"><span class="lico" data-icon="${def.icon}" data-size="18"></span><span class="cw">${def.name}</span></span>`);
  }
  el('forecast-chips').innerHTML = chips.join('');
  paintIcons(el('forecast-chips'));
}

function syncEvents() {
  const g = ui.game;
  if (g.log.length === ui.lastLogLen) return;
  const fresh = g.log.slice(ui.lastLogLen);
  ui.lastLogLen = g.log.length;
  for (const e of fresh) {
    if (e.kind === 'warn' || e.kind === 'bad') toast(e.text, e.kind, e.icon);
  }
  renderLog();
  if (fresh.some((e) => e.kind === 'bad' || e.kind === 'warn')) syncDetailIfOpen();
}

function renderLog() {
  const g = ui.game;
  const rows = g.log.slice(-40).reverse().map((e) => {
    const c = calendarOf(e.tick);
    const ico = e.icon ? `<span class="lico" data-icon="${e.icon}" data-size="16"></span>` : '';
    return `<div class="lrow ${e.kind}"><span class="lt">${MONTH_NAMES[c.month]} ${c.dom}, Y${c.year} ${clockText(e.tick)}</span>${ico}${escapeHtml(e.text)}</div>`;
  });
  el('log').innerHTML = rows.join('');
  paintIcons(el('log'));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

// ---------------------------------------------------------------- palette ----

function renderPalette() {
  const g = ui.game;
  const html = PLANT_ORDER.map((id) => {
    const d = PLANTS[id];
    const owned = g.plants.filter((p) => p.id === id).length;
    const limited = d.maxCount ? ` · ${owned}/${d.maxCount}` : '';
    const afford = g.money >= d.capex;
    return `<div class="pcard ${ui.buildSel === id ? 'sel' : ''} ${afford ? '' : 'cant'}" data-plant="${id}"
      title="${escapeHtml(d.blurb)}">
      <div class="ico"><span data-icon="${d.icon}" data-size="30"></span></div>
      <div><div class="nm">${d.name}${limited}</div><div class="ds">${escapeHtml(d.blurb)}</div></div>
      <div class="price ${afford ? '' : 'no'}">$${fmtMoney(d.capex)}</div>
    </div>`;
  }).join('');
  el('palette').innerHTML = html;
  paintIcons(el('palette'));
  el('palette').querySelectorAll('.pcard').forEach((c) => {
    c.addEventListener('click', () => selectBuild(c.dataset.plant));
  });
}

function selectBuild(id) {
  ui.buildSel = ui.buildSel === id ? null : id;
  mapCanvas.classList.toggle('building', !!ui.buildSel);
  renderPalette();
  if (ui.buildSel) {
    const d = PLANTS[ui.buildSel];
    toast(`${d.name}: ${d.tip}`, 'info', d.icon);
  }
}

function renderUpgrades() {
  const g = ui.game;
  el('upgrades').innerHTML = Object.values(UPGRADES).map((u) => {
    const lvl = g.upgrades[u.id] || 0;
    const maxed = lvl >= u.max;
    const cost = maxed ? null : u.costs[lvl];
    const afford = cost != null && g.money >= cost;
    return `<div class="ucard">
      <div class="ico"><span data-icon="${u.icon}" data-size="28"></span></div>
      <div><div class="nm">${u.name} · Lv ${lvl}${maxed ? ' (max)' : ''}</div>
      <div class="ds">${escapeHtml(u.desc)}<br>Now: ${escapeHtml(u.at(lvl))}${maxed ? '' : ` → next: ${escapeHtml(u.at(lvl + 1))}`}</div></div>
      <button data-up="${u.id}" ${maxed || !afford ? 'disabled' : ''}>${maxed ? 'Max' : '$' + fmtMoney(cost)}</button>
    </div>`;
  }).join('');
  paintIcons(el('upgrades'));
  el('upgrades').querySelectorAll('button[data-up]').forEach((b) => {
    b.addEventListener('click', () => {
      const r = buyUpgrade(ui.game, b.dataset.up);
      if (!r.ok) toast(r.why, 'bad');
      renderUpgrades();
      syncStats();
    });
  });
  const g2 = ui.game;
  el('towns').innerHTML = '<div class="pane-hint">Towns on your grid</div>' + g2.cities.map((c) =>
    `<div class="trow"><span>${c.name}</span><span>${Math.round(c.pop * g2.popGrowth)}k people · mood ${Math.round(c.mood)}%</span></div>`).join('');
}

function switchTab(name) {
  ui.tab = name;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.tabpane').forEach((p) => { p.hidden = p.dataset.pane !== name; });
  if (name === 'upgrade') renderUpgrades();
  if (name === 'log') renderLog();
}

// ---------------------------------------------------------------- detail -----

function openDetail(uid) {
  ui.selected = uid;
  const g = ui.game;
  const p = g.plants.find((q) => q.uid === uid);
  if (!p) { closeDetail(); return; }
  const d = PLANTS[p.id];
  const cap = availableCapacity(g, p);
  const box = el('detail');
  box.hidden = false;
  const isStore = d.kind === 'storage';
  box.innerHTML = `
    <h3><span class="lico" data-icon="${d.icon}" data-size="20"></span> ${d.name}</h3>
    <div class="rowline"><span>Rated</span><b>${d.cap} MW</b></div>
    <div class="rowline"><span>Right now</span><b>${p.on ? Math.round(p.out) + ' MW' : 'off'}</b></div>
    <div class="rowline"><span>Weather ceiling</span><b>${isStore ? '—' : Math.round(cap) + ' MW'}</b></div>
    ${isStore ? `<div class="rowline"><span>Stored</span><b>${Math.round(p.charge)} / ${d.energy} MWh</b></div>` : ''}
    ${p.status === 'damaged' ? `<div class="rowline"><span>Repairing</span><b>${p.repair} h</b></div>` : ''}
    <div class="why">${escapeHtml(d.tip)}</div>
    <div class="acts">
      <button data-act="toggle">${p.on ? 'Shut down' : 'Start up'}</button>
      ${isStore ? `<button data-act="mode" data-mode="auto" class="${p.mode === 'auto' ? 'on' : ''}">Auto</button>
        <button data-act="mode" data-mode="charge" class="${p.mode === 'charge' ? 'on' : ''}">Charge</button>
        <button data-act="mode" data-mode="discharge" class="${p.mode === 'discharge' ? 'on' : ''}">Discharge</button>` : ''}
      <button data-act="sell">Sell (+$${fmtMoney(Math.round(d.capex * 0.3))})</button>
      <button data-act="close">Close</button>
    </div>`;
  paintIcons(box);
  // position inside the panel; #detail is absolute within #panel, so all
  // coordinates here are panel-relative
  const pb = el('panel').getBoundingClientRect();
  const geo = ui.geo;
  const mapRect = mapCanvas.getBoundingClientRect();
  const absY = mapRect.top + geo.oy + (p.y + 0.5) * geo.ch - pb.top;
  const w = 292, h = box.offsetHeight || 190;
  box.style.left = Math.max(6, pb.width - w - 8) + 'px';
  box.style.top = Math.max(6, Math.min(pb.height - h - 8, absY - 40)) + 'px';
  box.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'close') return closeDetail();
      if (act === 'toggle') setPlantOn(g, uid, !p.on);
      else if (act === 'mode') setPlantMode(g, uid, b.dataset.mode);
      else if (act === 'sell') { const r = demolish(g, uid); if (!r.ok) toast(r.why, 'bad'); closeDetail(); return; }
      openDetail(uid);
      syncStats();
    });
  });
}

function closeDetail() {
  ui.selected = null;
  el('detail').hidden = true;
}
function syncDetailIfOpen() {
  if (ui.selected != null) openDetail(ui.selected);
}

// ---------------------------------------------------------------- toasts -----

function toast(text, kind = 'info', icon = null) {
  const box = el('toasts');
  const d = document.createElement('div');
  d.className = `toast ${kind === 'info' ? '' : kind}`;
  if (icon) d.innerHTML = `<span class="lico" data-icon="${icon}" data-size="18"></span>`;
  const label = document.createElement('span');
  label.className = 'ttext';
  label.textContent = text;
  label.title = text;
  d.appendChild(label);
  box.appendChild(d);
  if (icon) paintIcons(d);
  // one full-width line, so the message is not truncated mid-word; the Report tab
  // keeps the full record.
  while (box.children.length > 1) box.firstChild.remove();
  setTimeout(() => { d.style.opacity = '0'; d.style.transition = 'opacity .4s'; }, 4200);
  setTimeout(() => d.remove(), 4700);
}

// ---------------------------------------------------------------- coach ------

const COACH = [
  { id: 'map', anchor: () => mapCanvas.getBoundingClientRect(),
    html: 'This is your region. Every tile is a possible plant site; the <b>green bars</b> under each plant are its live output.' },
  { id: 'panel', anchor: () => el('palette').getBoundingClientRect(),
    html: 'Pick a plant here, then <b>click a tile</b> to build it. The ghost turns green when the site fits.' },
  { id: 'forecast', anchor: () => el('forecast').getBoundingClientRect(),
    html: 'The outlook strip shows the weather ahead, and <b>disaster warnings</b> appear here before they strike.' },
  { id: 'chart', anchor: () => el('chart').getBoundingClientRect(),
    html: 'Demand (dashed orange) vs what you supply (blue). Keep blue under the orange ceiling, and mind the tie-line limit.' },
  { id: 'customers', anchor: () => el('stat-sat').getBoundingClientRect(),
    html: 'Blackouts drain <b>customer goodwill</b>. If it empties, your run ends — the top bar is your health bar.' },
];

function showCoach(i) {
  const box = el('coach');
  if (i < 0 || i >= COACH.length) { box.hidden = true; ui.coachStep = -1; return; }
  ui.coachStep = i;
  const step = COACH[i];
  box.hidden = false;
  box.innerHTML = `${step.html}<div><button class="dismiss">${i === COACH.length - 1 ? 'Got it' : 'Next'}</button></div>`;
  const r = step.anchor();
  const w = 300;
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(10, Math.min(window.innerWidth - w - 10, left));
  box.style.width = w + 'px';
  box.style.left = left + 'px';
  box.style.top = Math.min(window.innerHeight - 140, r.bottom + 10) + 'px';
  box.querySelector('.dismiss').addEventListener('click', () => {
    markCoach(step.id);
    showCoach(i + 1);
  });
}

function startCoach() {
  const next = COACH.findIndex((c) => !seenCoach(c.id));
  if (next < 0) return;
  setSpeed(0);
  showCoach(next);
}

// ---------------------------------------------------------------- modals -----

function openModal(html) {
  ui.modalOpen = true;
  el('modal').hidden = false;
  el('modal-card').innerHTML = html;
  paintIcons(el('modal-card'));
  return el('modal-card');
}
function closeModal() {
  ui.modalOpen = false;
  el('modal').hidden = true;
}

function titleScreen() {
  const meta = saveMeta();
  const scores = listScores();
  const scoreRows = scores.length
    ? `<table><tr><th>Score</th><th>Days</th><th>Delivered</th><th>Ended</th></tr>${
      scores.slice(0, 5).map((s) => `<tr><td>${s.score.toLocaleString('en-US')}</td><td>${s.days}</td><td>${s.delivered.toLocaleString('en-US')} MWh</td><td>${escapeHtml(s.reason)}</td></tr>`).join('')}</table>`
    : '<p class="hint">No records yet.</p>';
  const card = openModal(`
    <h1><span class="mark" data-icon="mark:bolt" data-size="26"></span> Gridling</h1>
    <p>You run the electricity grid for a small region. Keep <b>supply ≥ demand</b>, keep the customers happy,
    and keep the bank account out of the red as the years get meaner.</p>
    <div class="acts">
      <button class="primary" data-a="new">New run</button>
      ${meta ? `<button data-a="continue">Continue · ${calendarText(meta.tick)}, score ${Math.round(meta.score).toLocaleString('en-US')}</button>` : ''}
      <button data-a="help">How to play</button>
      ${meta ? '<button data-a="forget">Delete saved run</button>' : ''}
    </div>
    <h2>Best runs</h2>${scoreRows}
    ${storageAvailable() ? '' : '<p class="hint">Web storage is unavailable in this browser, so saves and scores will not persist.</p>'}
  `);
  card.querySelector('[data-a="new"]').addEventListener('click', () => newGame());
  const cont = card.querySelector('[data-a="continue"]');
  if (cont) cont.addEventListener('click', () => continueGame());
  const forget = card.querySelector('[data-a="forget"]');
  if (forget) forget.addEventListener('click', () => { clearSave(); toast('Saved run deleted.', 'warn'); titleScreen(); });
  card.querySelector('[data-a="help"]').addEventListener('click', helpModal);
}

function helpModal() {
  const plantRows = PLANT_ORDER.map((id) => {
    const d = PLANTS[id];
    return `<tr><td><span class="lico" data-icon="${d.icon}" data-size="18"></span> ${d.name}</td><td>$${fmtMoney(d.capex)}</td><td>${d.cap} MW</td><td>${d.fuel ? '$' + d.fuel + '/MWh' : 'free'}</td><td>${escapeHtml(d.blurb)}</td></tr>`;
  }).join('');
  const card = openModal(`
    <h1>How to play</h1>
    <p><b>Goal:</b> stay powered up as long as you can. Your score grows with every MWh delivered while customers are happy.</p>
    <h2>The loop</h2>
    <ul>
      <li>Pick a plant on the right, then click a tile on the map to build it.</li>
      <li>Power must cover <b>demand</b> (the dashed orange line). Demand peaks in the <b>evening</b> and in <b>winter</b>; solar only makes power in daylight.</li>
      <li>The forecast strip warns you about disasters before they arrive. Charge batteries and start firm plants while you still can.</li>
      <li>Shutting a plant down <b>halves the damage</b> it takes in a disaster, but it also produces nothing.</li>
    </ul>
    <h2>You lose if</h2>
    <ul><li>customer goodwill empties (long or deep blackouts), or</li><li>the bank goes more than $12k overdrawn.</li></ul>
    <h2>The plants</h2>
    <table><tr><th>Plant</th><th>Cost</th><th>Rated</th><th>Fuel</th><th>Notes</th></tr>${plantRows}</table>
    <h2>Keyboard</h2>
    <p class="hint">Space = pause · 1/2/3 = speed · Esc = cancel build or close a card · ? = this help</p>
    <div class="acts"><button class="primary" data-a="close">Back</button></div>
  `);
  card.querySelector('[data-a="close"]').addEventListener('click', () => {
    if (ui.game) closeModal(); else titleScreen();
  });
}

function menuModal() {
  const g = ui.game;
  const card = openModal(`
    <h1>Menu</h1>
    <div class="kv"><span>Run</span><b>${calendarText(g.tick)} · ${Math.floor(g.tick / TICKS_PER_DAY)} days in</b></div>
    <div class="kv"><span>Score</span><b>${Math.round(g.score).toLocaleString('en-US')}</b></div>
    <div class="kv"><span>Delivered</span><b>${Math.round(g.deliveredTotal).toLocaleString('en-US')} MWh</b></div>
    <div class="kv"><span>Cash</span><b>${g.money < 0 ? '-' : ''}$${fmtMoney(Math.abs(g.money))}</b></div>
    <div class="acts">
      <button data-a="save">Save now</button>
      <button data-a="export">Export save file</button>
      <button data-a="import">Import save file</button>
      <button data-a="help">How to play</button>
      <button data-a="scores">Best scores</button>
      <button data-a="new">Start a new run</button>
      <button class="primary" data-a="close">Resume</button>
    </div>
    <p class="hint">The game also autosaves every few seconds.</p>
  `);
  card.querySelector('[data-a="close"]').addEventListener('click', closeModal);
  card.querySelector('[data-a="save"]').addEventListener('click', () => {
    toast(saveGame(ui.game) ? 'Saved.' : 'Could not save — storage unavailable.', 'good');
    menuModal();
  });
  card.querySelector('[data-a="export"]').addEventListener('click', () => {
    exportFile(ui.game, `gridling-year${calendarOf(ui.game.tick).year}`);
    toast('Save file written.', 'good');
    menuModal();
  });
  card.querySelector('[data-a="import"]').addEventListener('click', () => importModal());
  card.querySelector('[data-a="help"]').addEventListener('click', helpModal);
  card.querySelector('[data-a="scores"]').addEventListener('click', () => { scoresModal(menuModal); });
  card.querySelector('[data-a="new"]').addEventListener('click', () => newGame());
}

function importModal() {
  const card = openModal(`
    <h1>Import a save</h1>
    <p>Choose a <code>.gridling</code> file, or paste the JSON contents.</p>
    <input type="file" id="filein" accept=".gridling,application/json" style="width:100%">
    <textarea id="pastetext" rows="6" placeholder="…or paste save JSON here" style="width:100%;margin-top:8px;font-family:monospace;font-size:11px"></textarea>
    <div class="acts">
      <button class="primary" data-a="go">Load it</button>
      <button data-a="back">Back</button>
    </div>
  `);
  card.querySelector('[data-a="back"]').addEventListener('click', menuModal);
  card.querySelector('[data-a="go"]').addEventListener('click', () => {
    const txt = el('pastetext').value.trim();
    const file = el('filein').files[0];
    const finish = (text) => {
      try {
        const g = importFileFromText(text);
        adoptGame(g, 'Save imported.');
      } catch (e) {
        toast('Could not load save: ' + e.message, 'bad');
      }
    };
    if (file) file.text().then(finish);
    else if (txt) finish(txt);
    else toast('Pick a file or paste the JSON first.', 'warn');
  });
}

function scoresModal(back) {
  const scores = listScores();
  const card = openModal(`
    <h1>Best runs</h1>
    ${scores.length ? `<table><tr><th>#</th><th>Score</th><th>Days</th><th>Delivered</th><th>Peak</th><th>Goodwill</th><th>Ended</th></tr>${
      scores.map((s, i) => `<tr><td>${i + 1}</td><td>${s.score.toLocaleString('en-US')}</td><td>${s.days}</td>
        <td>${s.delivered.toLocaleString('en-US')}</td><td>${s.peak} MW</td><td>${s.satisfaction}%</td><td>${escapeHtml(s.reason)}</td></tr>`).join('')}</table>`
      : '<p class="hint">Nothing yet — finish a run.</p>'}
    <div class="acts"><button class="primary" data-a="back">Back</button><button data-a="clear">Clear scores</button></div>
  `);
  card.querySelector('[data-a="back"]').addEventListener('click', back);
  card.querySelector('[data-a="clear"]').addEventListener('click', () => {
    try { localStorage.removeItem('gridling:scores'); } catch { /* ignore */ }
    scoresModal(back);
  });
}

function onGameOver() {
  const g = ui.game;
  saveGame(g);
  const o = g.over;
  const entry = {
    id: `${Date.now()}-${g.seed}`,
    score: o.score, days: o.days, delivered: o.delivered, peak: o.peak,
    satisfaction: o.satisfaction, reason: o.title, date: Date.now(), seed: g.seed,
  };
  const { list, rank } = addScore(entry);
  const table = list.map((s, i) =>
    `<tr><td>${i + 1}</td><td>${s.score.toLocaleString('en-US')}</td><td>${s.days}</td><td>${s.delivered.toLocaleString('en-US')}</td><td>${escapeHtml(s.reason)}</td></tr>`).join('');
  setSpeed(0);
  const card = openModal(`
    <h1><span class="mark" data-icon="${o.title === 'Bankrupt' ? 'mark:money' : 'mark:down'}" data-size="26"></span> ${escapeHtml(o.title)}</h1>
    <p>${escapeHtml(o.detail)}</p>
    <div class="bigscore">${o.score.toLocaleString('en-US')}</div>
    <div class="kv"><span>You lasted</span><b>${o.days} days (Year ${calendarOf(o.tick).year})</b></div>
    <div class="kv"><span>Energy delivered</span><b>${o.delivered.toLocaleString('en-US')} MWh</b></div>
    <div class="kv"><span>Peak served</span><b>${o.peak} MW</b></div>
    <div class="kv"><span>Final goodwill</span><b>${o.satisfaction}%</b></div>
    <div class="kv"><span>Best-run ranking</span><b>#${rank || '—'} of ${list.length}</b></div>
    <h2>Best runs</h2>
    <table><tr><th>#</th><th>Score</th><th>Days</th><th>MWh</th><th>Ended</th></tr>${table}</table>
    <div class="acts">
      <button class="primary" data-a="new">New run</button>
      <button data-a="keep">Keep looking at the map</button>
    </div>
  `);
  card.querySelector('[data-a="new"]').addEventListener('click', () => newGame());
  card.querySelector('[data-a="keep"]').addEventListener('click', closeModal);
}

// ---------------------------------------------------------------- game start --

function setSpeed(n) {
  if (ui.preview) return;     // the title-card backdrop runs on its own clock
  ui.speed = n;
  document.querySelectorAll('#speeds button').forEach((b) => b.classList.toggle('on', +b.dataset.speed === n));
}

function adoptGame(g, msg) {
  ui.game = g;
  ui.preview = false;
  ui.hist = [];
  ui.selected = null;
  ui.buildSel = null;
  ui.lastLogLen = g.log.length;
  ui.hzKey = null;
  ui.hzWhen = null;
  ui.fcKey = null;
  closeDetail();
  closeModal();
  setSpeed(1);
  renderPalette();
  switchTab('build');
  renderLog();
  if (msg) toast(msg, 'good');
}

// A run ticks quietly behind the title card, so the very first screen shows a
// working grid instead of four empty boxes. Fixed seed, never saved, and it
// restarts after ~40 days so the backdrop can never decay into a dead run.
function startPreview() {
  const g = createGame(20261115);
  ui.game = g;
  ui.preview = true;
  ui.hist = [];
  ui.selected = null;
  ui.buildSel = null;
  ui.speed = 0;
  closeDetail();
  // decorative builds so the backdrop shows a region that has actually been
  // worked on, not just the two starter plants. Money is topped up purely to
  // place them; this run is never saved and never becomes the player's.
  g.money = 5000;
  for (const id of ['wind', 'solar', 'battery', 'wind', 'hydro']) {
    let done = false;
    for (let y = 1; y < MAP_ROWS - 1 && !done; y++)
      for (let x = 0; x < MAP_COLS && !done; x++)
        if (canBuild(g, id, x, y).ok) { buildPlant(g, id, x, y); done = true; }
  }
  // 70 hours of history means the chart and the log have real content the moment
  // the page appears, rather than filling in while the player reads the card
  for (let i = 0; i < 70 && !g.over; i++) { tick(g); pushHist(); }
  ui.lastLogLen = g.log.length;
  renderPalette();
  renderLog();
}

function newGame() {
  adoptGame(createGame());
  if (!seenCoach('map')) setTimeout(startCoach, 400);
  toast('New run: Year 1, Frostbite. You start with a coal station and a gas peaker.', 'good');
}

function continueGame() {
  const g = loadGame();
  if (!g) { toast('No save found.', 'warn'); newGame(); return; }
  adoptGame(g, 'Save loaded — pick up where you left off.');
  if (g.over) onGameOver();
}

// ---------------------------------------------------------------- input ------

mapCanvas.addEventListener('mousemove', (e) => {
  if (!ui.game || ui.preview || !ui.geo) return;
  const r = mapCanvas.getBoundingClientRect();
  const t = tileAt(e.clientX - r.left, e.clientY - r.top, ui.geo);
  ui.hover = t;
});
mapCanvas.addEventListener('mouseleave', () => { ui.hover = null; });

mapCanvas.addEventListener('click', (e) => {
  if (!ui.game || ui.preview || !ui.geo) return;
  const r = mapCanvas.getBoundingClientRect();
  const t = tileAt(e.clientX - r.left, e.clientY - r.top, ui.geo);
  if (!t) return;
  const g = ui.game;
  if (g.over) return;
  const existing = g.plants.find((p) => p.x === t.x && p.y === t.y);
  if (ui.buildSel) {
    const res = buildPlant(g, ui.buildSel, t.x, t.y);
    if (!res.ok) { toast(res.why, 'bad'); }
    else {
      if (res.plant.warnings) res.plant.warnings.forEach((w) => toast(w, 'warn'));
      renderPalette();
      syncStats();
    }
    return;
  }
  if (existing) openDetail(existing.uid);
  else closeDetail();
});

document.querySelectorAll('#speeds button').forEach((b) => {
  b.addEventListener('click', () => setSpeed(+b.dataset.speed));
});
document.querySelectorAll('.tabs button').forEach((b) => {
  b.addEventListener('click', () => switchTab(b.dataset.tab));
});
el('btn-menu').addEventListener('click', menuModal);
el('btn-help').addEventListener('click', helpModal);

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  if (e.key === ' ') { e.preventDefault(); setSpeed(ui.speed === 0 ? 1 : 0); }
  else if (e.key === '1') setSpeed(1);
  else if (e.key === '2') setSpeed(2);
  else if (e.key === '3') setSpeed(4);
  else if (e.key === 'Escape') {
    if (ui.buildSel) { ui.buildSel = null; mapCanvas.classList.remove('building'); renderPalette(); }
    else if (ui.selected != null) closeDetail();
  } else if (e.key === '?') helpModal();
});

window.addEventListener('resize', () => { if (ui.selected != null) syncDetailIfOpen(); });
window.addEventListener('beforeunload', () => {
  if (ui.game && !ui.preview && !ui.game.over) saveGame(ui.game);
});

// expose a small handle for automated play-testing
window.__gridling = {
  ui, tick, createGame, serialize, canBuild, plantIds: PLANT_ORDER,
  summary: (g) => fleetSummary(g),
  setTps: (n) => { BASE_TPS = n; },
  buildAt: (id, x, y) => buildPlant(ui.game, id, x, y),
  setSpeed, setTab: switchTab, newGame,
  saveNow: () => saveGame(ui.game),
  sell: (uid) => demolish(ui.game, uid),
  adoptImport: (text) => adoptGame(importFileFromText(text), 'Save imported.'),
  cal: { calendarOf, seasonName },
  state: () => ui.game,
};

// ---------------------------------------------------------------- boot -------

app.hidden = false;
paintIcons(app);          // the static shell (the logo) paints once here
startPreview();           // decorative world behind the title card, never saved
titleScreen();
requestAnimationFrame(frame);
