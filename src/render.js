// Cute, soft renderer. Everything here is generated in code: rounded tiles,
// pastel terrain, plants drawn as friendly shapes, no external art.

import { PLANTS } from './sim/plants.js';
import { T, TERRAIN_NAMES } from './sim/world.js';
import { WEATHER } from './sim/hazards.js';
import { hourOf, availableCapacity } from './sim/engine.js';

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

const INK = '#4a4453';
const SOFT = 'rgba(74,68,83,0.14)';
let NIGHT = 0;   // night darkness for the current frame (town window glow)

export function tileAt(pX, pY, geo) {
  const cx = Math.floor((pX - geo.ox) / geo.ts);
  const cy = Math.floor((pY - geo.oy) / geo.ts);
  return { x: cx, y: cy };
}

export function layout(canvas, cols, rows) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ts = Math.floor(Math.min(w / cols, h / rows));
  const ox = Math.floor((w - ts * cols) / 2);
  const oy = Math.floor((h - ts * rows) / 2);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, ts, ox, oy, cols, rows, w, h };
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function drawWorld(game, geo, ui) {
  const { ctx, ts, ox, oy, cols, rows, w, h } = geo;
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
  // tiles
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const tt = game.map[y][x];
      const px = ox + x * ts, py = oy + y * ts;
      const pal = GROUND[tt] || GROUND[T.grass];
      const even = (x + y) % 2 === 0;
      ctx.fillStyle = even ? pal[0] : pal[1];
      rr(ctx, px + 1, py + 1, ts - 2, ts - 2, ts * 0.22);
      ctx.fill();
      drawDecoration(ctx, tt, px, py, ts, x, y, anim);
    }
  }

  // hazard overlay on the map
  if (hzTint) {
    ctx.save();
    rr(ctx, ox, oy, ts * cols, ts * rows, ts * 0.25);
    ctx.fillStyle = hzTint;
    ctx.fill();
    ctx.restore();
  }
  if (night > 0.02) {
    ctx.save();
    rr(ctx, ox, oy, ts * cols, ts * rows, ts * 0.25);
    ctx.fillStyle = `rgba(40,52,88,${0.30 * night})`;
    ctx.fill();
    ctx.restore();
  }

  // towns
  for (const c of game.cities) drawTown(ctx, c, ox + c.x * ts, oy + c.y * ts, ts, anim, c.mood);

  // plants
  for (const p of game.plants) {
    const px = ox + p.x * ts, py = oy + p.y * ts;
    drawPlant(ctx, game, p, px, py, ts, anim);
  }

  // hover / placement ghost
  if (ui.hover) {
    const px = ox + ui.hover.x * ts, py = oy + ui.hover.y * ts;
    ctx.save();
    ctx.lineWidth = 3;
    if (ui.buildSel) {
      const ok = ui.hoverOk;
      ctx.strokeStyle = ok ? '#48a06a' : '#c8646c';
      ctx.fillStyle = ok ? 'rgba(72,160,106,0.20)' : 'rgba(200,100,108,0.20)';
      rr(ctx, px + 2, py + 2, ts - 4, ts - 4, ts * 0.22);
      ctx.fill();
      ctx.stroke();
      if (ok) {
        ctx.globalAlpha = 0.85;
        drawPlantIcon(ctx, ui.buildSel, px, py, ts, 0, anim);
        ctx.globalAlpha = 1;
      }
    } else {
      ctx.strokeStyle = 'rgba(74,68,83,0.55)';
      rr(ctx, px + 2, py + 2, ts - 4, ts - 4, ts * 0.22);
      ctx.stroke();
    }
    ctx.restore();
  }

  // selection ring
  if (ui.selected) {
    const p = game.plants.find((q) => q.uid === ui.selected);
    if (p) {
      const px = ox + p.x * ts, py = oy + p.y * ts;
      ctx.save();
      ctx.strokeStyle = '#6a8fd6';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      rr(ctx, px + 2, py + 2, ts - 4, ts - 4, ts * 0.22);
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
      const r = s * (0.10 + jit(x, y, i + 3) * 0.05);
      ctx.fillStyle = '#5da877';
      ctx.beginPath();
      ctx.arc(px + s * jx, py + s * jy + r * 0.5, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6ab985';
      ctx.beginPath();
      ctx.arc(px + s * jx, py + s * jy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (tt === T.hill) {
    ctx.fillStyle = 'rgba(90,120,105,0.22)';
    ctx.beginPath();
    ctx.arc(px + s * 0.5, py + s * 0.86, s * 0.38, Math.PI, 0);
    ctx.fill();
  } else if (tt === T.mountain) {
    ctx.fillStyle = '#aeb3c0';
    roundedTri(ctx, px + s * 0.5, py + s * 0.2, s * 0.34, s * 0.62);
    ctx.fillStyle = '#eef1f6';
    ctx.beginPath();
    ctx.arc(px + s * 0.5, py + s * 0.28, s * 0.1, 0, Math.PI * 2);
    ctx.fill();
  } else if (tt === T.river) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.beginPath();
    const off = Math.sin(anim * 1.2 + x + y) * s * 0.05;
    ctx.moveTo(px + s * 0.3, py + s * 0.32 + off);
    ctx.quadraticCurveTo(px + s * 0.6, py + s * 0.5, px + s * 0.4, py + s * 0.72 - off);
    ctx.stroke();
  } else if (tt === T.lake) {
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = Math.max(1.5, s * 0.04);
    ctx.beginPath();
    const off = Math.sin(anim * 1.5 + y) * s * 0.04;
    ctx.ellipse(px + s * 0.5, py + s * 0.5 + off, s * 0.26, s * 0.16, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (tt === T.fault) {
    ctx.strokeStyle = 'rgba(120,72,72,0.4)';
    ctx.lineWidth = Math.max(1.5, s * 0.045);
    ctx.beginPath();
    ctx.moveTo(px + s * 0.2, py + s * 0.25);
    ctx.lineTo(px + s * 0.45, py + s * 0.5);
    ctx.lineTo(px + s * 0.35, py + s * 0.72);
    ctx.lineTo(px + s * 0.6, py + s * 0.85);
    ctx.stroke();
  } else if (tt === T.field) {
    ctx.strokeStyle = 'rgba(150,120,60,0.22)';
    ctx.lineWidth = 1.5;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(px + s * 0.18, py + s * (0.22 + i * 0.18));
      ctx.lineTo(px + s * 0.82, py + s * (0.22 + i * 0.18));
      ctx.stroke();
    }
  } else if (tt === T.grass && jit(x, y, 5) > 0.55) {
    ctx.fillStyle = 'rgba(120,170,110,0.5)';
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.arc(px + s * (0.3 + jit(x, y, i + 11) * 0.4), py + s * (0.35 + jit(x, y, i + 13) * 0.4), s * 0.025, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function roundedTri(ctx, cx, topY, halfW, h) {
  ctx.beginPath();
  ctx.moveTo(cx, topY);
  ctx.lineTo(cx + halfW, topY + h);
  ctx.quadraticCurveTo(cx, topY + h + halfW * 0.25, cx - halfW, topY + h);
  ctx.closePath();
  ctx.fill();
}

function drawTown(ctx, c, px, py, s, anim, mood) {
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
      ctx.arc(bx + bw * 0.5, by + bh * 0.4, bw * 0.16, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(120,90,80,0.35)';
      ctx.beginPath();
      ctx.arc(bx + bw * 0.5, by + bh * 0.4, bw * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // name tag
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  const label = c.name;
  ctx.font = `600 ${Math.max(9, s * 0.19)}px ui-rounded, "Segoe UI", system-ui, sans-serif`;
  const tw = ctx.measureText(label).width;
  rr(ctx, px + s * 0.5 - tw / 2 - 5, py + s * 0.02, tw + 10, s * 0.24, s * 0.1);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, px + s * 0.5, py + s * 0.14);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

export function drawPlant(ctx, game, p, px, py, s, anim) {
  drawPlantIcon(ctx, p.id, px, py, s, 1, anim, p, game);
  const def = PLANTS[p.id];
  // status ring
  if (p.status === 'damaged') {
    ctx.strokeStyle = '#c8646c';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(px + s * 0.5, py + s * 0.5, s * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#c8646c';
    ctx.font = `${s * 0.2}px ui-rounded, system-ui`;
    ctx.fillText('🔧', px + s * 0.7, py + s * 0.3);
  }
  if (!p.on) {
    ctx.fillStyle = 'rgba(60,60,80,0.35)';
    rr(ctx, px + 2, py + 2, s - 4, s - 4, s * 0.22);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `${s * 0.22}px ui-rounded, system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText('off', px + s * 0.5, py + s * 0.55);
    ctx.textAlign = 'left';
  }
  // live output bar
  if (p.on && p.alive) {
    const cap = availableCapacity(game, p) || 0.0001;
    const frac = Math.max(0, Math.min(1, p.out / (def.kind === 'storage' ? def.power : Math.max(def.cap * 0.2, cap))));
    const bw = s * 0.6;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    rr(ctx, px + s * 0.2, py + s * 0.82, bw, s * 0.1, s * 0.05);
    ctx.fill();
    ctx.fillStyle = def.kind === 'storage'
      ? (p.charge > def.energy * 0.25 ? '#57a773' : '#c9a24a')
      : (p.out > 0.01 ? '#57a773' : '#b9b3c0');
    rr(ctx, px + s * 0.2, py + s * 0.82, Math.max(2, bw * frac), s * 0.1, s * 0.05);
    ctx.fill();
  }
}

// iconKind: 0 = ghost preview, 1 = real plant (uses plant record for state)
export function drawPlantIcon(ctx, plantId, px, py, s, kind, anim, p, game) {
  const cx = px + s * 0.5, cy = py + s * 0.52;
  const u = s;
  ctx.save();
  // soft drop shadow
  ctx.fillStyle = SOFT;
  ctx.beginPath();
  ctx.ellipse(cx, py + s * 0.74, u * 0.26, u * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();

  const on = kind === 0 || (p && p.on);
  switch (plantId) {
    case 'solar': {
      ctx.fillStyle = '#7fb2d9';
      for (let i = 0; i < 2; i++) {
        rr(ctx, cx - u * 0.3 + i * u * 0.31, cy - u * 0.16, u * 0.28, u * 0.3, u * 0.05);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 2; i++) {
        const bx = cx - u * 0.3 + i * u * 0.31;
        ctx.beginPath();
        ctx.moveTo(bx + u * 0.14, cy - u * 0.16);
        ctx.lineTo(bx + u * 0.14, cy + u * 0.14);
        ctx.moveTo(bx, cy - u * 0.01);
        ctx.lineTo(bx + u * 0.28, cy - u * 0.01);
        ctx.stroke();
      }
      ctx.fillStyle = '#c9a24a';
      rr(ctx, cx - u * 0.03, cy + u * 0.14, u * 0.06, u * 0.14, 2);
      ctx.fill();
      if (on && anim != null) {
        ctx.fillStyle = `rgba(255,238,180,${0.35 + 0.25 * Math.sin(anim * 2)})`;
        ctx.beginPath();
        ctx.arc(cx + u * 0.3, cy - u * 0.28, u * 0.07, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'wind': {
      ctx.strokeStyle = '#8d97a8';
      ctx.lineWidth = Math.max(2, u * 0.045);
      ctx.beginPath();
      ctx.moveTo(cx, cy + u * 0.26);
      ctx.lineTo(cx, cy - u * 0.18);
      ctx.stroke();
      const spin = on && anim != null ? anim * (0.8 + windSpin(game)) : 0.4;
      ctx.fillStyle = '#eef2f7';
      for (let i = 0; i < 3; i++) {
        const a = spin + (i * Math.PI * 2) / 3;
        ctx.save();
        ctx.translate(cx, cy - u * 0.18);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(0, -u * 0.15, u * 0.045, u * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = '#6d7787';
      ctx.beginPath();
      ctx.arc(cx, cy - u * 0.18, u * 0.05, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'hydro': {
      ctx.fillStyle = '#cfd6e2';
      rr(ctx, cx - u * 0.26, cy - u * 0.1, u * 0.5, u * 0.34, u * 0.09);
      ctx.fill();
      ctx.fillStyle = '#8fc6ea';
      rr(ctx, cx - u * 0.2, cy - u * 0.02, u * 0.4, u * 0.16, u * 0.06);
      ctx.fill();
      ctx.strokeStyle = '#7d8798';
      ctx.lineWidth = Math.max(1.6, u * 0.03);
      ctx.beginPath();
      ctx.arc(cx, cy - u * 0.16, u * 0.13, 0, Math.PI * 2);
      ctx.stroke();
      const a0 = on && anim != null ? anim * 1.4 : 0;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(cx, cy - u * 0.16);
        ctx.lineTo(cx + Math.cos(a0 + i * Math.PI / 2) * u * 0.12, cy - u * 0.16 + Math.sin(a0 + i * Math.PI / 2) * u * 0.12);
        ctx.stroke();
      }
      break;
    }
    case 'battery': {
      const ch = p ? p.charge / PLANTS.battery.energy : 0.5;
      ctx.fillStyle = '#8fbf9c';
      rr(ctx, cx - u * 0.26, cy - u * 0.2, u * 0.52, u * 0.42, u * 0.1);
      ctx.fill();
      ctx.fillStyle = '#f4f7f2';
      rr(ctx, cx - u * 0.2, cy - u * 0.14, u * 0.4, u * 0.3, u * 0.07);
      ctx.fill();
      ctx.fillStyle = ch > 0.25 ? '#57a773' : '#c9a24a';
      const hh = u * 0.3 * Math.max(0.05, ch);
      rr(ctx, cx - u * 0.2, cy - u * 0.14 + (u * 0.3 - hh), u * 0.4, hh, u * 0.06);
      ctx.fill();
      ctx.fillStyle = '#8fbf9c';
      rr(ctx, cx + u * 0.26, cy - u * 0.06, u * 0.06, u * 0.14, 2);
      ctx.fill();
      break;
    }
    case 'coal': {
      ctx.fillStyle = '#b9b3c0';
      rr(ctx, cx - u * 0.3, cy - u * 0.06, u * 0.6, u * 0.32, u * 0.08);
      ctx.fill();
      ctx.fillStyle = '#9a93a5';
      for (let i = 0; i < 2; i++) {
        rr(ctx, cx - u * 0.2 + i * u * 0.28, cy - u * 0.3, u * 0.11, u * 0.28, u * 0.04);
        ctx.fill();
      }
      ctx.fillStyle = '#efeae2';
      rr(ctx, cx - u * 0.22, cy + 0.04 * u, u * 0.12, u * 0.14, u * 0.03);
      ctx.fill();
      if (on && p && p.out > 0.01 && anim != null) puff(ctx, cx - u * 0.14, cy - u * 0.32, anim, u);
      break;
    }
    case 'gas': {
      ctx.fillStyle = '#d9b79c';
      rr(ctx, cx - u * 0.24, cy - u * 0.14, u * 0.48, u * 0.4, u * 0.1);
      ctx.fill();
      ctx.fillStyle = '#b9927a';
      rr(ctx, cx - u * 0.14, cy - u * 0.26, u * 0.28, u * 0.14, u * 0.05);
      ctx.fill();
      ctx.fillStyle = '#efeae2';
      rr(ctx, cx - u * 0.16, cy + u * 0.04, u * 0.32, u * 0.1, u * 0.04);
      ctx.fill();
      if (on && p && p.out > 0.01 && anim != null) flame(ctx, cx, cy - u * 0.3, anim, u * 0.55);
      break;
    }
    case 'nuclear': {
      ctx.fillStyle = '#cdd8e6';
      roundedTri(ctx, cx, cy - u * 0.3, u * 0.26, u * 0.5);
      ctx.fillStyle = '#eef2f7';
      rr(ctx, cx - u * 0.3, cy + u * 0.06, u * 0.6, u * 0.2, u * 0.06);
      ctx.fill();
      if (anim != null) {
        ctx.strokeStyle = 'rgba(120,150,200,0.85)';
        ctx.lineWidth = Math.max(1.4, u * 0.025);
        const a0 = on ? anim * 1.2 : 0;
        for (let i = 0; i < 2; i++) {
          ctx.beginPath();
          ctx.ellipse(cx, cy - u * 0.1, u * 0.17, u * 0.07, a0 + i * Math.PI / 2, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      break;
    }
  }
  ctx.restore();
}
function windSpin(game) {
  const w = WEATHER[game && game.weather ? game.weather : 'clear'];
  return w ? w.wind * 0.6 : 0.6;
}

function puff(ctx, x, y, anim, u) {
  for (let i = 0; i < 3; i++) {
    const ph = (anim * 0.5 + i / 3) % 1;
    ctx.fillStyle = `rgba(225,225,232,${0.5 * (1 - ph)})`;
    ctx.beginPath();
    ctx.arc(x, y - ph * u * 0.4, u * (0.05 + ph * 0.06), 0, Math.PI * 2);
    ctx.fill();
  }
}

function flame(ctx, x, y, anim, u) {
  const f = 0.7 + 0.3 * Math.sin(anim * 9);
  ctx.fillStyle = 'rgba(240,150,90,0.9)';
  ctx.beginPath();
  ctx.ellipse(x, y - u * 0.1, u * 0.07, u * 0.13 * f, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,220,140,0.9)';
  ctx.beginPath();
  ctx.ellipse(x, y - u * 0.06, u * 0.04, u * 0.08 * f, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawWeatherFx(ctx, game, geo, anim) {
  const { ts, ox, oy, cols, rows, w, h } = geo;
  const wx = game.weather;
  const n = wx === 'rain' || wx === 'storm' ? 90 : wx === 'snow' ? 70 : 0;
  if (!n) return;
  ctx.save();
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

// Supply/demand ribbon chart ------------------------------------------------
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
  if (!hist.length) return;

  const pad = 6;
  let max = 10;
  for (const p of hist) max = Math.max(max, p.demand, p.served, p.potential);
  max *= 1.12;
  const n = hist.length;
  const X = (i) => pad + (i / Math.max(1, n - 1)) * (w - pad * 2);
  const Y = (v) => h - pad - (v / max) * (h - pad * 2);

  // link capacity line
  const link = game.lastFlow.link;
  if (link < max) {
    ctx.strokeStyle = 'rgba(120,120,140,0.35)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(pad, Y(link));
    ctx.lineTo(w - pad, Y(link));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(100,100,120,0.7)';
    ctx.font = '10px ui-rounded, system-ui, sans-serif';
    ctx.fillText(`tie-line ${Math.round(link)} MW`, pad + 2, Y(link) - 3);
  }

  // potential (soft area)
  ctx.fillStyle = 'rgba(140,190,150,0.28)';
  ctx.beginPath();
  ctx.moveTo(X(0), Y(0));
  for (let i = 0; i < n; i++) ctx.lineTo(X(i), Y(hist[i].potential));
  ctx.lineTo(X(n - 1), Y(0));
  ctx.closePath();
  ctx.fill();

  // demand (dashed)
  ctx.strokeStyle = 'rgba(200,120,90,0.95)';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  for (let i = 0; i < n; i++) { const x = X(i), y = Y(hist[i].demand); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke();
  ctx.setLineDash([]);

  // served (thick soft line)
  ctx.strokeStyle = '#5c8fd6';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < n; i++) { const x = X(i), y = Y(hist[i].served); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke();

  // unmet highlight
  for (let i = 0; i < n; i++) {
    const u = hist[i].demand - hist[i].served;
    if (u > 0.5) {
      ctx.strokeStyle = 'rgba(200,90,90,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(X(i), Y(hist[i].served));
      ctx.lineTo(X(i), Y(hist[i].demand));
      ctx.stroke();
    }
  }

  // legend
  ctx.font = '10px ui-rounded, system-ui, sans-serif';
  const items = [['demand', 'rgba(200,120,90,0.95)'], ['served', '#5c8fd6'], ['available', 'rgba(140,190,150,0.6)']];
  let lx = w - pad - 4;
  ctx.textAlign = 'right';
  for (const [label, col] of items.slice().reverse()) {
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(74,68,83,0.75)';
    ctx.fillText(label, lx, h - pad - 2);
    lx -= tw + 6;
    ctx.fillStyle = col;
    rr(ctx, lx - 10, h - pad - 10, 10, 5, 2);
    ctx.fill();
    lx -= 22;
  }
  ctx.textAlign = 'left';
}
