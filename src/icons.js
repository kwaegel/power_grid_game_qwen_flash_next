// All hand-drawn art in one place: plant shapes, terrain-adjacent primitives, and
// the small glyphs for weather, hazards and upgrades. No emoji, no font glyphs, no
// image files — everything here is vector drawing on a canvas context.
//
// Emoji were the original icon set, and that was a mistake: a machine without an
// emoji font paints a hollow box for every one of them, so the game silently loses
// its whole visual language. Plant art already existed as canvas vectors, so the
// fix is to reuse it — the map, the build palette, the detail card and the help
// table now draw the same shapes from this one source.
//
// DOM usage: put  <span data-icon="weather:storm" data-size="20"></span>  in
// markup and call paintIcons(root) after the innerHTML lands.

import { PLANTS } from './sim/plants.js';
import { WEATHER } from './sim/hazards.js';

export const INK = '#4a4453';
export const SOFT = 'rgba(74,68,83,0.14)';

// ---- shared primitives ------------------------------------------------------

export function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function roundedTri(ctx, cx, topY, halfW, h) {
  ctx.beginPath();
  ctx.moveTo(cx, topY);
  ctx.lineTo(cx + halfW, topY + h);
  ctx.quadraticCurveTo(cx, topY + h + halfW * 0.25, cx - halfW, topY + h);
  ctx.closePath();
  ctx.fill();
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

function flameFx(ctx, x, y, anim, u) {
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

function windSpin(game) {
  const w = WEATHER[game && game.weather ? game.weather : 'clear'];
  return w ? w.wind * 0.6 : 0.6;
}

// ---- plant art --------------------------------------------------------------

/**
 * Draw a plant inside the tile whose top-left is (px, py) and whose side is s.
 * kind: 0 = placement ghost, 1 = a real plant (uses p.on / p.out / animation).
 */
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
      ctx.fillStyle = '#f2f5fa';
      ctx.strokeStyle = '#9fb0c6';
      ctx.lineWidth = Math.max(1, u * 0.012);
      for (let i = 0; i < 3; i++) {
        const a = spin + (i * Math.PI * 2) / 3;
        ctx.save();
        ctx.translate(cx, cy - u * 0.18);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(0, -u * 0.15, u * 0.045, u * 0.16, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = '#6d7787';
      ctx.beginPath();
      ctx.arc(cx, cy - u * 0.18, u * 0.05, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'hydro': {
      ctx.fillStyle = '#b9c4d6';
      rr(ctx, cx - u * 0.26, cy - u * 0.1, u * 0.5, u * 0.34, u * 0.09);
      ctx.fill();
      ctx.fillStyle = '#79b6e4';
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
      ctx.fillStyle = '#a49cb0';
      rr(ctx, cx - u * 0.3, cy - u * 0.06, u * 0.6, u * 0.32, u * 0.08);
      ctx.fill();
      ctx.fillStyle = '#847b91';
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
      if (on && p && p.out > 0.01 && anim != null) flameFx(ctx, cx, cy - u * 0.3, anim, u * 0.55);
      break;
    }
    case 'nuclear': {
      ctx.fillStyle = '#b7c6da';
      roundedTri(ctx, cx, cy - u * 0.3, u * 0.26, u * 0.5);
      ctx.fillStyle = '#dfe7f0';
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
    default:
      return false;
  }
  ctx.restore();
  return true;
}

// ---- small glyphs -----------------------------------------------------------

function sun(ctx, cx, cy, r, rays = true) {
  ctx.fillStyle = '#e8b45c';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  if (rays) {
    ctx.strokeStyle = '#e8b45c';
    ctx.lineWidth = Math.max(1.2, r * 0.22);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 1.4, cy + Math.sin(a) * r * 1.4);
      ctx.lineTo(cx + Math.cos(a) * r * 1.85, cy + Math.sin(a) * r * 1.85);
      ctx.stroke();
    }
  }
}

function cloud(ctx, cx, cy, r) {
  ctx.fillStyle = '#9fb0c6';
  for (const [dx, dy, k] of [[-1, 0.15, 0.75], [0, -0.25, 1], [1, 0.1, 0.7]]) {
    ctx.beginPath();
    ctx.arc(cx + dx * r, cy + dy * r, r * k, 0, Math.PI * 2);
    ctx.fill();
  }
  rr(ctx, cx - r * 1.6, cy + r * 0.1, r * 3.2, r * 0.9, r * 0.45);
  ctx.fill();
}

function bolt(ctx, cx, cy, r) {
  ctx.fillStyle = '#e8b45c';
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.15, cy - r);
  ctx.lineTo(cx - r * 0.6, cy + r * 0.25);
  ctx.lineTo(cx - r * 0.05, cy + r * 0.25);
  ctx.lineTo(cx - r * 0.2, cy + r);
  ctx.lineTo(cx + r * 0.7, cy - r * 0.3);
  ctx.lineTo(cx + r * 0.15, cy - r * 0.3);
  ctx.closePath();
  ctx.fill();
}

function flake(ctx, cx, cy, r) {
  ctx.strokeStyle = '#5f8fc4';
  ctx.lineWidth = Math.max(1.3, r * 0.22);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * r, cy - Math.sin(a) * r);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.stroke();
  }
}

