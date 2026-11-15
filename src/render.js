// Cute, soft map and chart renderer. Everything is generated in code: rounded
// tiles, pastel terrain, plants as friendly shapes, no external art. Plant art and
// small glyphs live in icons.js so the DOM panels can draw the same shapes.

import { PLANTS } from './sim/plants.js';
import { T } from './sim/world.js';
import { WEATHER } from './sim/hazards.js';
import { hourOf, availableCapacity } from './sim/engine.js';
import { drawPlantIcon, drawIcon, rr, roundedTri, INK } from './icons.js';

const SKY = {
  clear: '#dcefff', cloudy: '#e2e8f2', overcast: '#dfe3ea', windy: '#dcecf6',
  calm: '#e6f0e4', rain: '#d3ddea', storm: '#c9d2e2', snow: '#eef3fa',
  heat: '#ffeade', frost: '#e4eef8',
};

const GROUND = {
  [T.grass]: ['#bfe0a3', '#a9d28d'],
  [T.field]: ['#e6d69b', '#d8c686'],
  [T.forest]: ['#93cfa4', '#7ec192'],
  [T.hill]: ['#b7cfc4', '#a5c2b6'],
  [T.river]: ['#a9d6f2', '#8fc6ea'],
  [T.lake]: ['#8fc9ee', '#79b9e4'],
  [T.mountain]: ['#d3d6de', '#c2c6d1'],
  [T.town]: ['#f0c6ad', '#e5b498'],
  [T.fault]: ['#e3b2ac', '#d8a29c'],
};

let NIGHT = 0;   // night darkness for the current frame (town window glow)

export function tileAt(pX, pY, geo) {
  const cx = Math.floor((pX - geo.ox) / geo.ts);
  const cy = Math.floor((pY - geo.oy) / geo.ch);
  if (cx < 0 || cy < 0 || cx >= geo.cols || cy >= geo.rows) return null;
  return { x: cx, y: cy };
}

let lastGeo = null, lastGeoKey = '';

export function layout(canvas, cols, rows) {
  // The canvas is sized to be exactly the tile grid, and the cells stretch to fill
  // the frame: cells come out slightly non-square rather than the map floating in a
  // bare band, which read as unfinished or clipped land. Plant and town art stays
  // square inside its cell (see cellBox).
  const box = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const key = `${Math.round(box.width)}x${Math.round(box.height)}x${dpr}x${cols}x${rows}`;
  if (lastGeo && lastGeoKey === key) return lastGeo;   // no reflow work per frame
  const pad = 2;
  let ts = Math.floor((box.width - pad * 2) / cols);
  let ch = Math.floor((box.height - pad * 2) / rows);
  // unreadably narrow cells are worse than a margin: fall back to square, centred
  if (ts < 26 || ch < 26) ts = ch = Math.max(8, Math.floor(Math.min((box.width - pad * 2) / cols, (box.height - pad * 2) / rows)));
  const w = ts * cols, h = ch * rows;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  lastGeo = { ctx, ts, ch, ox: 0, oy: 0, cols, rows, w, h };
  lastGeoKey = key;
  return lastGeo;
}

/** Cell box for tile (x, y); plant/town art stays square inside a taller cell. */
export function cellBox(geo, x, y) {
  const { ox, oy, ts, ch } = geo;
  const px = ox + x * ts, py = oy + y * ch;
  const s = Math.min(ts, ch);
  return { px, py, cw: ts, ch, ax: px + (ts - s) / 2, ay: py + (ch - s) / 2, s };
}

