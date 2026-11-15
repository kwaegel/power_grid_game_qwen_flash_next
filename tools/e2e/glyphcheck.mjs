// Does a glyph actually render, or does it come out as a tofu box?
//
// Screenshot review can only say "the icon looks broken"; it cannot tell whether the
// game asked for a glyph the platform does not have. This measures the difference:
// a real colour emoji paints colour pixels, an unknown codepoint paints the same
// hollow rectangle as \uFFFF. Compare a suspect character against that control.
//
//   node tools/e2e/glyphcheck.mjs                 # the game's own plant/weather glyphs
//   node tools/e2e/glyphcheck.mjs "🔆" "⚡" "☀️"     # or any characters you name

import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/local/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();

// The game's own icon set, when no characters are named on the command line.
const defaults = await (async () => {
  const plants = await import('../../src/sim/plants.js');
  const hazards = await import('../../src/sim/hazards.js');
  return Object.values(plants.PLANTS).map((p) => p.emoji)
    .concat(Object.values(hazards.HAZARDS).map((h) => h.emoji))
    .concat(Object.values(hazards.WEATHER).map((w) => w.emoji));
})();
const chars = process.argv.slice(2).length ? process.argv.slice(2) : defaults;

const rows = await page.evaluate(({ chars }) => {
  const c = document.createElement('canvas');
  c.width = 140; c.height = 90;
  const g = c.getContext('2d');
  const probe = (ch) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 140, 90);
    g.font = '44px system-ui, sans-serif';
    g.textBaseline = 'top'; g.fillStyle = '#000';
    g.fillText(ch, 8, 12);
    const d = g.getImageData(0, 0, 140, 90).data;
    let ink = 0, colour = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [r, gr, bb, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
      if (r < 240 || gr < 240 || bb < 240 || a < 240) ink++;
      if (Math.max(r, gr, bb) - Math.min(r, gr, bb) > 40) colour++;
    }
    return { ink, colour, width: +g.measureText(ch).width.toFixed(1) };
  };
  const control = probe('\uFFFF');          // guaranteed unrenderable: the tofu box
  return chars.map((ch) => {
    const p = probe(ch);
    return {
      ch,
      codepoint: [...ch].map((q) => 'U+' + q.codePointAt(0).toString(16).toUpperCase()).join(' '),
      ...p,
      tofu: p.ink === control.ink && p.colour === 0,
    };
  }).concat([{ ch: '\\uFFFF (control)', codepoint: 'U+FFFF', ...control, tofu: false }]);
}, { chars });

const tofu = rows.filter((r) => r.tofu);
for (const r of rows) {
  console.log(`${r.tofu ? 'TOFU' : ' ok '}  ${r.ch.padEnd(4)} ${r.codepoint.padEnd(12)} ink=${r.ink} colour=${r.colour} w=${r.width}`);
}
console.log(`\n${tofu.length}/${rows.length - 1} named glyphs did not render` +
  (tofu.length ? '  (the platform has no font for them; the game is not drawing a box itself)' : ''));
await browser.close();
process.exit(tofu.length ? 1 : 0);
