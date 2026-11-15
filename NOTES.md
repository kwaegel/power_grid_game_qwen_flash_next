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
| One day | 20 hours (`HOURS_PER_DAY = 20`) | A full 24 hours made the dead overnight stretch feel like filler. 20 keeps a clear night trough for batteries to refill against without the player watching nothing. |
| One month | 5 days | Seasonal change has to be *felt* in a sitting. Twelve months of 30 days would put the first winter ~9 months away. |
| One year | 60 days | Long enough for one full seasonal cycle to be learnable, short enough that "rising difficulty" arrives several times in a good run. |
| Year 1 opens in **spring** (`YEAR_START_MONTH = 2`) | | This was a balance fix, not cosmetics. Opening in winter killed *every* scripted player within 2–4 days, including the careful one: the player has no money and no information yet, so a heating peak on day 1 is not a decision, it's a coin flip. Opening in spring gives ~45 calm days to learn the panel and earn capital before the first real exam. |

A run at 1× speed is roughly 10 real seconds per game day, so year one lasts about
10 minutes; the difficulty ramp (below) means the interesting part of a run is
year 2+.

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

At each new year (`src/sim/engine.js:627-629`): population ×1.10 compounding, hazard
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

20 checks, no browser, ~1 s. These assert the rules the design rests on, so a tuning
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
more than 2×.