function fire(ctx, cx, cy, r) {
  ctx.fillStyle = '#e08a54';
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.bezierCurveTo(cx + r * 0.85, cy - r * 0.15, cx + r * 0.55, cy + r, cx, cy + r);
  ctx.bezierCurveTo(cx - r * 0.55, cy + r, cx - r * 0.85, cy - r * 0.15, cx, cy - r);
  ctx.fill();
  ctx.fillStyle = '#f6d38a';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.3, r * 0.32, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
}

function crack(ctx, cx, cy, r) {
  ctx.strokeStyle = '#8a7f96';
  ctx.lineWidth = Math.max(1.4, r * 0.24);
  ctx.beginPath();
  ctx.moveTo(cx - r, cy - r * 0.7);
  ctx.lineTo(cx - r * 0.1, cy - r * 0.1);
  ctx.lineTo(cx - r * 0.55, cy + r * 0.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.15, cy - r);
  ctx.lineTo(cx + r * 0.7, cy + r * 0.2);
  ctx.stroke();
}

function drops(ctx, cx, cy, r, n = 3) {
  ctx.strokeStyle = '#5f96c2';
  ctx.lineWidth = Math.max(1.3, r * 0.14);
  for (let i = 0; i < n; i++) {
    const x = cx + (i - (n - 1) / 2) * r * 0.9;
    ctx.beginPath();
    ctx.moveTo(x, cy + r * 0.9);
    ctx.lineTo(x - r * 0.16, cy + r * 1.6);
    ctx.stroke();
  }
}

function heatWaves(ctx, cx, cy, r) {
  ctx.strokeStyle = '#e08a54';
  ctx.lineWidth = Math.max(1.2, r * 0.18);
  for (let i = 0; i < 2; i++) {
    const y = cy + r * 1.1 + i * r * 0.55;
    ctx.beginPath();
    ctx.moveTo(cx - r * 1.1, y);
    ctx.quadraticCurveTo(cx - r * 0.55, y - r * 0.4, cx, y);
    ctx.quadraticCurveTo(cx + r * 0.55, y + r * 0.4, cx + r * 1.1, y);
    ctx.stroke();
  }
}

function gust(ctx, cx, cy, r) {
  ctx.strokeStyle = '#6f7c92';
  ctx.lineWidth = Math.max(1.6, r * 0.2);
  for (let i = -1; i <= 1; i++) {
    const y = cy + i * r * 0.7;
    ctx.beginPath();
    ctx.moveTo(cx - r * 1.15, y);
    ctx.lineTo(cx + r * (i === 1 ? 0.9 : 0.55), y);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx + r * 0.8, cy - r * 0.7, r * 0.32, Math.PI * 0.4, Math.PI * 1.7);
  ctx.stroke();
}

