// Crop + zoom a region of a screenshot so small text becomes legible to the vision
// review endpoint. Crops are guesses about where a reported defect lives, so they get
// looked at rather than inferred.
//
//   node tools/e2e/crop.mjs <image.png> <out.png> <x> <y> <w> <h> [scale]

import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

const [img, out, x, y, w, h, scaleArg] = process.argv.slice(2);
const scale = Number(scaleArg || 2);
const nums = [x, y, w, h, scale].map(Number);
if (nums.some((v) => !Number.isFinite(v))) {
  console.error('usage: crop.mjs <image> <out> <x> <y> <w> <h> [scale]');
  process.exit(1);
}
const [cx, cy, cw, ch, cs] = nums;
const abs = path.resolve(img);
const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/local/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.goto('about:blank');
const dataUrl = 'data:image/png;base64,' + fs.readFileSync(abs).toString('base64');
const size = await page.evaluate(async ({ dataUrl, x, y, w, h, scale }) => {
  const im = new Image();
  await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = dataUrl; });
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;          // nearest neighbour: keep glyph edges crisp
  g.drawImage(im, x, y, w, h, 0, 0, c.width, c.height);
  window.__crop = c.toDataURL('image/png');
  return { src: `${im.width}x${im.height}`, out: `${c.width}x${c.height}` };
}, { dataUrl, x: +x, y: +y, w: +w, h: +h, scale });
const b64 = (await page.evaluate('window.__crop')).split(',')[1];
fs.writeFileSync(out, Buffer.from(b64, 'base64'));
console.log(`${img} (${size.src}) -> ${out} (${size.out}) crop ${x},${y} ${w}x${h} x${scale}`);
await browser.close();
