# NOTES — design decisions, testing, known problems

Companion to `README.md`. This records **why** the game is shaped the way it is, what
was actually tested and how, what is known to be wrong or unverified, and what I would
do next.

---

## 1. Design decisions and the reasoning behind them

### 1.1 Clock and world shape

| Choice | Value | Why |
|---|---|---|
| One tick | one in-game hour | Dispatch, ramping and battery physics are hourly in real grids; hourly is also fine-grained enough that a disaster's effect is visible as it unfolds. |
| One day | **24 hours** (`HOURS_PER_DAY = 24`) | It used to be 20, on the theory that a full 24 hours makes the overnight stretch feel like filler. That was wrong, and the review round is what found it: a 20-hour clock runs 19:00 straight into 00:00, so the evening decline (20:00–23:00) never exists and demand *teleports* — in winter 1.59 → 0.58 in a single tick, a 64% fall against the largest legitimate hour-to-hour move of 34%. It appeared on the chart as a sawtooth at every day line, and it made the last hour of each day the hardest and the first hour free. 24 hours removes the discontinuity with no new maths, lets the clock show real times (20:00–23:00 exist now), and gives batteries a proper overnight trough to refill in. |
| One month | 5 days | Seasonal change has to be *felt* in a sitting. Twelve months of 30 days would put the first winter ~9 months away. |
| One year | 60 days | Long enough for one full seasonal cycle to be learnable, short enough that "rising difficulty" arrives several times in a good run. |
| Year 1 opens in **spring** (`YEAR_START_MONTH = 2`) | | This was a balance fix, not cosmetics. Opening in winter killed *every* scripted player within 2–4 days, including the careful one: the player has no money and no information yet, so a heating peak on day 1 is not a decision, it's a coin flip. Opening in spring gives ~45 calm days to learn the panel and earn capital before the first real exam. |

A run at 1× speed (2 ticks/s) is about 12 real seconds per game day, so year one lasts
roughly 12 minutes; the difficulty ramp (below) means the interesting part of a run is
year 2+.

Changing the day length is not a cosmetic edit and it is not free: fixed plant O&M is
charged per hour, so a day now costs 20% more of it while revenue only tracks delivered
MWh (the demand *integral* rose 4–7%). That is a real ~6% tightening of the economy, which
is why the balance medians in 2.2 moved when the clock changed, and why `SAVE_VERSION` went
to 6 — a tick from a version-5 save would resume onto the wrong clock, so old saves are
refused with a message rather than silently mis-timed.

### 1.2 Money is in thousands (k$)

Every capex figure, the bank balance and the overdraft are stored in k$: `START_MONEY = 70`
is $70 000, a coal station is 130, bankruptcy is at −12. Per-MWh rates (`TARIFF = 12`,
fuel 0.5–7.5) are kept in real dollars and divided by 1000 when applied, so the plant
table reads like real-world prices instead of a column of six-digit numbers.

This was forced by a genuine bug, not style. The first version charged each plant a flat
per-hour operating cost in raw dollars. Against raw-dollar revenue that opex was about
ten times revenue, so *every* scripted policy went bankrupt on day 3 while delivering
plenty of power. Fixing the units (rather than shrinking the constants) is what makes
the tradeoff between cheap-capital/high-fuel and free-fuel/expensive-capital real.

The top bar is labelled **Cash (k$)** so the player is never asked to infer the scale.

### 1.3 The tie-line is the abstracted transmission system

There is no wire-drawing. All power flows to all towns through one capacity number:
`80 + 50 × level` MW (the **Grid Link** upgrade, 5 levels). Disasters can apply a
multiplier to it (a line fault directly, an earthquake indirectly).

Reason: a real routing problem on a 16×9 grid would dominate the design and mostly
reduce to "place a node in the middle". Collapsing transmission to one number keeps one
interesting decision — "my fleet can make 140 MW but the region can only take 80, so the
constraint is the wire, not the generators" — at the cost of not modelling congestion
between regions. That is a deliberate trade and the reason the tie-line gets its own
stat in the top bar and its own upgrade line, so the constraint is legible instead of
hidden.

### 1.4 No plant is the right answer

Deliberate pressure points, all present in `src/sim/plants.js`:

- **Solar** is the cheapest MW in the game and free to run, and makes literally nothing
  at the 18:00 peak — it is an *energy* plant, never a *capacity* plant.
- **Wind** is free, gets +28 % on hills, and can go quiet for days in a calm spell.
  It is the classic blackout cause, and the game tells you so.
