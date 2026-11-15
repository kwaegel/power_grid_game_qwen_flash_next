// Throwaway: load the page from the *documented* server (`node server.mjs <port>`)
// rather than the inline server the play-test driver starts, so the command in the
// README is the thing actually exercised. Delete once run.
import { chromium } from 'playwright-core';

const PORT = +(process.argv[2] || 8123);
const browser = await chromium.launch({ executablePath: '/usr/local/bin/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
for (const p of ['/', '/styles.css', '/src/sim/engine.js', '/src/icons.js', '/favicon.ico']) {
  const r = await page.request.get(`http://127.0.0.1:${PORT}${p}`);
  console.log(`${p.padEnd(22)} ${r.status()}`);
}
for (const p of ['/%2e%2e/etc/passwd', '/../etc/passwd']) {
  const r = await page.request.get(`http://127.0.0.1:${PORT}${p}`, { maxRedirects: 0 });
  console.log(`${p.padEnd(22)} ${r.status()}`);
}
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const c = document.getElementById('map');
  const g = window.__gridling;
  return {
    canvas: c ? `${c.width}x${c.height}` : 'none',
    ts: g ? Math.round(g.ui.geo.ts) : null,
    boot: !!g,
    cashLabel: document.querySelector('#stat-money .k')?.textContent.trim(),
    cashValue: document.getElementById('v-money')?.textContent,
    title: document.querySelector('#titlecard h1')?.textContent.trim(),
  };
});
console.log(info);
await page.screenshot({ path: 'shots/from-server.png' });
console.log(errs.length ? `ERRORS ${errs.length}\n${errs.join('\n')}` : 'no page or console errors');
await browser.close();