function leaf(ctx, cx, cy, r) {
  ctx.strokeStyle = '#6fae7c';
  ctx.fillStyle = 'rgba(111,174,124,0.25)';
  ctx.lineWidth = Math.max(1.2, r * 0.18);
  ctx.beginPath();
  ctx.moveTo(cx - r, cy + r * 0.9);
  ctx.quadraticCurveTo(cx - r * 0.9, cy - r * 0.9, cx + r, cy - r);
  ctx.quadraticCurveTo(cx + r * 0.9, cy + r * 0.6, cx - r, cy + r * 0.9);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.85, cy + r * 0.8);
  ctx.lineTo(cx + r * 0.7, cy - r * 0.75);
  ctx.stroke();
}

function wrench(ctx, cx, cy, r) {
  ctx.strokeStyle = '#7d8798';
  ctx.lineWidth = Math.max(1.6, r * 0.32);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.8, cy + r * 0.8);
  ctx.lineTo(cx + r * 0.2, cy - r * 0.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + r * 0.5, cy - r * 0.5, r * 0.45, Math.PI * 0.15, Math.PI * 1.5);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function linkGlyph(ctx, cx, cy, r) {
  ctx.strokeStyle = '#6a8fd6';
  ctx.lineWidth = Math.max(1.5, r * 0.3);
  ctx.beginPath();
  ctx.arc(cx - r * 0.4, cy, r * 0.55, Math.PI * 0.55, Math.PI * 1.55);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + r * 0.4, cy, r * 0.55, Math.PI * 1.55, Math.PI * 0.55);
  ctx.stroke();
}

function dish(ctx, cx, cy, r) {
  ctx.strokeStyle = '#6a8fd6';
  ctx.lineWidth = Math.max(1.4, r * 0.22);
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.3, r * 0.9, Math.PI * 1.15, Math.PI * 1.95);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.4, cy + r * 1.05);
  ctx.lineTo(cx + r * 0.5, cy - r * 0.45);
  ctx.stroke();
  ctx.fillStyle = '#6a8fd6';
  ctx.beginPath(); ctx.arc(cx + r * 0.55, cy - r * 0.5, r * 0.18, 0, Math.PI * 2); ctx.fill();
}

function chipGlyph(ctx, cx, cy, r) {
  ctx.fillStyle = 'rgba(106,143,214,0.18)';
  ctx.strokeStyle = '#6a8fd6';
  ctx.lineWidth = Math.max(1.3, r * 0.16);
  rr(ctx, cx - r * 0.7, cy - r * 0.7, r * 1.4, r * 1.4, r * 0.25);
  ctx.fill(); ctx.stroke();
  ctx.beginPath();
  for (let i = -1; i <= 1; i++) {
    ctx.moveTo(cx + i * r * 0.42, cy - r * 0.7); ctx.lineTo(cx + i * r * 0.42, cy - r * 1.1);
    ctx.moveTo(cx + i * r * 0.42, cy + r * 0.7); ctx.lineTo(cx + i * r * 0.42, cy + r * 1.1);
    ctx.moveTo(cx - r * 0.7, cy + i * r * 0.42); ctx.lineTo(cx - r * 1.1, cy + i * r * 0.42);
    ctx.moveTo(cx + r * 0.7, cy + i * r * 0.42); ctx.lineTo(cx + r * 1.1, cy + i * r * 0.42);
  }
  ctx.stroke();
}

function house(ctx, cx, cy, r) {
  ctx.fillStyle = '#e9a27f';
  rr(ctx, cx - r * 0.8, cy - r * 0.2, r * 1.6, r * 1.1, r * 0.2);
  ctx.fill();
  ctx.fillStyle = '#b8735f';
  roundedTri(ctx, cx, cy - r * 1.0, r * 0.95, r * 0.8);
  ctx.fillStyle = 'rgba(120,90,80,0.5)';
  ctx.beginPath(); ctx.arc(cx, cy + r * 0.35, r * 0.24, 0, Math.PI * 2); ctx.fill();
}