export function drawWorld(game, geo, ui) {
  const { ctx, ts, ch, ox, oy, cols, rows, w, h } = geo;
  const t = game.tick;
  const running = ui.speed > 0 && !game.over;
  const anim = running ? t + (performance.now() % 1000) / 1000 : t;
  const bg = SKY[game.weather] || '#e8eef5';
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, bg);
  g.addColorStop(1, '#f6f1ea');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // day/night wash across the map area
  const hour = hourOf(game.tick);
  const night = nightAmount(hour);
  NIGHT = night;
  const H = game.hazard;
  const hzTint = H && H.phase === 'active' ? hazardTint(H.id) : null;
  // tiles: each cell fills right up to its neighbour, so the card is solid land
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const tt = game.map[y][x];
      const b = cellBox(geo, x, y);
      const pal = GROUND[tt] || GROUND[T.grass];
      const even = (x + y) % 2 === 0;
      ctx.fillStyle = even ? pal[0] : pal[1];
      const gap = 1.5;
      rr(ctx, b.px + gap, b.py + gap, b.cw - gap * 2, b.ch - gap * 2, Math.min(b.cw, b.ch) * 0.2);
      ctx.fill();
      drawDecoration(ctx, tt, b.ax, b.ay, b.s, x, y, anim);
    }
  }

  // hazard overlay and night wash over the whole region
  if (hzTint) {
    ctx.save();
    ctx.fillStyle = hzTint;
    ctx.fillRect(ox, oy, ts * cols, ch * rows);
    ctx.restore();
  }
  if (night > 0.02) {
    ctx.save();
    ctx.fillStyle = `rgba(40,52,88,${0.30 * night})`;
    ctx.fillRect(ox, oy, ts * cols, ch * rows);
    ctx.restore();
  }

  // town shapes (labels come later, so they can avoid each other)
  for (const c of game.cities) {
    const b = cellBox(geo, c.x, c.y);
    drawTown(ctx, c, b.ax, b.ay, b.s, anim);
  }

  // plants
  for (const p of game.plants) {
    const b = cellBox(geo, p.x, p.y);
    drawPlant(ctx, game, p, b.ax, b.ay, b.s, anim);
  }

  drawTownLabels(ctx, game, geo);

  // hover / placement ghost
  if (ui.hover) {
    const b = cellBox(geo, ui.hover.x, ui.hover.y);
    ctx.save();
    ctx.lineWidth = 3;
    if (ui.buildSel) {
      const ok = ui.hoverOk;
      ctx.strokeStyle = ok ? '#48a06a' : '#c8646c';
      ctx.fillStyle = ok ? 'rgba(72,160,106,0.20)' : 'rgba(200,100,108,0.20)';
      rr(ctx, b.px + 2, b.py + 2, b.cw - 4, b.ch - 4, Math.min(b.cw, b.ch) * 0.2);
      ctx.fill();
      ctx.stroke();
      if (ok) {
        ctx.globalAlpha = 0.85;
        drawPlantIcon(ctx, ui.buildSel, b.ax, b.ay, b.s, 0, anim);
        ctx.globalAlpha = 1;
      }
    } else {
      ctx.strokeStyle = 'rgba(74,68,83,0.55)';
      rr(ctx, b.px + 2, b.py + 2, b.cw - 4, b.ch - 4, Math.min(b.cw, b.ch) * 0.2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // selection ring
  if (ui.selected) {
    const p = game.plants.find((q) => q.uid === ui.selected);
    if (p) {
      const b = cellBox(geo, p.x, p.y);
      ctx.save();
      ctx.strokeStyle = '#6a8fd6';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      rr(ctx, b.px + 2, b.py + 2, b.cw - 4, b.ch - 4, Math.min(b.cw, b.ch) * 0.2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // weather particles
  drawWeatherFx(ctx, game, geo, anim);
}

function nightAmount(hour) {
  if (hour >= 19 || hour <= 4) return 1;
  if (hour < 6) return (6 - hour) / 2;
  if (hour > 17) return Math.min(1, (hour - 17) / 2);
  return 0;
}

function hazardTint(id) {
  switch (id) {
    case 'storm': case 'ice': return 'rgba(96,116,150,0.20)';
    case 'heatwave': return 'rgba(226,140,90,0.16)';
    case 'drought': return 'rgba(206,170,96,0.18)';
    case 'quake': return 'rgba(170,96,96,0.18)';
    case 'linefault': return 'rgba(120,120,170,0.18)';
    case 'plantfire': return 'rgba(210,120,80,0.16)';
    case 'coldsnap': return 'rgba(140,170,220,0.20)';
    default: return 'rgba(120,120,140,0.15)';
  }
}

// deterministic per-tile jitter without a PRNG cost
function jit(x, y, k = 0) {
  const n = Math.sin((x * 127.1 + y * 311.7 + k * 74.7)) * 43758.5453;
  return n - Math.floor(n);
}

function drawDecoration(ctx, tt, px, py, ts, x, y, anim) {
  const s = ts;
  if (tt === T.forest) {
    for (let i = 0; i < 3; i++) {
      const jx = 0.22 + jit(x, y, i) * 0.56, jy = 0.3 + jit(x, y, i + 9) * 0.45;
      const r = s * (0.11 + jit(x, y, i + 3) * 0.05);
      ctx.fillStyle = '#4f9a6b';
      ctx.beginPath();
      ctx.arc(px + s * jx, py + s * jy + r * 0.5, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#68b783';
      ctx.beginPath();
      ctx.arc(px + s * jx, py + s * jy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (tt === T.hill) {
    ctx.fillStyle = 'rgba(74,104,90,0.3)';
    ctx.beginPath();
    ctx.arc(px + s * 0.5, py + s * 0.86, s * 0.38, Math.PI, 0);
    ctx.fill();
  } else if (tt === T.mountain) {
    ctx.fillStyle = '#9aa0af';
    roundedTri(ctx, px + s * 0.5, py + s * 0.2, s * 0.34, s * 0.62);
    ctx.fillStyle = '#f2f5fa';
    ctx.beginPath();
    ctx.arc(px + s * 0.5, py + s * 0.28, s * 0.1, 0, Math.PI * 2);
    ctx.fill();
  } else if (tt === T.river) {
    // two waves, not one: a single thin curve at tile size reads as a stray ")"
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = Math.max(2, s * 0.07);
    const off = Math.sin(anim * 1.2 + x + y) * s * 0.05;
    for (const k of [-0.14, 0.14]) {
      ctx.beginPath();
      ctx.moveTo(px + s * (0.3 + k), py + s * 0.3 + off);
      ctx.quadraticCurveTo(px + s * (0.62 + k), py + s * 0.5, px + s * (0.36 + k), py + s * 0.74 - off);
      ctx.stroke();
    }
  } else if (tt === T.lake) {
    ctx.strokeStyle = 'rgba(255,255,255,0.66)';
    ctx.lineWidth = Math.max(1.8, s * 0.05);
    ctx.beginPath();
    const off = Math.sin(anim * 1.5 + y) * s * 0.04;
    ctx.ellipse(px + s * 0.5, py + s * 0.5 + off, s * 0.26, s * 0.16, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(px + s * 0.5, py + s * 0.62 + off, s * 0.14, s * 0.07, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (tt === T.fault) {
    ctx.strokeStyle = 'rgba(120,60,60,0.6)';
    ctx.lineWidth = Math.max(1.8, s * 0.055);
    ctx.beginPath();
    ctx.moveTo(px + s * 0.2, py + s * 0.25);
    ctx.lineTo(px + s * 0.45, py + s * 0.5);
    ctx.lineTo(px + s * 0.35, py + s * 0.72);
    ctx.lineTo(px + s * 0.6, py + s * 0.85);
    ctx.stroke();
  } else if (tt === T.field) {
    ctx.strokeStyle = 'rgba(140,110,50,0.38)';
    ctx.lineWidth = 1.6;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(px + s * 0.18, py + s * (0.22 + i * 0.18));
      ctx.lineTo(px + s * 0.82, py + s * (0.22 + i * 0.18));
      ctx.stroke();
    }
  } else if (tt === T.grass && jit(x, y, 5) > 0.55) {
    ctx.fillStyle = 'rgba(80,140,75,0.45)';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(px + s * (0.28 + jit(x, y, i + 11) * 0.44), py + s * (0.3 + jit(x, y, i + 13) * 0.45), s * 0.03, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawTown(ctx, c, px, py, s, anim) {
  const n = 3;
  for (let i = 0; i < n; i++) {
    const bx = px + s * (0.2 + i * 0.22), by = py + s * (0.42 + jit(c.x, c.y, i) * 0.18);
    const bw = s * 0.17, bh = s * 0.3;
    ctx.fillStyle = ['#e9a27f', '#d98f8f', '#e2b27d'][i];
    rr(ctx, bx, by, bw, bh, bw * 0.3);
    ctx.fill();
    ctx.fillStyle = '#b8735f';
    roundedTri(ctx, bx + bw / 2, by - bh * 0.28, bw * 0.62, bh * 0.3);
    // window glow at night
    if (NIGHT > 0.2) {
      ctx.fillStyle = `rgba(255,226,150,${0.5 + 0.4 * NIGHT})`;
      ctx.beginPath();
      ctx.arc(bx + bw * 0.5, by + bh * 0.4, bw * 0.18, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(110,80,70,0.45)';
      ctx.beginPath();
      ctx.arc(bx + bw * 0.5, by + bh * 0.4, bw * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Town name tags, drawn after everything else and nudged clear of each other.
 * Previously each label was painted centred on its own tile with no regard for the
 * others, so on the (common) pair of adjacent towns the two names ran into each
 * other into one unreadable string.
 */
function drawTownLabels(ctx, game, geo) {
  const { ox, oy, cols, rows } = geo;
  const b0 = cellBox(geo, 0, 0);
  const cw = b0.cw, chh = b0.ch;
  const fs = Math.max(9, Math.min(cw, chh) * 0.24);
  ctx.font = `700 ${fs}px ui-rounded, "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const placed = [];   // already-drawn label boxes, for collision tests
  const fits = (b) => placed.every((p) =>
    b.x + b.w < p.x || p.x + p.w < b.x || b.y + b.h < p.y || p.y + p.h < b.y);

  // town tiles and plant tiles the label must not bury — an opaque pill sitting on
  // a turbine reads as a rendering glitch
  const townTiles = game.cities.map((c) => {
    const b = cellBox(geo, c.x, c.y);
    return { x: b.px, y: b.py, w: b.cw, h: b.ch };
  });
  const obstacles = [...townTiles, ...game.plants.filter((p) => p.alive).map((p) => {
    const b = cellBox(geo, p.x, p.y);
    return { x: b.px, y: b.py, w: b.cw, h: b.ch };
  })];
  const overlaps = (b, list) => list.every((t) =>
    b.x + b.w < t.x || t.x + t.w < b.x || b.y + b.h < t.y || t.y + t.h < b.y);
  const clearOfObstacles = (b) => overlaps(b, obstacles);
  const clearOfTowns = (b) => overlaps(b, townTiles);

  for (const c of game.cities) {
    const cell = cellBox(geo, c.x, c.y);
    const full = c.name;
    // Labels go above, below or beside the tile — never on it — and a smaller
    // size is tried as a fallback. Names are never abbreviated: "Pebble…" reads
    // as a rendering bug, not as a nickname. Everything stays inside the map.
    const cands = [];
    const loose = [];   // fallback: clear of other labels/towns but maybe over a plant
    for (const scale of [1, 0.8]) {
      const size = fs * scale;
      ctx.font = `700 ${size}px ui-rounded, "Segoe UI", system-ui, sans-serif`;
      const w = ctx.measureText(full).width;
      const h = size * 1.4;
      for (const [dx, dy] of [
        [0.5, -0.32], [0.5, 1.3], [-0.6, 0.06], [1.6, 0.06], [-0.6, 0.9], [1.6, 0.9],
      ]) {
        const bx = cell.px + cw * dx - w / 2 - 5;
        const by = cell.py + chh * dy;
        const b = { name: full, x: bx, y: by, w: w + 10, h, size };
        if (bx < ox || bx + b.w > ox + cw * cols || by < oy || by + h > oy + chh * rows) continue;
        if (clearOfObstacles(b)) cands.push(b);
        else if (clearOfTowns(b)) loose.push(b);
      }
    }
    // A label that has nowhere clean to go is better placed over a plant than
    // left off: a board full of plants must not silently lose its town names.
    const box = [...cands, ...loose].find(fits);
    if (!box) continue;
    placed.push(box);
    ctx.font = `700 ${box.size}px ui-rounded, "Segoe UI", system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,253,249,0.94)';
    rr(ctx, box.x, box.y, box.w, box.h, box.h * 0.42);
    ctx.fill();
    ctx.strokeStyle = 'rgba(74,68,83,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.fillText(box.name, box.x + box.w / 2, box.y + box.h / 2);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawPlant(ctx, game, p, px, py, s, anim) {
  drawPlantIcon(ctx, p.id, px, py, s, 1, anim, p, game);
  const def = PLANTS[p.id];
  // status ring + a drawn repair mark (an emoji mark here would be an empty box)
  if (p.status === 'damaged') {
    ctx.strokeStyle = '#c8646c';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(px + s * 0.5, py + s * 0.5, s * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.save();
    ctx.translate(px + s * 0.6, py + s * 0.16);
    drawIcon(ctx, 'mark:wrench', s * 0.34);
    ctx.restore();
  }
  if (!p.on) {
    ctx.fillStyle = 'rgba(60,60,80,0.35)';
    rr(ctx, px + 2, py + 2, s - 4, s - 4, s * 0.22);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${s * 0.22}px ui-rounded, system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText('off', px + s * 0.5, py + s * 0.55);
    ctx.textAlign = 'left';
  }
  // live output bar
  if (p.on && p.alive) {
    const cap = availableCapacity(game, p) || 0.0001;
    const frac = Math.max(0, Math.min(1, p.out / (def.kind === 'storage' ? def.power : Math.max(def.cap * 0.2, cap))));
    const bw = s * 0.6;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    rr(ctx, px + s * 0.2, py + s * 0.82, bw, s * 0.1, s * 0.05);
    ctx.fill();
    ctx.fillStyle = def.kind === 'storage'
      ? (p.charge > def.energy * 0.25 ? '#57a773' : '#c9a24a')
      : (p.out > 0.01 ? '#57a773' : '#b9b3c0');
    rr(ctx, px + s * 0.2, py + s * 0.82, Math.max(2, bw * frac), s * 0.1, s * 0.05);
    ctx.fill();
  }
}

function drawWeatherFx(ctx, game, geo, anim) {
  const { ts, ox, oy, cols, rows, w, h } = geo;
  const wx = game.weather;
  const n = wx === 'rain' || wx === 'storm' ? 90 : wx === 'snow' ? 70 : 0;
  if (!n) return;
  ctx.save();
  clipRegion(ctx, geo);
  ctx.strokeStyle = wx === 'snow' ? 'rgba(255,255,255,0.85)' : 'rgba(120,150,190,0.5)';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.6;
  for (let i = 0; i < n; i++) {
    const seedx = jit(i, 1) * w;
    const speed = 140 + jit(i, 2) * 220;
    const y = (jit(i, 3) * h + anim * speed) % h;
    const x = (seedx + anim * (wx === 'storm' ? 90 : 20)) % w;
    if (wx === 'snow') {
      ctx.beginPath();
      ctx.arc(x, y, 1.6 + jit(i, 4) * 1.8, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 2, y + 9);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Weather only falls inside the region card: specks drifting over the gutter
// outside the map read as stray dots rather than weather.
function clipRegion(ctx, geo) {
  const { ox, oy, ts, ch, cols, rows } = geo;
  ctx.beginPath();
  ctx.rect(ox, oy, ts * cols, ch * rows);
  ctx.clip();
}

// Supply/demand ribbon chart ------------------------------------------------
// hist entries: { hour, demand, served, potential, link, deficit }
export function drawChart(canvas, game, hist) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#fffdf9';
  rr(ctx, 0.5, 0.5, w - 1, h - 1, 12);
  ctx.fill();
  if (hist.length < 2) {
    // the card is deliberately not left blank while the run is paused at the start
    ctx.fillStyle = 'rgba(74,68,83,0.5)';
    ctx.font = '12px ui-rounded, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Supply history appears once the run is running.', w / 2, h / 2);
    return;
  }

  // left gutter for the MW axis, and a reserved band at the top for the legend,
  // so the numbers never sit on top of the lines they describe.
  const L = 34, R = 10, T = 26, B = 24;
  const plotW = Math.max(20, w - L - R);
  const plotH = Math.max(20, h - T - B);
  const yTop = T, yBot = T + plotH;

  let max = 10;
  for (const p of hist) max = Math.max(max, p.demand, p.served, p.potential);
  max *= 1.12;
  const n = hist.length;
  const X = (i) => L + (i / (n - 1)) * plotW;
  const Y = (v) => yBot - (v / max) * plotH;

  // --- gridlines with MW labels -------------------------------------------
  const step = niceStep(max);
  ctx.font = '10px ui-rounded, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (let v = step; v <= max; v += step) {
    const y = Y(v);
    ctx.strokeStyle = 'rgba(74,68,83,0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + plotW, y); ctx.stroke();
    ctx.fillStyle = 'rgba(74,68,83,0.7)';
    ctx.textAlign = 'right';
    ctx.fillText(String(Math.round(v)), L - 5, y);
  }
  // baseline
  ctx.strokeStyle = 'rgba(74,68,83,0.22)';
  ctx.beginPath(); ctx.moveTo(L, yBot); ctx.lineTo(L + plotW, yBot); ctx.stroke();
  ctx.fillStyle = 'rgba(74,68,83,0.55)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('MW', 6, yTop + 4);

  // --- time labels: day numbers at midnight, one evening-peak mark per day ----
  // Labelling every 18:00 read as meaningless repetition; the day boundary is the
  // unit a player actually reasons in, and the peak mark only shows where there is
  // room for it.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const axisPills = [];
  let lastPeakX = -1e9;
  for (let i = 0; i < n; i++) {
    const hr = hist[i].hour;
    if (hr === 0) {
      const x = X(i);
      ctx.strokeStyle = 'rgba(74,68,83,0.18)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(x, yTop); ctx.lineTo(x, yBot); ctx.stroke();
      ctx.setLineDash([]);
      if (i > 1 && i < n - 2) {
        ctx.font = '700 10px ui-rounded, system-ui, sans-serif';
        pillText(ctx, `day ${hist[i].day}`, x, yBot + 8, 'centre', axisPills);
        ctx.font = '10px ui-rounded, system-ui, sans-serif';
      }
    } else if (hr === 18 && X(i) - lastPeakX > 40) {
      // the evening peak is marked on the demand curve itself; the axis row only
      // carries day numbers, so the two can never collide into unreadable text
      lastPeakX = X(i);
      const px = X(i), py = Y(hist[i].demand);
      ctx.fillStyle = 'rgba(200,110,80,0.95)';
      ctx.beginPath();
      ctx.moveTo(px - 4, py - 6);
      ctx.lineTo(px, py - 13);
      ctx.lineTo(px + 4, py - 6);
      ctx.closePath();
      ctx.fill();
    }
  }

  function pillText(ctx2, text, x, y, align, taken) {
    // a light pill behind axis text so gridlines never strike through the digits,
    // and never let one pill sit on top of the last
    const w = ctx2.measureText(text).width;
    const x0 = align === 'centre' ? x - w / 2 - 4 : x - 4;
    if (taken && taken.some((b) => x0 < b.x + b.w && b.x < x0 + w + 8)) return;
    if (taken) taken.push({ x: x0, w: w + 8 });
    ctx2.fillStyle = 'rgba(255,253,249,0.92)';
    rr(ctx2, x0, y - 1, w + 8, 13, 6);
    ctx2.fill();
    ctx2.fillStyle = align === 'left' ? 'rgba(160,90,60,0.95)' : 'rgba(74,68,83,0.78)';
    ctx2.textAlign = 'left';
    ctx2.fillText(text, x0 + 4, y + 9);
    ctx2.textAlign = align === 'centre' ? 'center' : 'left';
  }


  // --- tie-line capacity, only when it is actually the constraint ---------
  const link = hist[n - 1].link;
  let linkLabel = null;
  if (link < max * 0.98) {
    const y = Y(link);
    ctx.strokeStyle = 'rgba(106,143,214,0.55)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + plotW, y); ctx.stroke();
    ctx.setLineDash([]);
    // label drawn after the series, on a pill, and inset from the axis so it
    // cannot collide with the MW numbers or the first day line
    linkLabel = { y, text: `tie-line ${Math.round(link)} MW` };
  }

  // --- available capacity, as a filled area -------------------------------
  ctx.fillStyle = 'rgba(87,167,115,0.20)';
  ctx.beginPath();
  ctx.moveTo(X(0), Y(0));
  for (let i = 0; i < n; i++) ctx.lineTo(X(i), Y(hist[i].potential));
  ctx.lineTo(X(n - 1), Y(0));
  ctx.closePath();
  ctx.fill();

  // --- demand: always a visible line, dashed; red only while unmet --------
  const last = hist[n - 1];
  const unmet = last.demand - last.served > 0.5;
  ctx.strokeStyle = unmet ? 'rgba(200,100,108,0.95)' : 'rgba(200,120,90,0.9)';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  for (let i = 0; i < n; i++) { const x = X(i), y = Y(hist[i].demand); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke();
  ctx.setLineDash([]);

  // --- served -------------------------------------------------------------
  ctx.strokeStyle = '#4f7fc9';
  ctx.lineWidth = 2.6;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < n; i++) { const x = X(i), y = Y(hist[i].served); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke();

  // --- blackout stubs, filled so the deficit is impossible to miss ---------
  for (let i = 0; i < n; i++) {
    const u = hist[i].demand - hist[i].served;
    if (u <= 0.5) continue;
    ctx.strokeStyle = 'rgba(200,90,90,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X(i), Y(hist[i].served));
    ctx.lineTo(X(i), Y(hist[i].demand));
    ctx.stroke();
  }
  // tie-line label last of all, so the pill sits on top of the lines it names
  if (linkLabel) {
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const lw = ctx.measureText(linkLabel.text).width;
    ctx.fillStyle = 'rgba(255,253,249,0.92)';
    rr(ctx, L + 8, linkLabel.y - 15, lw + 8, 13, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(55,80,130,0.95)';
    ctx.fillText(linkLabel.text, L + 12, linkLabel.y - 5);
  }

  // --- current numbers, in the reserved band above the plot ----------------
  const now = [
    ['demand', Math.round(last.demand), 'rgba(200,120,90,1)'],
    ['served', Math.round(last.served), '#4f7fc9'],
    ['available', Math.round(last.potential), 'rgba(87,167,115,1)'],
  ];
  ctx.font = '11px ui-rounded, system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  let lx = L + plotW - 6;
  for (let k = now.length - 1; k >= 0; k--) {
    const [label, value, col] = now[k];
    ctx.textAlign = 'right';
    ctx.fillStyle = INK;
    ctx.fillText(`${value} MW`, lx, 16);
    const vw = ctx.measureText(`${value} MW`).width;
    ctx.fillStyle = col;
    ctx.fillText(`${label}`, lx - vw - 5, 16);
    lx -= vw + ctx.measureText(label).width + 20;
  }
  if (unmet) {
    ctx.fillStyle = '#b34b53';
    ctx.font = '700 11px ui-rounded, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`shortfall ${Math.round(last.demand - last.served)} MW`, L + 4, 16);
  }
  ctx.textAlign = 'left';
}

// A readable axis step: 5, 10, 20, 25, 50, 100 ...
function niceStep(max) {
  const raw = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * pow) return Math.max(1, Math.round(m * pow));
  return Math.max(1, Math.round(raw));
}