- **Hydro** is the only *free and dispatchable* plant, and there are exactly four river
  sites on the map (`maxCount: 4`) — so it is a land-grab race, and it shrinks in a
  drought.
- **Coal** is firm around the clock at moderate fuel cost, but ramps in ~8 hours
  (`ramp: 0.12`), is capped at 3 units, and each one running lowers the goodwill ceiling
  (`ceiling = 100 − smog × 3`).
- **Gas** is the disaster insurance: instant ramp, cheap to build, ruinous fuel
  ($7.5/MWh against a $12 tariff).
- **Nuclear** is huge and cheap to run, needs cooling water on an **adjacent** tile
  (river or lake in the 8-neighbourhood), is capped at 2, and taking a hit there is a
  meltdown — a single disaster can end the run.
- **Batteries** buy firmness with no fuel, but 90 % round-trip, capped power (10 MW) and
  capped energy (60 MWh) each, max 8. Their capex (70) is deliberately *not* equal to
  `START_MONEY`: an earlier build had them at exactly 70, which produced a deadlock —
  the player could afford nothing that earns, so revenue was zero and the run was
  unwinnable from tick 0. Covered by a test.

Merit order for automatic dispatch is by marginal cost (`FUEL_COST`: hydro 0.05 →
nuclear 0.5 → coal 3.2 → gas 7.5), so the player's job is capacity and storage
decisions, not clicking plants on and off every hour. Manual control is still available
for the interesting cases.

### 1.5 Disasters warn, then strike, and preparation pays off

Eight hazards (windstorm, ice storm, heatwave, drought, earthquake, line fault, plant
fire, cold snap), each with a `warn` phase, an `active` phase and an `advice` string that
is shown in the forecast strip and the log. The **Weather Desk** upgrade multiplies the
warning window (×1.6, ×2.2).

The mitigation mechanic that makes warnings worth reading: **a shut-down plant takes half
the damage roll and half the damage magnitude** (`damageRoll(rng, shielded)` in
`src/sim/engine.js`). So before a windstorm there is a real decision — lose the
turbines' output for a day, or keep it and risk a four-figure repair bill. Without that
lever, warnings are pure theatre. There is an invariant test asserting the shut-down
risk is actually lower.

All hazards are survivable with good play; the balance sweep (2.2) is the evidence.

### 1.6 Difficulty ramp

At each new year (`src/sim/engine.js:630-632`): population ×1.10 compounding, hazard
severity `1 + 0.14 × (year − 1)`, hazard frequency `1 + 0.30 × (year − 1)`, and new towns
connect until there are six. Demand growth is compounding while the player's capital
growth is roughly linear, so a run is a race against an exponential and *must* end —
that is how "a run eventually ends" is guaranteed rather than bolted on. A run ends when
goodwill empties or the bank falls below −12 k$; both paths have tests.

### 1.7 Goodwill (the lose condition) rather than an instant blackout loss

Goodwill drains `over × 2.0` per hour of shortfall (a *total* blackout is fatal in about
three days) and recovers `+0.45`/hour when served, capped by smog. Values of 9/0.35 were
tested first and made any 40 % shortfall fatal within hours — the run ended on one bad
evening rather than on a pattern of bad decisions. The current numbers mean a
mistake costs you a day of recovery, which is recoverable and legible.

The **Smart Grid** upgrade raises the tolerated shortfall (2 % → 7 % → 12 %) and speeds
recovery, so it is a "buy forgiveness" decision against capacity.

### 1.8 Score

`score` grows with MWh delivered × satisfaction, so a blackout costs twice: less energy
counted, and a lower multiplier on what is counted. `deliveredTotal`, peak MW, days
survived and final satisfaction are all stored, so the end screen and the local top-10
list can show *how* you lost, not just a number. Best scores are keyed in `localStorage`
separately from the autosave, so deleting a saved run does not delete records.

### 1.9 Save format

A save is one JSON object of an explicit allow-list (`SAVE_KEYS`) with a `SAVE_VERSION`
number; `deserialize` throws `Incompatible save` rather than half-loading a mismatched
file. The RNG state is part of it (mulberry32 with an explicit counter), and the engine
is a pure state machine with no `Date.now()`/`Math.random()` inside it. That is load
bearing: it makes save/resume exact (tested by replaying a reloaded run and comparing
serialised states) and it lets the headless balance harness run thousands of years in
seconds. Export wraps the same object in `{app:'gridling', kind:'save', data}` and
import accepts either that wrapper or a bare save, from a file picker or pasted text.

### 1.10 Learnability