function coin(ctx, cx, cy, r) {
  ctx.fillStyle = '#e8b45c';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#c9913d';
  ctx.lineWidth = Math.max(1.2, r * 0.16);
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#c9913d';
  ctx.font = `700 ${r * 1.1}px ui-rounded, system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('$', cx, cy + r * 0.05);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

function trend(ctx, cx, cy, r, down) {
  ctx.strokeStyle = down ? '#c8646c' : '#57a773';
  ctx.lineWidth = Math.max(1.6, r * 0.24);
  ctx.lineJoin = 'round';
  const pts = down
    ? [[-1, -0.55], [-0.25, 0.15], [0.35, -0.2], [1, 0.6]]
    : [[-1, 0.6], [-0.25, -0.2], [0.35, 0.15], [1, -0.55]];
  ctx.beginPath();
  pts.forEach(([px, py], i) => i
    ? ctx.lineTo(cx + px * r, cy + py * r)
    : ctx.moveTo(cx + px * r, cy + py * r));
  ctx.stroke();
  const [ax, ay] = pts[pts.length - 1];
  ctx.beginPath();
  ctx.moveTo(cx + ax * r, cy + ay * r);
  ctx.lineTo(cx + (ax - 0.4) * r, cy + ay * r - (down ? -0.2 : 0.2) * r);
  ctx.moveTo(cx + ax * r, cy + ay * r);
  ctx.lineTo(cx + ax * r - 0.34 * r, cy + (ay + (down ? -0.34 : 0.34)) * r);
  ctx.stroke();
  ctx.lineJoin = 'miter';
}

// Glyph table. Each draws centred at the origin inside a box of side s.
const GLYPHS = {
  // weather
  'weather:clear': (c, s) => sun(c, 0, 0, s * 0.22),
  'weather:cloudy': (c, s) => { sun(c, -s * 0.16, -s * 0.18, s * 0.13, false); cloud(c, s * 0.06, s * 0.06, s * 0.22); },
  'weather:overcast': (c, s) => { cloud(c, -s * 0.1, -s * 0.12, s * 0.19); cloud(c, s * 0.12, s * 0.1, s * 0.16); },
  'weather:windy': (c, s) => gust(c, 0, 0, s * 0.28),
  'weather:calm': (c, s) => leaf(c, 0, 0, s * 0.28),
  'weather:rain': (c, s) => { cloud(c, 0, -s * 0.2, s * 0.2); drops(c, 0, -s * 0.2, s * 0.24); },
  'weather:storm': (c, s) => { cloud(c, 0, -s * 0.22, s * 0.2); bolt(c, s * 0.04, s * 0.2, s * 0.22); },
  'weather:snow': (c, s) => { cloud(c, 0, -s * 0.24, s * 0.19); flake(c, -s * 0.24, s * 0.22, s * 0.12); flake(c, s * 0.22, s * 0.2, s * 0.14); },
  'weather:heat': (c, s) => { sun(c, 0, -s * 0.16, s * 0.18, false); heatWaves(c, 0, -s * 0.16, s * 0.26); },
  'weather:frost': (c, s) => { flake(c, 0, -s * 0.05, s * 0.28); flake(c, -s * 0.3, s * 0.26, s * 0.11); },

  // hazards
  'hazard:storm': (c, s) => { cloud(c, 0, -s * 0.24, s * 0.21); bolt(c, 0, s * 0.2, s * 0.24); },
  'hazard:ice': (c, s) => { flake(c, -s * 0.18, -s * 0.18, s * 0.2); flake(c, s * 0.22, s * 0.2, s * 0.22); },
  'hazard:heatwave': (c, s) => { sun(c, 0, -s * 0.2, s * 0.2, false); heatWaves(c, 0, -s * 0.2, s * 0.3); },
  'hazard:drought': (c, s) => {
    sun(c, 0, -s * 0.26, s * 0.15, false);
    c.strokeStyle = '#c19a5b';
    c.lineWidth = Math.max(1.3, s * 0.06);
    c.beginPath(); c.moveTo(-s * 0.3, s * 0.06); c.lineTo(-s * 0.06, s * 0.24); c.lineTo(-s * 0.22, s * 0.32); c.stroke();
    c.beginPath(); c.moveTo(s * 0.08, s * 0.0); c.lineTo(s * 0.28, s * 0.2); c.lineTo(s * 0.04, s * 0.32); c.stroke();
  },
  'hazard:quake': (c, s) => crack(c, 0, 0, s * 0.3),
  'hazard:linefault': (c, s) => {
    c.strokeStyle = '#8d97a8'; c.lineWidth = Math.max(1.2, s * 0.06);
    c.beginPath(); c.moveTo(-s * 0.36, -s * 0.3); c.lineTo(s * 0.36, -s * 0.3); c.stroke();
    bolt(c, 0, s * 0.1, s * 0.26);
  },
  'hazard:plantfire': (c, s) => fire(c, 0, 0, s * 0.3),
  'hazard:coldsnap': (c, s) => { flake(c, 0, -s * 0.16, s * 0.24); gust(c, 0, s * 0.26, s * 0.22); },

  // upgrades
  'upgrade:link': (c, s) => linkGlyph(c, 0, 0, s * 0.3),
  'upgrade:forecast': (c, s) => dish(c, 0, s * 0.04, s * 0.28),
  'upgrade:smart': (c, s) => chipGlyph(c, 0, 0, s * 0.28),
  'upgrade:crew': (c, s) => wrench(c, 0, 0, s * 0.3),

  'mark:wrench': (c, s) => wrench(c, 0, 0, s * 0.32),
  'mark:town': (c, s) => house(c, 0, 0, s * 0.3),
  'mark:bolt': (c, s) => bolt(c, 0, 0, s * 0.34),
  'mark:money': (c, s) => coin(c, 0, 0, s * 0.32),
  'mark:down': (c, s) => trend(c, 0, 0, s * 0.3, true),
  'mark:up': (c, s) => trend(c, 0, 0, s * 0.3, false),
};

// Plant specs reuse the map art, so a palette card shows exactly the shape that
// will land on the tile.
function plantGlyph(ctx, id, s) {
  if (!PLANTS[id]) return false;
  ctx.save();
  ctx.translate(s / 2, s / 2);
  drawPlantIcon(ctx, id, -s / 2, -s / 2, s, 1, null, null, null);
  ctx.restore();
  return true;
}

/**
 * Draw `spec` ("plant:solar", "weather:storm", "hazard:quake", "upgrade:link",
 * "mark:wrench") filling a box of side s at the current transform origin.
 * Returns false when the spec is unknown, so callers can substitute something.
 */
export function drawIcon(ctx, spec, s) {
  if (spec.startsWith('plant:')) return plantGlyph(ctx, spec.slice(6), s);
  const fn = GLYPHS[spec];
  if (!fn) return false;
  ctx.save();
  ctx.translate(s / 2, s / 2);
  fn(ctx, s);
  ctx.restore();
  return true;
}

/** A crisp, dpr-scaled canvas element ready to drop into the DOM. */
export function iconCanvas(spec, size = 22) {
  const cv = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(size * dpr);
  cv.height = Math.round(size * dpr);
  cv.style.width = `${size}px`;
  cv.style.height = `${size}px`;
  cv.className = 'iconic';
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!drawIcon(ctx, spec, size)) {
    const fb = document.createElement('span');
    fb.className = 'iconic-missing';
    fb.textContent = '?';
    return fb;
  }
  return cv;
}

/** Fill every <span data-icon="kind:id" data-size="n"> inside root. */
export function paintIcons(root = document) {
  for (const span of root.querySelectorAll('span[data-icon]')) {
    if (span.dataset.painted === '1') continue;
    span.replaceChildren(iconCanvas(span.dataset.icon, Number(span.dataset.size || 22)));
    span.dataset.painted = '1';
  }
}
