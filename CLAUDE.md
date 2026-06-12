# GameFilm Game Kit — guidance for Claude Code

You are in the **GameFilm game kit**. Your job: help the user build a single `game.js` that
conforms to the GameFilm contract, then validate it and let them play it. Work the loop below
every time — do not hand back a game you haven't run through `verify`.

## The contract (read `GAME_SPEC.md` first)

`GAME_SPEC.md` in this folder is the full, authoritative contract. In short, `game.js` must:

- be **ONE self-contained file with ZERO imports**
- export `GAME_META`, `ENGINE_VERSION`, `SCHEMA`, `createPRNG(seed)`, `createGame(seed, opts)`
- be **deterministic**: the simulation is a pure function of `(seed, inputs)`. No `Math.random`,
  `Date.now`, or wall-clock in the sim — use the seeded `createPRNG` and the frame count.
  (`Math.random` is fine in `render` only — it never touches game state.)
- render procedurally to a 2D canvas via `render(ctx, W, H)`; portrait **390×844**, mobile-first
- `createGame(seed, opts)` returns `{ update(input), render(ctx, W, H), isOver(), getResult() }`
  (plus optional `getState()`); every key in `GAME_META.result.fields` must appear in `getResult()`

`game.js` in this folder is a **working sample (Pong — the default template)** — read it and pattern-match it.

## The loop — do this every time

1. **Write** `game.js` per `GAME_SPEC.md` (ask the user for the game idea if they haven't given one).
2. **Validate:** run `node gf.mjs verify game.js`. It runs static + contract + **determinism** checks.
   If it **FAILS**, read the exact errors, fix `game.js`, and re-run. **Do not stop until `✓ ALL PASS`.**
3. **Let them play:** run `node gf.mjs play game.js` (opens the browser).
4. When the user is happy, they paste `game.js` into gamefilm.org. Done.

## Things the validator hard-blocks (write to these up front)

- `fetch` / `XMLHttpRequest` / `WebSocket` (no network), `eval` / `new Function`, dynamic `import()`,
  relative imports, `document.cookie`.
- **Non-determinism** — `verify` replays the game twice with identical inputs and diffs the result;
  anything that differs fails. The usual culprit is `Math.random`/`Date.now` in `update`.
- Missing exports or `GAME_META` fields; `getResult()` missing a declared `result.field`.

## Notes

- Bump `ENGINE_VERSION` whenever you change game logic.
- Input shape passed to `update()` depends on `GAME_META.input.type`: `joystick` →
  `{ dx, dy, b, tapX, tapY }`, `paddle` → a number, `bitmask` → an integer. See `GAME_SPEC.md` §7.
- Keep it fun and readable; the sample game is a good size/complexity target.
