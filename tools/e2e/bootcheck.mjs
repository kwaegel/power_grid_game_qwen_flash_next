// Throwaway: fast boot + console-error check before the slow play-through.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/ky/dev/power_grid_game_qwen_flash_next';
const PORT = 8777;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const srv = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => srv.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e));
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForTimeout(600);
await page.click('[data-a="new"]');
await page.waitForTimeout(1200);
for (let i = 0; i < 8 && await page.isVisible('#coach .dismiss'); i++) {
  await (await page.$('#coach .dismiss')).click();
  await page.waitForTimeout(100);
}
await page.waitForTimeout(1500);

const out = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('span[data-icon]')];
  const missing = spans.filter((s) => s.querySelector('.iconic-missing')).map((s) => s.dataset.icon);
  const c = document.getElementById('map');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const buckets = new Set();
  for (let i = 0; i < d.length; i += 160) buckets.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
  const toasts = document.getElementById('toasts').getBoundingClientRect();
  const chart = document.getElementById('chart').getBoundingClientRect();
  return {
    tick: window.__gridling.state().tick,
    geo: window.__gridling.ui.geo,
    iconSlots: spans.length, missing,
    mapCanvas: { w: c.width, h: c.height }, distinct: buckets.size,
    supply: document.getElementById('v-supply').textContent,
    toasts, chart,
    panelBottom: document.getElementById('panel').getBoundingClientRect().bottom,
    vh: innerHeight,
  };
});
console.log(JSON.stringify(out, null, 1));
console.log('console errors:', errs.length ? errs : 'none');
await page.screenshot({ path: path.join(ROOT, 'tmp/bootcheck.png') });
await browser.close();
srv.close();
process.exit(errs.length ? 1 : 0);
