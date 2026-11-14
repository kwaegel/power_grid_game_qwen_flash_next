# Task: build a browser-based power grid management game

You are going to design and build a complete, playable game that runs in a web browser, working on your own from start to finish. The work has three parts: check the environment, build the game, then play-test it and write up what you did. Read this whole file before starting.

Build everything in the current working directory.

## Part 1: Environment check (do this first)

Building this well depends on being able to run and play the game yourself, in a real browser, and react to what you see. If the environment is missing something needed for that, I want to fix the environment myself rather than have you work around it, because a workaround changes what you are able to build and test. So this part is pass/fail: if any required check fails, stop and tell me.

Do not install system packages, global tools, or browser binaries to make a check pass, and do not substitute a weaker method (for example, a simulated DOM in place of a real browser engine). Project-local `npm install` is fine, here and later.

Required checks:

1. **Working directory.** It is writable, and contains nothing except this prompt file (and possibly an empty git repository).
2. **Git.** `git` is available. Initialise a repository here if there isn't one.
3. **Node.js and npm.** Both are available. Record the versions. Confirm npm can install a small package from the registry into a scratch directory.
4. **Local web server.** You can start an HTTP server on a local port and fetch a file from it.
5. **Browser control.** You have some way to drive a real browser engine (headless is fine): a browser tool provided by your harness, or Playwright/Puppeteer with a browser that is already installed. Through it you can load a local URL, take a screenshot, send mouse clicks and keyboard input, run JavaScript in the page, and read console output and page errors.
6. **End-to-end smoke test.** In a scratch directory, write a tiny page with a canvas that draws a coloured shape, a button that changes some text and logs to the console when clicked, and a script that writes a value to `localStorage`. Serve it, then through the browser: load it, take a screenshot, click the button, confirm the text changed, confirm you received the console message, reload, and confirm the `localStorage` value survived the reload.

Also record, without treating it as a failure:

7. **Image viewing.** Try to look at the screenshot from check 6. Note whether you can see image content directly (and describe the shape and its colour if so), or whether you can only inspect the page through the DOM and scripts.

Write the results to `PREFLIGHT.md`: each check, pass or fail, the versions found, and which browser-control method you used.

- **If every required check passes:** delete the scratch files, commit, and carry on to Part 2 without waiting for me.
- **If any required check fails:** finish writing `PREFLIGHT.md`, then end your turn with a message that begins with `PREFLIGHT FAILED`, lists what is missing, and says what I would need to change. Do not write any game code.

## Part 2: The game

The player runs the electricity grid for a small region, keeping supply matched to demand while conditions get steadily harder. Beyond the points below, the design is yours. I am interested in the choices you make, so treat these as a brief, and make the rest of the decisions the way a game designer would.

What it needs:

- **Runs in the browser, client-side only.** No backend, and no network access needed once the page is served. It starts with a single documented command. Target a desktop browser with a mouse; keyboard shortcuts are optional.
- **Cute, soft look.** Rounded shapes, a gentle palette, friendly rather than industrial. Make the visuals yourself (canvas, SVG, CSS, generated in code); don't download art or asset packs.
- **Several power plant types** with meaningfully different tradeoffs, so that choosing between them is an interesting decision and no single type is always the right answer.
- **Seasonal demand.** Electricity use follows patterns over the year that a player can learn and plan around.
- **Random disasters** that the player has to respond to. They should create decisions and reward preparation, and be survivable with good play.
- **Rising difficulty.** The game gets harder the longer a run lasts, and a run eventually ends.
- **A score** based on some combination of how long the player lasted, how much power they delivered, or similar measures of your choosing. Show it at the end of a run and keep a local list of best scores.
- **Saved games** in web storage that survive a page reload, plus a way to export a save to a file and import it again.
- **Learnable by playing.** Someone opening it cold should understand what to do within a couple of minutes without reading documentation.

What is open: everything else. Real-time or turn-based, a map or something more abstract, money, energy storage, transmission, weather, research, customer satisfaction, sound, how a run ends. The tech stack and any libraries are also your choice. A small game where every system works and the whole thing is fun beats a large one with half-finished systems.

## Part 3: Play-test and write up

Once the game runs, play it through the browser the way a player would, and fix what you find. At a minimum:

- Start a new game, build things, get through several seasons, live through at least one disaster, lose, and see the score.
- Save, reload the page, and continue. Export a save, clear storage, import it, and continue.
- Watch the console for errors throughout, and look at the screen at several points for layout or readability problems.
- Check the balance at both ends: a careless player should lose, and a careful one should last well past the opening minutes.

Then leave these in the repository:

- `README.md`: how to run the game and how to play it.
- `NOTES.md`: the main design decisions and why you made them, what you tested and how, known problems, and what you would do next with more time.

Commit as you go with messages that describe the change.

## How to work

- After the environment check passes, work autonomously to the end. Don't stop to ask me questions; when something is ambiguous, decide, and record the decision in `NOTES.md`.
- Report accurately. If something is untested, partly working, or broken, say so plainly in `NOTES.md` and in your final message.
- End with a short final message: what you built, the command to run it, and any known issues.