Two of these caught real bugs during development, both worth keeping in mind:
the solar test failed because `daylight()` hit exactly 0 at `hour === 6`, and the
bankruptcy test initially passed for the wrong reason (with no plants there are no
costs, so money cannot drain — it was rewritten to drain through a plant's fixed O&M).

### 2.2 Balance sweep — `node tools/balance.mjs 12`

Four scripted policies, identical seeds, headless. Latest run (12 seeds each), days
survived:

| policy | min | median | max |
|---|---|---|---|
| idle (build nothing) | 9 | 82 | 109 |
| greedy (cheapest plant first, no storage, no upgrades) | 12 | 112 | 120 |
| steady (build on a fixed cadence, some storage) | 234 | 261 | 297 |
| careful (hazards watched, batteries charged on warning, upgrades bought) | 354 | 413 | 447 |

At 60 days/year that is ≈6.9 years for careful play and ≈4.4 for steady — i.e. a
careful player lasts well past the opening minutes, and both idle and greedy die, the
idle one usually at the first winter. Every policy ends at "Customers revolted"; none
went invincible. The harness also replays a serialised run and reports
`save round-trip replay identical: true`.

Caveat: these are scripted bots, not humans. They bound the difficulty from below (a
bot that reacts optimally to warnings survived 6.9 years), so a human having read the
README should land somewhere in the 3–7 year band. I have no human play-test data.

### 2.3 Browser play-test — `cd tools/e2e && node play.mjs`

Real Chromium (Chrome for Testing 149 via `playwright-core`), driving the real
`index.html` with `page.mouse.click` and real key presses — **57/57 checks pass** on the
current code (~130 s per run). What it actually does:

- Loads the page, asserts the stylesheet is applied and no page/console errors occur.
- Starts a run, asserts the coach marks appear and can be dismissed.
- Asserts the real-time loop advances on its own (~2 ticks/s at 1×) and the canvas is
  sized to the layout (16 tiles at 64 px, map 1088 px wide).
- **Builds by clicking** exactly as a player does: palette card, then map tile — hydro on
  a river, solar, wind, battery. Then asserts the fleet grew.
- Refusal paths: unaffordable plants are dimmed in the panel; a build with no money is
  refused with the price in a toast; building on a town is refused with an explanation.
- Clicking an owned plant opens its detail card, the card stays inside the side panel,
  it can shut the plant down, a battery can be forced to *Charge*, `Escape` closes the
  card, and selling a plant removes it and pays salvage.
- Keyboard: `Space` pauses (tick frozen), a number key resumes.
- Plays **~160 in-game days / 161 days into year 3** with 31 mouse-driven builds and 8
  upgrades bought through the panel, then checks all four seasons occurred, that ≥2
  disasters struck after warning, that damage happened and crews repaired it, that new
  towns connected, and that goodwill stayed above 55 under careful play.
- Layout: at 1440×900 and at 1120×720, nothing runs off screen, nothing collapses, tiles
  are ≥26 px, the map is ≥34 % of the viewport height, and no visible element has
  `scrollWidth > clientWidth` (text overflow). Canvas pixel sampling shows 166 distinct
  colour buckets — the map is actually drawing varied content, not a blank rectangle.
- Save/reload/continue: saves, reloads, title offers **Continue**, the resumed run has
  the same plants/score and the clock continues from the same tick, and the loaded save
  keeps simulating.
- Export/import: a real download lands (`gridling-year3.gridling`, ~21 KB), the file
  parses as a Gridling save, **Delete saved run** clears the slot (title then offers only
  *New run* / *How to play*), a fresh run really is fresh, importing the file restores the
  exported run, and pasting the JSON works too.
- A deliberately careless run loses in 28–52 days, the game-over screen shows a score
  that matches the run state, the best-score table is written, and reloading a finished
  save reports *game over* rather than resuming a live run.
- Zero page errors and zero console errors across the whole session.

Screenshots are written to `tools/e2e/shots/` (git-ignored) together with
`results.json`, so a run can be re-inspected.

### 2.4 The documented command

`node server.mjs` was smoke-tested on its own: it serves `index.html`, `styles.css` and
`src/sim/engine.js` with HTTP 200, refuses a `../etc/passwd` traversal with 404, and a
real page load against it starts a run with no console errors (canvas 1088×583, Cash
labelled `Cash (k$)`). The e2e driver runs its own equivalent inline server, so this was
verified separately.

---

## 3. The image-viewing limitation, and what replaced it

Preflight check 7 recorded that **direct image viewing is not available** in this
environment: screenshots are written and recognised as valid PNGs, but the vision role
reports it does not accept image input, so I never saw a single pixel of the game.

That is a real limitation for a "cute, soft look" brief, and it must be read as such:
**the aesthetics were never verified by eye.** What was verified instead, per the
preflight disclosure:

- canvas pixel sampling → colour distribution is rich and the canvas is not blank;
- computed styles and DOM geometry → the stylesheet applied, the grid layout is a
  `display:grid` main area, panel/canvas/chart boxes are inside the viewport at two
  window sizes, tiles are large enough to read;
- overflow detection → no visible element's content exceeds its box;
- console and page-error listeners throughout.

So "layout and readability are correct" is verified; "the game looks cute and pleasant"
is an *unverified design intention* — the palette, corner radii and plant art are
plausible but unaudited. Screenshots exist in `tools/e2e/shots/` for a human to look at.

Bug this caused, worth recording because it is exactly the failure mode: the stylesheet
`<link>` tag was silently clobbered when a favicon link was inserted next to it. The game
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

---

## 5. Known problems

1. **The visuals have never been seen by a human or by me.** See section 3. Everything
   about them is unverified except layout geometry and colour richness. This is the
   biggest gap in the project.
2. **Headless Chromium renders at ~60 fps but ticks far faster than a human plays.** The
   driver calls `setTps(8–16)` to get enough simulation in a reasonable wall-clock time,
   which means the *long-run* play-test deliberately runs at a speed no human would use.
   Correctness is verified there, but a purely perceptual question — is the chart legible
   while it scrolls at 4× — is only covered by the static layout checks.
3. **The tick model is 20 hours/day.** `hourOf` maps ticks onto 0..19, so the clock never
   shows 20:00–23:00. It's internally consistent (dusk/dawn, peaks, solar all use the same
   scale), but it is a simplification a player might notice if they count hours.
4. **The event log is capped at 80 entries**, so early-run events scroll off. This is
   intentional (unbounded logs would grow without limit across a 7-year run) but it means
   a player cannot retrospectively find when a town joined.
5. **Autosave is time-based (~every 12 s of real time), not action-based.** A crash
   within that window can lose the last few in-game hours. Deliberate: saving every tick
   across a 400-day run is a lot of `localStorage` writes.
6. **One hazard chain at a time.** `game.hazard` is a single slot, so two disasters never
   overlap. This keeps them readable and survivable but caps the possible "everything
   went wrong at once" moment that would test a player hardest.
7. **Nuclear maxCount is 2 but the map may offer fewer legal cooling-water sites** than
   that on unlucky terrain generation. Not a bug — it just means some seeds are slightly
   less generous. Not verified across many seeds.
8. **Untested paths:** mobile/touch (brief says desktop mouse, and it is untested, so no
   claim is made); very small windows (<1120×720) — the layout checks cover 1440×900 and
   1120×720 only; Firefox/Safari (only Chromium was driven); multi-tab interference on
   the autosave slot; screen-reader/accessibility semantics; sound (deliberately absent).
9. **`tools/e2e/node_modules` exists** (project-local `playwright-core` only, as the
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