Coach marks (five dismissible steps, first run only, each anchored to the widget it
explains), a plant card that states the catch in plain language ("Needs a few hours to
climb to full power"), a red reason string when a build is refused, a ghost tile that
turns green/red before you click, and the forecast strip as a permanent "what's coming"
affordance. The help modal lists all
seven plants. Everything on screen is generated in code: rounded pastel tiles, vector
plant art, weather particles, a day/night wash, and the supply/demand chart. No art
assets, no fonts, no libraries in the game itself.

---

## 2. What was tested, and how

Three layers. Everything below was run against the current committed code.

### 2.1 Simulation invariants — `node tools/sanity.mjs`

25 checks, no browser, ~1 s. These assert the rules the design rests on, so a tuning
change that breaks a rule fails here rather than in someone's run:

start-of-run state (spring, supply already meeting demand, no day-one blackout) ·
delivered energy never exceeds demand or the tie-line and never goes negative ·
batteries stay inside power *and* energy limits, and charging is provably lossy ·
solar is exactly zero before 06:00 and after 19:00 and reduced by storms, and a plant
really sees the weather it is standing in · winter peak > 1.25 × spring peak ·
daily peak lands between 15:00 and 20:00 · the same clock hour costs more each year ·
**save round-trip replays to a byte-identical state** after divergent play ·
a save carries map/plants/money/upgrades/RNG · an incompatible save is rejected rather
than half-loaded · shutting a plant down really halves its damage risk · every hazard
has a warning, a duration and advice text · hazards arrive, cause damage and get
repaired · an idle run always ends · running out of money ends the run at the published
overdraft · score and delivered energy only ever grow · year-one demand stays inside
what the opening fleet plus a bit can serve · a careful fleet outlasts doing nothing by
more than 2× · no two towns on a board ever share a name (checked over six full runs) ·
**demand never falls off a cliff at the day boundary** (the largest hour-to-hour move in
any season must stay under 45%, checked across three seasons, and the clock must really be
24 hours with midnight following 23:00) · **a hazard can only strike in a season its own
data allows** (3000 draws sampled per month, asserting every offered hazard is legal that
month, that the ungated ones are always reachable, that Heatwave is reachable in summer and
unreachable in spring, and that Cold Snap is reachable in winter).

plus: the **plant table printed in the README is parsed and checked against the
simulation** — cost, rated MW, storage MWh and fuel price for all seven plants. That
table had already drifted once, and it is the only place a player reads numbers before
spending money, so it is now a contract rather than prose. Verified in both directions:
passing on the real README, and failing with `README prices Nuclear Plant at $999,
engine says $320` when the price was deliberately falsified.

Three of these caught real bugs, all worth keeping in mind:

- the solar test failed because `daylight()` hit exactly 0 at `hour === 6`;
- the bankruptcy test initially passed for the wrong reason (with no plants there are no
  costs, so money cannot drain — it was rewritten to drain through a plant's fixed O&M);
- the day-boundary and hazard-season tests were written *after* the defects they now pin,
  and both were confirmed load-bearing by putting the bug back: reverting the clock to 20
  hours makes the seam test report `day 1: 19:00 -> 0:00 moves 103%` (its own ratio-over-
  the-smaller-hour scale, through the real engine with populations and weather), and before
  the season fix the same sampling found Heatwave offered only in Sprout and Ice Storm in
  Bloom.

### 2.2 Balance sweep — `node tools/balance.mjs 12`

Four scripted policies, identical seeds, headless. Latest run (12 seeds each), days
survived:

| policy | min | median | max |
|---|---|---|---|
| idle (build nothing) | 49 | 85 | 103 |
| greedy (cheapest plant first, no storage, no upgrades) | 56 | 111 | 116 |
| steady (build on a fixed cadence, some storage) | 179 | 238 | 294 |
| careful (hazards watched, batteries charged on warning, turbines shut before windstorms, upgrades bought) | 296 | 358 | 414 |

(These are exactly what `node tools/balance.mjs 12` prints in its summary lines, so a
reader can reproduce them.) At 60 days/year that is ≈6.0 years for careful play and
≈4.0 for steady — a careful player lasts well past the opening minutes, while idle and
greedy both die, the idle one usually at the first winter. Every policy ends; one
careful seed ended `Bankrupt` rather than `Customers revolted`, so both lose paths fire
in normal play. None went invincible. The harness also replays a serialised run and
reports `save round-trip replay identical: true`.

The spread in the min/max columns is real, not noise: after the clock and season fixes the
careful minimum (296 days) is a `Bankrupt` end in year 5 — satisfaction 43, cash −13, 48
plants — i.e. the same build-rate race, lost on capital rather than on a blackout, while
the best seed reaches 414 days. So the outcome is decided by how the money and the hazard
sequence compound, not by one unlucky first winter.
The opening grace is a separate, older fix and it is still there: `hazardCooldown` is
`TICKS_PER_DAY * 10`, so the first hazard cannot warn before day 10 however long a day is
(it used to be a bare 30 ticks, which under the 20-hour clock meant a plant fire could
warn on **day 3** and destroy the starter coal station in a run that had done nothing
wrong). Measured now, across 30 seeds, the first warning lands between day 10 and day 28,
median 12.4.

Caveat: these are scripted bots, not humans. They bound the difficulty from below (a
bot that reacts optimally to warnings survived 6.0 years), so a human having read the
README should land somewhere in the 3–6 year band. I have no human play-test data.

### 2.3 Browser play-test — `cd tools/e2e && node play.mjs`

Real Chromium (Chrome for Testing 149 via `playwright-core`), driving the real
`index.html` with `page.mouse.click` and real key presses — **77/77 checks pass** on the
current code (~170–205 s per run). What it actually does:

- Loads the page, asserts the stylesheet is applied and no page/console errors occur.
- Asserts the **first screen is not blank**: the map is drawn behind the title card
  (164–214 distinct colour buckets), and the chart, outlook strip and plant list are all
  visible, sized and non-empty; the backdrop is labelled `Demo world · …` and is
  asserted **never to write a save** (`localStorage` stays empty at that point).
- Starts a run, asserts the coach marks appear and can be dismissed.
- Asserts the real-time loop advances on its own (~2 ticks/s at 1×) and the canvas is
  sized to the layout (16 columns at 67 px, map 1072 px wide).
- **Builds by clicking** exactly as a player does: palette card, then map tile — hydro on
  a river, solar, wind, battery. Then asserts the fleet grew.
- Refusal paths: unaffordable plants are dimmed in the panel; a build with no money is
  refused with the price in a toast; building on a town is refused with an explanation.
- Clicking an owned plant opens its detail card, the card stays inside the side panel,
  it can shut the plant down, a battery can be forced to *Charge*, `Escape` closes the
  card, and selling a plant removes it and pays salvage.
- Keyboard: `Space` pauses (tick frozen), a number key resumes.
- Plays a long careful run to the **two-year gate** — the gate is expressed in the engine's
  own year length (`st2.tick > YEAR * 2`), not a hardcoded tick count, so it still means
  two years after the clock changed. Recent runs reached 120–159 in-game days into year 3
  with 8–31 mouse-driven builds and 2+ upgrades bought through the panel; it also checks all
  four seasons occurred, that ≥2 disasters struck after warning, that damage happened and
  crews repaired it, that all six towns eventually connected **each under a different
  name**, and that goodwill stayed above 55 (observed 100). Each run uses a random seed, so
  the exact figures vary; the assertions are floors.
- Layout: at 1440×900 and at 1120×720, nothing runs off screen, nothing collapses, cells
  are ≥26 px on both axes, the map is ≥34 % of the viewport height, the outlook strip
  stays inside its bar, and no visible element has `scrollWidth > clientWidth` (text
  overflow). Canvas pixel sampling shows 164 distinct buckets at the title screen and
  198–214 mid-run — the map is drawing varied content, not a blank rectangle.
- The glanceable readouts themselves: the supply bar's text and width both equal
  `round(served/demand)`; the weather stat is a *drawn* glyph plus a word, not a text
  glyph; the outlook strip paints a glyph **and** a weather word for each day ahead and
  stays inside its bar; the top bar reads `Cash (k$)` and the number under it equals
  `state.money` in thousands — asserted never to be abbreviated to "m"; and the chart's
  y-axis is fitted to the demand the player must meet, not to spare capacity (see 3).
- The hazard alarm banner is **forced on** for one probe (`g.hazard = { id:'storm',
  phase:'warn' }` held for two frames, then restored) and asserted to be visible, styled
  `warn`, to paint a glyph with real ink (106 opaque pixels), and to lead with a
  capitalised hazard name plus a warn-phase countdown. It used to be guarded by "is a
  hazard up at this instant?", so the check ran in some runs and not others and the suite
  total wobbled between 73 and 74 — harness nondeterminism, not a product one, but
  exactly the kind that hides a real regression. The text assertion is structural, not
  word-pinned: hazard id `storm` is *displayed* as "Windstorm", so matching the id would
  have been a bug in the test.
- Save/reload/continue: **the periodic autosave is asserted to fire by itself** (a run
  plays for 14 s and the slot refills without any Save press), then saving, reloading,
  **Continue**, and the resumed run has the same plants/score and continues from the same
  tick, and the loaded save keeps simulating.
- Export/import: a real download lands (`gridling-year3.gridling`, 20–23 KB), the file
  parses as a Gridling save, **Delete saved run** clears the slot (title then offers only
  *New run* / *How to play*), a fresh run really is fresh, importing the file restores the
  exported run, and pasting the JSON works too.
- A deliberately careless run loses (random seed each run; recent runs ended at 43, 65,
  72, 86 and 90 days, which matches the headless idle band), the game-over screen shows a
  score that matches the run state, the best-score table is written, and reloading a
  finished save reports *game over* rather than resuming a live run.
- **Determinism, end to end.** The driver takes the careless run's seed out of the
  best-score table and replays it straight through the engine inside the same page, then
  asserts the same length and the same death. Latest run: seed `2473194606` → browser
  `86 days, Customers revolted`, replay `86 days, Customers revolted`. The simulation is
  the same deterministic machine whether a mouse or a script drives it, which is what
  makes the headless balance harness trustworthy at all.
- Zero page errors and zero console errors across the whole session. One console
  *warning* is emitted by the driver's own `getImageData` probes, not by the game.

Screenshots are written to `tools/e2e/shots/` (git-ignored) together with
`results.json`, so a run can be re-inspected.

### 2.4 The documented command

Verified through `tools/e2e/servecheck.mjs <port>`, which loads the page from the
**real `server.mjs`** rather than the inline server the play-test driver starts, so the
command in the README is the thing actually exercised. Against `node server.mjs` with no
arguments: `/`, `/styles.css`, `/src/sim/engine.js` and `/src/icons.js` return 200;
`/../etc/passwd` and its percent-encoded form return 404; the page boots with **no page
or console errors**, canvas 1072×531, cells 67 px, the demo world drawn, the top bar
reading `Cash (k$)` over `$582`. (`/favicon.ico` is 404 — there is no favicon link in
`index.html`, only the inline SVG icon used by the UI; the browser's automatic request is
harmless and produces no console error.)

One real defect surfaced here that no in-app test could see: with the documented port
busy, `node server.mjs` died with an unhandled `EADDRINUSE` stack trace. Since the whole
game is one command, `server.mjs` now catches `EADDRINUSE` and `EACCES` and prints the
fix (`node server.mjs 1234`), exit code 1. Verified by running it against a busy port.

---

## 3. Looking at the game: what was actually possible

Preflight check 7 recorded that **direct image viewing was not available**: the
screenshot was written and recognised as a valid PNG, but the vision role said it did not
accept image input. That was true at the time, and it shaped the whole first pass of
verification, which was programmatic:

- canvas pixel sampling → colour distribution is rich and the canvas is not blank;
- computed styles and DOM geometry → the stylesheet applied, the layout is a
  `display:grid` main area, panel/canvas/chart boxes sit inside the viewport at two
  window sizes, cells are large enough to read;
- overflow detection → no visible element's content exceeds its box;
- console and page-error listeners throughout;
- `tools/e2e/glyphcheck.mjs` → every icon spec paints real opaque pixels rather than the
  `?` placeholder or an empty span.

**Later in the build that limit lifted.** `read <screenshot>.png?q=…` started returning
genuine descriptions, and `tools/e2e/vision.py` (the same model, asked directly over the
endpoint's `image_url` support) does the same from the command line. So screenshots
*were* reviewed, and looking found things no amount of pixel sampling would have:

| found by looking | symptom | fix |
|---|---|---|
| truncated town name | `Pebble…` at the map edge read as a rendering bug | labels are never abbreviated now; a smaller font size is the fallback instead (`drawTownLabels`, `src/render.js`) |
| two labels colliding | the 18:00 peak marker printed over the next day's pill, leaving a stray `0` on the axis | the peak is marked on the demand curve itself, and axis pills refuse to overlap (`pillText` takes a `taken` list) |
| duplicate town label | two tiles both said `Fernbrook` | `NEW_TOWN_NAMES` in `world.js`; joins skip names already on the map, covered by an invariant |
| four empty boxes on the first screen | map, chart, outlook and plant list all blank behind the title card | a demo world ticks behind the title card (`startPreview`, `src/main.js`), labelled `Demo world · …` in the top bar, never saved |
| faint outlook glyphs | pale grey weather glyphs on a pale grey chip | chips carry the weather **word** next to the glyph, and the cloud/flake/drop/gust strokes were darkened |
| alarm before a run existed | the backdrop could raise a hazard banner | the banner is suppressed while `ui.preview` is set |
| money unit contradicted its own label | the stat said `Cash` and the value printed `$4.68m` while everything in the sim is k$ | `money()` no longer switches units; the stat reads `Cash (k$)`, and the driver asserts the number equals `state.money` |
| chart y-axis crushed the demand line | the axis was scaled to available capacity, so a fleet with a lot of surplus (measured: 343 MW available against 26 MW of demand) pushed the axis to ~360 MW and left the demand line in the bottom tenth of the plot | the axis is fitted to demand (`niceStep(peakDemand)`), surplus is clamped flat at the top, and `drawChart` returns `{axisTop, surplusOverTop}` so the driver asserts it on live data — latest run `axisTop 226` for `peakDemand 197` with `peakPotential 387` |
| weather word "Heatwave" on a forecast chip | a 5-day forecast saying "Heatwave" two days out reads as a disaster, not hot weather | the regime is `Hot`; `heatwave` remains a separate disaster with a warning phase |
| speed buttons looked live behind the title card | ▶ was highlighted while the demo world ran on its own clock and pressing a speed did nothing — read as an ambiguous control state | the whole group is `disabled` during the backdrop (the existing `button:disabled` rule dims it) and re-enabled when a run starts; two checks assert the title state and the live state |
| the day-boundary sawtooth on the chart | reported as "a hard vertical drop at each day boundary, possibly a rendering artifact" — it was the **simulation**: a 20-hour day runs 19:00 into 00:00, so the evening decline never existed and demand jumped 1.59 → 0.58 in one tick | `HOURS_PER_DAY` is 24 now; the chart is continuous and the clock shows real hours (see 1.1 and 2.1) |
| a hazard could fire out of season | not visible in a screenshot at all — found by reading `hazardCandidates`, which compared a SEASON index (`h.seasons`) against a MONTH index, so Heatwave was gated on month 2 and struck only in **spring**, never in a summer | the filter converts with `seasonOf(month)`, `coldsnap.seasons` is normalised to season indices, and an invariant samples 3000 draws per month and asserts each hazard is legal in the season it appears in |
| the evening peak marker was cut off | reported as "orange triangles at the highest spikes touch the top border of the graph" | real, and worse than it looked: the marker is 13 px tall and the axis fit left only 8.3 px of plot above the tallest peak at the narrow layout, so the marker for the most important peak was cropped outright. The axis factor is now derived from the plot height (min 1.15, capped 1.3) and the apex clamps to the plot top; `drawChart` returns `{plotTop, markerApex}` so the driver asserts it instead of trusting the eye |

Three of those rows are not "looked, saw, fixed" cases, and the marker row is the clearest
argument for asserting geometry instead of reading screenshots: the symptom was visible but
the magnitude was not — nothing in the picture says "that triangle is 4.7 px too tall", the
number does. The sawtooth was *seen* but only diagnosed by measuring the curve (a screenshot
cannot tell a rendering artifact from a simulation discontinuity); the out-of-season hazard
was never visible at all and came from reading code while following up on something else; and
the marker clip looked like a mild cosmetic graze when the measurement said outright cropping.
Looking finds symptoms — it does not, on its own, size them or name their causes.

The map also stopped floating: cells are stretched to fill the card (`layout()` returns a
non-square `ts`/`ch`), so there is no bare band beside the grid that reads as clipped land.
Plant and town art stays square inside its cell (`cellBox`).

Two other reports from the same review round did **not** reproduce, and were checked rather
than assumed:

- *"the leading icon on the hint bar is cut off by the pill's rounded left border"* — the
  toast pill, its icon and the reserved strip were measured in the page: strip 30 px with
  `overflow:hidden`, toast 28 px, icon 18×18 px sitting at x=24 against a pill edge at x=10,
  and the label's `scrollWidth` equal to its visible width. Icon inside the pill, toast
  inside the strip, text not truncated. What the eye read as a clipped icon is the 4 px
  accent border on the pill's left sitting close to the glyph.
- *"town label pills sit on top of river and house tiles"* — checked per town against the
  same screenshot: every pill lands on open ground, with the residential cluster drawn
  adjacent rather than underneath. `drawTownLabels` already tests candidate boxes against
  town and plant tiles before placing, so this was working as designed.

### 3.1 A second pass over the art, and where the metric overruled the eye

After the above fixes the art was re-reviewed against a purpose-built contact sheet
(`tools/e2e/spritesheet.mjs`): every plant on every terrain it may legally occupy, at the
real 64 px tile size, plus all 18 weather and disaster chips — the only way to see the
icons side by side instead of scattered through the UI.

`glyphcheck.mjs` grew two gates alongside coverage, because "each icon paints pixels" says
nothing about icons being *distinguishable*:

- **confusion** — silhouette IoU > 0.8 **and** colour gap < 90 for glyphs the player reads
  side by side (forecast chips together; the seven build-palette icons together). 12 pairs
  compared: the closest silhouette is `solar vs battery` at shape 0.841 but colour gap 261,
  and the closest colours are `cloudy vs overcast` at gap 31 but shape 0.735 — a deliberate
  cloud family that the shape half of the rule correctly lets through.
- **legibility** — each plant against each terrain it can stand on: the glyph must repaint
  at least 8 % of the tile. 16 combinations, worst `plant:hydro on river` 0.213,
  `battery on forest` 0.242.

What that round changed, and what it did not:

- **Acted on (all three reproduced by hand, not just by the model):** the nuclear glyph sat
  on grey mountain tiles like the mountains themselves; wind read as a white stick; the
  battery was green on forest. Nuclear gained a containment dome plus two prongs, wind
  gained a tilted three-blade rotor on a tapered mast, battery became a slate casing with a
  charge band.
- **Acted on, second attempt needed:** hydro. First it was a thin arc-and-spokes outline
  that read as an empty tile; the first fix (a pale grey wedge) still read as "a faint
  placeholder". It is now a dam wall spanning the whole tile with a white spillway and a
  dark intake ring, and the review calls it a dam. Two rounds of the same complaint were
  the signal that the outline approach was wrong, not the rendering.
- **Rejected on measurement:** the reviewer called `Deep Frost` and `Ice Storm`
  "near-identical and confusable" *after* they had been differentiated; the gate says
  shape 0.322 and colour gap 203 for `snow vs coldsnap` and 0.317/100 for `ice vs snow`.
  Measured directly, coal-vs-gas is `shape=0.709 colourgap=369`: under the 0.8 silhouette
  threshold and four times the colour tolerance, so distinct on both axes. To make sure
  that is the gate working and not the gate being blind, I temporarily replaced the gas
  glyph with a literal copy of coal's: the gate then reports `CONFUSE shape=1.000
  colourgap=0` and exits 1. The icon file was restored from a copy and re-verified clean
  (0 problems, exit 0). So those reviewer flags are plausibility judgements about small
  marks, not measurements of these glyphs, and the chips carry their word in-game anyway —
  so no further art change, and the disagreement is recorded here rather than dropped.
- **Reverted for the same reason:** I added a hatched strip along the top of the chart to
  say "capacity continues above the scale". The review read it as shortage markers — wrong
  signal, invented ornament. Gone; the legend prints the exact available MW and the area
  simply flattens at the top. A `↑` on the legend number was also considered and dropped:
  every glyph in this game is drawn in code, and a Unicode arrow would be a font glyph.

The honest summary: **one model's reading of a screenshot, not a human's eye.** It caught
label collisions, blank panels, a squashed chart and an unreadable dam — all real, all
reproducible. It also flagged pairs my own gate measures as far apart. Whether the game
reads as "cute and cosy" is a judgement I cannot close, and there is no human play-test.
Screenshots from the latest run are in `tools/e2e/shots/` for a person to look at.


One failure mode from the programmatic-only phase is worth keeping: the stylesheet
`<link>` was silently clobbered when a favicon link was inserted next to it. The game
still *worked* — DOM logic, canvas drawing, saves, all fine — and only pixel sampling
plus a computed-style check caught that the canvas was 300×150 and nothing was styled.
A "no errors in console" check alone would have passed it.

---

## 4. Decisions taken where the brief was ambiguous

Recorded per the instruction to decide and write it down rather than ask.

1. **Real time, not turn-based.** The brief left it open; real time makes hazards feel
   like hazards and lets the coach marks teach by doing. Speed control (1×/2×/4× + pause)
   gives the thoughtful player the pacing of a turn-based game anyway.
2. **Map = 16×9 tiles with terrain, not an abstract list.** Terrain gives the plants a
   reason to be placed (rivers for hydro, hills for wind, water for nuclear), which turns
   building into spatial reasoning. Transmission stayed abstract (1.3).
3. **Money exists, and running out ends the run.** Not required by the brief; without it
   the plant tradeoffs have no teeth. Overdraft limit −12 k$, shown in help.
4. **Customer goodwill, not a per-town satisfaction model.** Towns have population and
   a mood that feed demand, but one global goodwill bar carries the lose condition;
   per-town service quality would be a second system with little extra decision content.
5. **"Learnable in two minutes" is interpreted as: the first two minutes are safe.** The
   run opens in spring with a pre-built coal+gas fleet already meeting demand, so a new
   player can watch, read the forecast, and lose nothing for the first several minutes.
6. **Seasons are named after a cozy calendar** (Frostbite, Thaw, Sprout, …) rather than
   real months, because a 5-day month is not a real month and pretending otherwise is
   confusing.
7. **Best scores are local only, top 10, no names.** No backend is permitted, so there is
   nothing to submit to. A name entry box would have implied a leaderboard.
8. **Save versioning, not migration.** Old-version saves are rejected with a clear
   message. There is no shipped save that needs migrating; inventing a migration chain
   for an unreleased format is dead weight.
9. **The title screen has a live demo world behind it.** Nothing in the brief asked for
   it; it exists because reviewing the first screenshot showed four empty boxes (map,
   chart, outlook, plant list) behind the title card, which reads as broken. It is a
   fixed-seed decorative run that is never saved, is labelled `Demo world · …` in the top
   bar, cannot be clicked, and restarts after 40 days. The cost is that the top bar shows
   a mid-run state while the card offers "New run" — visible in the screenshots, and a
   deliberate trade against a blank first screen.
10. **Disaster mitigation is played by the bots.** The `careful` policy in
    `tools/balance.mjs` shuts turbines before windstorms and restores them after, so the
    shutdown-halves-damage rule (1.5) is measured end-to-end rather than asserted only by
    its unit test.

---

## 5. Known problems

1. **No human has looked at it.** Screenshots *were* read back by a vision model, which
   caught real defects (section 3), but that is not the same as a person judging whether
   the game reads as cosy and inviting, and it is certainly not play-test feedback on
   feel. The aesthetics remain the biggest unverified area.
2. **Headless Chromium renders at ~60 fps but ticks far faster than a human plays.** The
   driver calls `setTps(8–16)` to get enough simulation in a reasonable wall-clock time,
   which means the *long-run* play-test deliberately runs at a speed no human would use.
   Correctness is verified there, but a purely perceptual question — is the chart legible
   while it scrolls at 4× — is only covered by the static layout checks.
3. **The event log is capped at 80 entries**, so early-run events scroll off. This is
   intentional (unbounded logs would grow without limit across a 7-year run) but it means
   a player cannot retrospectively find when a town joined.
4. **Autosave is time-based (~every 12 s of real time), not action-based.** A crash
   within that window can lose the last few in-game hours. Deliberate: saving every tick
   across a 400-day run is a lot of `localStorage` writes.
5. **One hazard chain at a time.** `game.hazard` is a single slot, so two disasters never
   overlap. This keeps them readable and survivable but caps the possible "everything
   went wrong at once" moment that would test a player hardest.
6. **Nuclear maxCount is 2 but the map may offer fewer legal cooling-water sites** than
   that on unlucky terrain generation. Not a bug — it just means some seeds are slightly
   less generous. Not verified across many seeds.
7. **Untested paths:** mobile/touch (brief says desktop mouse, and it is untested, so no
   claim is made); very small windows (<1120×720) — the layout checks cover 1440×900 and
   1120×720 only; Firefox/Safari (only Chromium was driven); multi-tab interference on
   the autosave slot; screen-reader/accessibility semantics; sound (deliberately absent).
8. **`tools/e2e/node_modules` exists** (project-local `playwright-core` only, as the
   brief permits). It is git-ignored. The game itself has no dependencies at all.

---

## 6. With more time, in rough order of value

1. **Look at it.** A human pass on the visuals and the first-two-minutes onboarding is
   the single highest-value thing missing. Everything else here is secondary to that.
2. **Per-hazard counterplay UI**: a "prepare" affordance that highlights the plants worth
   shutting and the batteries worth charging when a warning is up. The mechanic exists;
   the teaching of it is currently text only.
3. **Regional congestion**: split the tie-line into two or three zones so where you build
   matters, replacing the single capacity number (1.3) with a real siting decision.
4. **Contracts/tariff choices** — a long-run revenue decision to balance against capex,
   which is currently a pure build-rate race against a compounding curve.
5. **Demand response / storage bidding** as an upgrade branch, deepening the storage
   axis now that batteries have a mode control but only three modes.
6. **Concurrency on the save slot** (two tabs both autosaving), and a
   "save game" named-slot list rather than one autosave.
7. **Seed sharing** so a good run can be recreated exactly — the seed is stored, it just
   has no UI to enter one.
8. **More seeds in the balance sweep** and a policy that uses shutdown-as-mitigation, to
   check the disaster economy from the player's side rather than the harness's.
