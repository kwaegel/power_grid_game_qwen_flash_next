# Gridling

A small, cosy power-grid management game that runs entirely in your browser — no
backend, no build step, no network access needed once the files are served.

You run the electricity grid for a small region. Keep supply matched to demand,
keep the customers happy, keep the bank out of the red, and try to survive as the
years get meaner.

## Run it

One command, from this folder:

```bash
node server.mjs
```

then open <http://localhost:8000>. Pass a port to change it: `node server.mjs 1234`. If
the port is already taken, the server says so and tells you to pick another.

Any other static file server works too (the game is plain ES modules — `index.html`,
`styles.css`, `src/`). If you open `index.html` straight from disk with `file://`,
module loading is blocked by browser security, so use a server.

Target: desktop browser with a mouse, Chrome/Edge/Firefox/Safari from the last couple
of years.

## How to play

**Your job:** for every hour of the game, the power you make has to cover the power
the towns want. The chart under the map shows both — dashed orange is demand, the
solid blue line is what you actually delivered, and the soft green area behind them is
the capacity you currently have available. Red stubs between blue and orange are
blackouts; the grey dashed line, when it appears, is your tie-line limit.

**Building:** pick a plant in the right-hand panel, then click a tile on the map. The
ghost preview turns green when the site is legal. Click a plant you already own to
start/stop it, change a battery's mode, or sell it.

**You lose when** the customer goodwill bar (top bar) empties, or the bank falls more
than $12k below zero. Your score grows with every MWh delivered while customers are
happy, so a blackout costs you twice.

**The rhythm of a year.** Demand peaks around 18:00 every day, with a smaller morning
bump. Winter is much heavier (heating) and summer has an afternoon air-conditioning
bump. A run starts in spring, so the first winter, about 45 days in, is your first
real exam. Solar makes nothing at night; wind is strongest in autumn and winter and
can go quiet for days during a calm spell; hydro swells in the spring melt and shrinks
in a drought.

**Disasters** appear first as a warning in the outlook strip and a banner across the
top: a windstorm, ice storm, heatwave, drought, earthquake, line fault, plant fire or
cold snap. You get real time to prepare:

- Charge batteries while the warning is up (set them to *Charge*, or just let the
  surplus fill them).
- Bring firm plants (coal, gas, hydro) up early — coal is slow to ramp.
- **Shutting a plant down halves the damage it takes.** Shut your turbines before a
  windstorm; you lose their output but keep the machines.

Upgrades (Upgrade tab) are permanent for the run: a bigger tie-line, a Weather Desk
that lengthens warnings, a Smart Grid that forgives shortfalls, faster Repair Crews.

**Rising difficulty.** Every new year the towns grow ~10%, disasters come more often
and hit harder, and new towns connect to your grid. A run always ends; the trick is to
out-build the growth curve for as long as you can.

Keyboard (optional): `Space` pause, `1`/`2`/`3` speed, `Esc` cancel a build or close a
card, `?` help.

### The plants

| Plant | Cost | Rated | Fuel | Tradeoff |
|---|---|---|---|---|
| Solar Farm | $40 | 12 MW | free | zero at night, weak in winter/storms |
| Wind Turbine | $65 | 10 MW | free | +28% on hills, lulls for days, fragile in storms |
| Run-of-River | $95 | 14 MW | free | dispatchable and free, but only 4 river sites, seasonal |
| Coal Station | $130 | 30 MW | $3.2 | firm all hours, slow ramp, smog caps goodwill, max 3 |
| Gas Peaker | $55 | 12 MW | $7.5 | instant and cheap to build, ruinous fuel bill |
| Nuclear Plant | $320 | 60 MW | $0.5 | enormous and cheap to run, needs cooling water, meltdown risk, max 2 |
| Battery Bank | $70 | 10 MW / 60 MWh | — | buys firmness without fuel, 90% round-trip, max 8 |

There is no single right answer: cheap-free-but-intermittent against firm-but-expensive,
against the capital that any of it takes out of your reserve fund.

**Where things can go.** Grass and field tiles take everything except run-of-river:
solar, wind, coal, gas, nuclear and batteries. Hills take only wind (+28% output) and
gas. Forest takes only batteries. Run-of-river must sit on a river tile, four at most.
Nuclear sits on grass or field but needs a river or lake on an adjacent tile for cooling
water, two at most; coal is capped at three. Lakes, mountains, towns and cracked fault
ground are unbuildable — and next to fault ground, earthquakes do more damage. A palette
card reading `· 2/4` means two built, four allowed.

Every icon in the game — the plant shapes on the map, the palette cards, the
weather and disaster glyphs, the logo — is drawn with canvas code in
`src/icons.js`. No emoji, no font glyphs, no image files, so nothing depends on a
font the machine may not have.

## Saving

The game autosaves into `localStorage` about every 12 seconds of play; the title screen
offers **Continue** after a reload. Behind that title card a fixed-seed **demo world**
ticks over so the first screen shows a working grid — it is labelled `Demo world · …` in
the top bar, it is not yours, it is never saved, and clicking it does nothing until you
start a run. The menu button can also **Save now**, **Export save file**
(writes a `.gridling` JSON file), **Import save file** (a file picker, or paste the
JSON), and show **Best scores**. Best scores live in `localStorage` as a top-10 list.

## Development

No dependencies, no bundler, no build.

```
index.html             markup
styles.css             all styling
server.mjs             tiny static server (the one command above)
src/main.js            loop, input, panels, coach marks
src/icons.js           every icon in the game, drawn as canvas vectors
src/render.js          canvas drawing: terrain, plants, weather, chart
src/storage.js         autosave, best scores, export/import
src/sim/               the simulation (no DOM): engine, plants, hazards, world, rng
tools/sanity.mjs       23 simulation invariant checks
tools/balance.mjs      headless balance harness: node tools/balance.mjs 12
tools/e2e/play.mjs     Chromium play-test driver (needs playwright-core, see tools/e2e)
tools/e2e/glyphcheck.mjs  icon gate: coverage, silhouette confusion, terrain legibility
tools/e2e/bootcheck.mjs   fast boot + console-error check, before the slow play-through
tools/e2e/servecheck.mjs  loads the page from the real server.mjs (the documented command)
tools/e2e/crop.mjs     crop + zoom a screenshot region
tools/e2e/spritesheet.mjs  contact sheet: every plant on every legal terrain, all glyphs
tools/e2e/vision.py    screenshot review against a vision model endpoint
```

```bash
node tools/sanity.mjs                       # physics, seasons, save determinism
node tools/balance.mjs 12                   # scripted players on 12 seeds
cd tools/e2e && npm install && node play.mjs   # drive the real game in a real browser
cd tools/e2e && node bootcheck.mjs          # ~6 s: does it boot clean?
node server.mjs 8123 & node tools/e2e/servecheck.mjs 8123   # the shipped command, served
cd tools/e2e && node glyphcheck.mjs         # 35 icons paint; none confusable; legible on terrain
```

`tools/sanity.mjs` asserts the rules the design rests on, in about a second and with no
browser. `tools/balance.mjs` runs scripted players (idle / greedy / steady / careful)
against identical seeds and reports how long each survives — that is how the difficulty
curve was tuned. `tools/e2e/play.mjs` clicks the real UI in real Chromium, watches the
console, and checks layout at two window sizes; screenshots and a `results.json` from
each run land in `tools/e2e/shots/` (git-ignored). `playwright-core` is the only
dependency anywhere, it lives only under `tools/e2e/`, and the game itself has none.
