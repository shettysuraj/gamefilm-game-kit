# GameFilm Game Spec — Functional & Technical Contract

The canonical contract for a game on gamefilm.org. If a `game.js` satisfies this, the
hub hosts it, records every play, verifies every score, builds a leaderboard, archives
it for cross-version replay, and lets the AI coach watch the tape — with **no other
work from the author**.

This supersedes the old external-server model (each game ran its own server; the hub POSTed
to `your-game.com/api/verify`). That model is dead and its starter template has been removed.
Games are now pure deterministic engines the hub loads directly. Build to *this* document.

---

## 0. What a game is here

A game on gamefilm is **one self-contained JavaScript file** that exposes a deterministic
simulation plus a canvas renderer. The hub's shared runtime wraps it with input capture,
recording, the timeline, score submission, the replay viewer, audio, and the pause/mute UI.
The author writes the *game*; the platform is everything else.

The score is never the artifact — the **replay** is. A replay is `(seed, recorded inputs)`.
The score is *derived* by replaying that on the server. This is why determinism is not a
nice-to-have: it is the entire integrity model of the leaderboard.

### The boundary — who does what

The line is simple: **you build the game; GameFilm builds everything around it.** Your entire
responsibility fits in one file plus two small companions.

| You (the game designer) build — all of it in `game.js` | GameFilm provides — automatically, no author action |
|---|---|
| **Simulation** — `createGame` / `update`, deterministic, fixed 60 fps step | HTML shell, hub-computed seed, navigation, bug widget, bfcache/swipe handling |
| **Look** — `render(ctx, W, H)`, procedural vector graphics, no asset files | Touch/keyboard input capture + delta-compressed **replay recording** |
| **Rules as data** — `GAME_META` (identity, input type, result/score fields, card stats) | **Score submission** (persist-first: the score shows instantly, upload runs in the background) |
| **Coach's manual** — `SCHEMA` (mechanics, entities, tactics, strategy) | **Permanent per-game S3 storage** of every player's replay, forever |
| **Randomness** — `createPRNG(seed)` | **Headless server verification** (replays your `game.js`) + anticheat |
| **End + result** — `isOver()`, `getResult()` | **Version archiving** — freezes the bytes of each `ENGINE_VERSION` you declare |
| *(Optional)* custom input, per-game audio, richer snapshots/events | **Cross-version replay viewer** (old builds reproduced against their own engine) |
| **Ship 3 files** — `game.js` + `favicon.svg` + `CHANGELOG.md` | **Leaderboards** (build + seed, weekly) |
| **Obey the Four Laws** (§1) | **AI film sessions + corpus scouting reports** (driven by your `SCHEMA`) |
| | Pause/mute UI, replay viewer, sandbox→publish review gates |

Everything below expands one side or the other. If a concern isn't in the left column, it isn't
yours — we handle it.

---

## 1. The Four Laws

A conforming game obeys all four. They are non-negotiable because the platform's
verification, portability, and replay guarantees depend on them.

1. **Deterministic.** Score and outcome are a *pure function* of `(seed, inputs, sensitivity)`.
   Same inputs on the same seed must produce a byte-identical result on the player's device
   and on the server. No wall-clock, no ambient randomness, no environment dependence.

2. **One self-contained file.** All game logic, constants, level data, PRNG, and rendering
   live in a single `game.js` with **zero relative imports**. This is what lets the cartridge
   build archive it verbatim (`cp game.js`) so old replays still run after the engine evolves.

3. **Code-only assets.** Graphics are drawn procedurally on a 2D canvas (vector shapes, paths,
   gradients, text) — **no PNG/JPG/sprite-sheets, no binary blobs**. Audio is synthesized
   (WebAudio) via the platform's audio module or an optional per-game synth — **no audio files**.
   This keeps games tiny, instantly portable, and archivable as plain text.

4. **Mobile portrait, touch-first.** The canonical logical canvas is **390 × 844** and the game
   must be fully playable one-handed on a phone with the platform's touch input. Desktop is a
   bonus, never the primary target.

---

## 2. Upload surface — what the author actually ships

| File | Required | Purpose |
|---|---|---|
| `games/<slug>/game.js` | **Yes** | The entire game (the only substantive file) |
| `games/<slug>/favicon.svg` | **Yes** | Icon for the arcade tile and browser tab |
| `games/<slug>/CHANGELOG.md` | **Yes** | Player-facing release notes, one entry per `ENGINE_VERSION` |
| `games/<slug>/audio.js` | Optional | Per-game synth audio (else inherits the central module) |

That is the whole submission. No `index.html`, no server, no engine, no adapter — the
runtime template serves the client, the **synthetic engine** derives verification from
`game.js`, and the **generic adapter** derives AI coaching from it.

---

## 3. What the platform provides for free

Do **not** build any of this — you inherit it by conforming:

- Touch/keyboard input capture and **delta-compressed recording**
- The **timeline** (periodic state snapshots + event snapshots for AI analysis)
- **Score submission — persist-first, never lose a game.** The replay is written to
  `localStorage` *before any network*, so the score appears the instant the run ends; the upload
  runs in the background over XHR with retries, and anything interrupted is recovered on the next
  game load or when the hub regains focus. Only in the rare fallback where `localStorage` is
  unavailable (private mode) does submission block behind a `DO NOT CLOSE / Uploading…` overlay
- **Permanent S3 storage, fully platform-managed.** Each published game gets its own folder in
  the `gamefilm-ops` bucket (`games/{slug}/`) holding **every player's replay**
  (`replays/{sessionId}.json.gz`) plus every archived build (`cartridges/vN/`, `engines/vN.js`).
  Replays are the single source of truth and are **kept forever — never trimmed or deleted**. You
  never touch storage.
- **Server verification** via a synthetic engine that replays your `game.js` headlessly
- **Anticheat** (input-type defaults: joystick / paddle / bitmask heuristics)
- **Leaderboards** (cron snapshots) and cross-version **replay viewer**
- **AI coaching** (generic adapter, driven by your `SCHEMA`)
- Pause / mute bar, UNRANKED badge, game-over RETURN button
- **The entire HTML shell, seeding, and navigation** — you never write `index.html`, never
  handle the seed (the hub computes it and hands it to `createGame(seed)`), never wire return
  links. The runtime template handles bfcache, swipe-guards, the bug widget, and same-tab nav.

---

## 4. Module contract — what `game.js` exports

```js
export const GAME_META;                 // metadata object (see §5)
export const ENGINE_VERSION;            // integer, bump on every behavior change
export const SCHEMA;                    // string — the AI coach's game manual (see §8)
export function createPRNG(seed);       // deterministic RNG factory (see §6)
export function createGame(seed, opts); // game instance factory (see §7)
export function createInput(canvas, W, H, getScale, meta); // OPTIONAL custom input (see §7.3)
```

`ENGINE_VERSION` is yours to declare and yours to bump — one integer, incremented on every
change to game behavior. It is the key the platform archives your bytes under (§10), and it is
**required**: a `game.js` without it is skipped at startup and hard-fails verification.

### 4.1 Isolate constraints (server verification runs your file with no DOM)

Verification replays your game inside a sealed V8 isolate — no module system, no browser. Two
consequences are hard requirements, and violating either fails *before* your game runs, with an
error that won't obviously point here:

- **One export per line, declaration form only.** Use `export const`, `export let`, `export var`,
  `export function`, `export class`. **`export default` and `export { … }` are not supported** —
  the isolate strips the `export` keyword with a line-start regex to run your file as a plain
  script, and those forms have nothing to strip. They are rejected explicitly.
- **No `window`, `document`, or canvas access at module scope.** The isolate deliberately shims
  nothing browser-shaped; touching a DOM global while the module loads throws and the game never
  loads. Do DOM work *inside* `render()` — that only ever runs in the browser — never in a
  top-level constant, cached context, or load-time setup.

## 5. `GAME_META`

```js
export const GAME_META = {
  name: 'Shapes',
  description: 'One-line arcade-tile blurb.',
  icon: '/play/<slug>/favicon.svg',
  input: { type: 'joystick', discreteMove: true }, // 'joystick' | 'paddle' | 'bitmask'
  canvas: { width: 390, height: 844 },  // logical resolution (portrait)
  levels: [{ name: 'Wave 1', parTime: 60 }],        // for progression display
  result: {
    fields: ['score', 'level', 'elapsed', 'outcome', /* every key getResult() returns */],
    outcomes: ['topped_out', 'victory'],            // closed set of terminal states
  },
  cardStats: [                          // profile session-card stats, rendered generically
    { key: 'level', label: 'Level', compact: 'L' },
    { key: 'maxCombo', label: 'Best Combo' },
  ],
};
```

- You declare nothing about seeding. Every game draws from one shared global seed per period
  (an HMAC of the period number), and boards stay separate because a leaderboard keys on
  **game type + seed**, not on the seed alone.
- Every key listed in `result.fields` **must** be present in the object `getResult()` returns.
- `cardStats` keys must exist in `getResult()`. No game-specific code in the frontend — the
  profile renders whatever `cardStats` declares.

---

## 6. `createPRNG(seed)` — the only legal source of sim randomness

Return a small deterministic RNG seeded by the integer `seed`. The canonical shape (used by the
shipped reference games — Shapes, Amphibian) is an **object** exposing `next()` (a float in
`[0, 1)`) plus `int(min, max)` and `pick(arr)` helpers:

```js
export function createPRNG(seed) {
  let state = seed | 0;
  function next() {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    int(min, max) { return min + Math.floor(next() * (max - min + 1)); },
    pick(arr) { return arr[Math.floor(next() * arr.length)]; },
  };
}
```

Every random event in the **simulation** — spawns, drops, layouts, damage — must flow from this
PRNG, seeded by the hub-supplied seed. `Math.random()` must never touch game state (§9).

---

## 7. `createGame(seed, opts)` — the instance contract

`createGame` returns a stateful game object. The runtime drives it in a **fixed 60 fps loop**:
every frame it reads input, calls `update(input)`, snapshots `getState()`, and calls
`render(ctx, W, H)`. `opts` may carry `{ skipTitle, sensitivity }` (see §7.4).

### 7.1 Required methods

| Method | Signature | Contract |
|---|---|---|
| `update` | `update(input)` | Advance the sim exactly one fixed step from `input` (shape per §7.2). The **only** place state changes. Must be pure w.r.t. `(seed, inputs, sensitivity)`. |
| `render` | `render(ctx, W, H)` | Draw the full frame to the 2D context. Owns the title screen, HUD, and game-over screen. Side-effect-free w.r.t. game state. |
| `isOver` | `isOver() → bool` | `true` once the run has terminated. Latches the result. |
| `getResult` | `getResult() → { score, ... }` | Final stats. Must include `score`, `outcome`, and every key in `GAME_META.result.fields`. |

### 7.2 Input shape passed to `update(input)`

Determined by `GAME_META.input.type`:

- **`joystick`** — `{ dx, dy, b, tapX, tapY, touchActive, touchOX, touchOY }`
  `dx`/`dy` ∈ [-1, 1] (rounded to 3 decimals), `b` = button bitmask (keyboard | touch),
  `tapX`/`tapY` = tap coords in logical space (or -1). Recorded via `recordJoystick`.
- **`paddle`** — a number (the paddle X in logical px), or `{ x, k }` where `k` flags a
  secondary action (e.g. shake/launch). Recorded as-is.
- **`bitmask`** — an integer of button-state bits. Recorded as-is.

Scale sensitivity *before* recording if it affects recorded values (Bricks scales touch delta
by sensitivity pre-record, so the recorded paddle X already reflects it — no replay metadata
needed). Only sensitivity that changes engine-*internal* timing (e.g. DAS) must travel as
metadata (§7.4).

### 7.3 Optional methods (additive — absent = sane default)

| Method | Purpose |
|---|---|
| `getState() → snap` | Per-frame snapshot for the timeline + HUD. Conventions below. |
| `getEvents() → [ev]` | Discrete events this frame; each forces a timeline snapshot for AI analysis. |
| `getSfx() → [ev]` | Frame sound-events forwarded to a per-game `audio.js` (`onSfx`). |

`getState()` snapshot conventions the runtime understands:
- `phase` — `'PLAY'` for active frames; any other value (e.g. `'TITLE'`) marks a non-recorded
  pre-game frame. Only `PLAY` frames are recorded.
- `score` — current score (used if `getState` is absent, falls back to `getResult().score`).
- `sensitivity` — surfaced into the submit payload when present (§7.4).
- `wantsReturn: true` — runtime navigates back to the hub.
- For **central** audio only, monotonic counters trigger built-in SFX:
  `moveCount`, `rotateCount`, `hardDropCount`, `lockCount`, `holdCount`, `clearingCount`,
  `perfectClears`, `level`, `combo`. A per-game `audio.js` owns its SFX entirely instead.

### 7.3b Optional `createInput(canvas, W, H, getScale, meta)`

Override the built-in input factory (e.g. paddle + relative drag + menu taps). Must return an
object satisfying the input contract: `read()`, `type`, **`setUiTapHandler(fn)`** (the runtime
registers its pause/mute + game-over hit-tester here — required for touch UI), and
`injectTap(gx, gy)` (desktop clicks). Else you get the built-in joystick/paddle/bitmask factory.

### 7.4 Sensitivity & title-phase (only if user-adjustable sensitivity affects engine logic)

- New recordings skip the TITLE phase: the runtime passes `opts.skipTitle` + `opts.sensitivity`.
- Surface `sensitivity` in `getState()` so it rides the submit payload → S3 → server `replay()`.
- Games whose sensitivity only scales *recorded input* (Bricks) need none of this.

---

## 8. `SCHEMA` — the self-describing manual

A string that *is* the AI coach's knowledge of your game. Knowledge lives next to the data it
describes, so it can't drift. Validated for minimum length at startup. Must cover:

- Identity and core mechanics (how the game works)
- Scoring and multipliers (how points are earned)
- Every entity the player interacts with — role, threat, how to counter
- Strategy: resource/upgrade interactions, decision framework, risk/reward
- Difficulty progression across levels/waves
- Attack/hazard patterns — what they look like, how to dodge or exploit

Write it dense and tactical. This is the difference between generic "you scored X" coaching and
a real scouting report.

---

## 9. Determinism rules (the hard part — enforced, not trusted)

Two tiers, because they fail for different reasons:

**Forbidden anywhere** (security / portability — no legitimate use, and *not* something the
determinism check can catch):
- `fetch`, `XMLHttpRequest`, `WebSocket` — no network
- `eval`, `new Function`, dynamic `import()` — no dynamic / external code
- `document.cookie` — no ambient credentials
- Relative imports (`import … from './…'`) — break single-file archiving

**Forbidden in the simulation** (determinism — but the determinism check is the real arbiter):
- `Math.random()` — use `createPRNG`
- `Date.now()`, `performance.now()`, `new Date()` — use frame count, not wall-clock
- `localStorage`, `sessionStorage` — no ambient persisted state in the sim

These second-tier APIs **may** appear in `render`/UI (a particle's jitter, a settings read) —
that's visual-only and harmless. They must **never** feed game state. What enforces that isn't
the source scan (it can't tell sim from render); it's the **determinism check**.

Also avoid silent non-determinism: iteration over `Object`/`Set`/`Map` where order affects the
sim, floating-point reductions whose order differs across runs, and any reliance on render
state inside `update`. **Keep `update` and `render` strictly separated** — `update` owns the
sim, `render` only reads it.

**How adherence is checked, not assumed:** the conformance harness runs a two-tier static scan
(hard-blocks the first list, warns on the second), validates the contract, and runs a
**determinism check** — replaying identical `(seed, inputs)` and diffing the outcome. The parity
diff is the gate that actually proves determinism; reading the source cannot. A `Math.random` in
render passes *because* the determinism check passes.

You can run it three ways, and **all three run the same static scan** (one canonical source,
`verifier/static-checks.js`, generated into the other two — so a local pass means the same thing
as a pass on upload):

| Where | Command | Executes your game |
|---|---|---|
| Game kit (offline, zero-install) | `node gf.mjs verify game.js` | plain `import()` — your own code, your own machine |
| Studio (`/develop`) | **Verify** button | in a sandboxed cross-origin iframe |
| Hub (authoritative) | `node verifier/verify.js game.js` | inside the sealed `isolated-vm` isolate |

---

## 10. Versioning & cross-version replay

Replays are kept forever and must stay playable after the game evolves. **You declare the
version; the platform archives the bytes.** `ENGINE_VERSION` is an integer you export from
`game.js` (§4) and **bump every time you change behavior** — new mechanics, tuned constants,
altered level data, a different PRNG draw order. Anything that could make the same
`(seed, inputs)` produce a different result is a new version. Cosmetic-only render changes are
the one safe exception.

The bump is the signal the platform acts on: **when it sees an `ENGINE_VERSION` it hasn't
archived yet, it freezes those exact bytes under that number, forever.** Because your `game.js`
*is* the replay engine (one self-contained file, no separate artifact), the archived copy is a
complete, runnable engine — so any replay recorded on that version can always be reproduced
against the engine that produced it. No bump means no archive: ship changed behavior under a
stale version and the old archived bytes no longer reproduce the replays recorded against them.
That's the one way to break the guarantee, and it's entirely in your hands.

A recorded replay carries the version it was played on. When that differs from the live build, we
replay it against the **archived** engine of that version instead of the current one. That is the
whole reason versioning exists.

The only other thing this asks of you — and it's already **Law 2** — is **keep `game.js`
self-contained with zero imports**. Archiving a version is then just a copy of the file; a
relative import would make the archived copy un-runnable in isolation and break every replay
recorded on that build. As long as you keep your module exports and `createGame` shape stable
(§4, §7), the past stays reproducible.

> Possible future direction, **not current behavior**: deriving the version automatically from a
> content hash of the file, so the platform never depends on the author remembering to bump.
> Today the declared `ENGINE_VERSION` is the sole source of truth.

**Leaderboard scope.** A leaderboard is scoped to **(build + seed)** — a player is ranked only
against others who played the *same immutable build* on the *same seed*. Every ranking is
therefore perfectly apples-to-apples: identical engine, identical challenge, only the player's
decisions differ. Cross-build comparability is never a question because cross-build comparison
never happens. The seed period is the competition window — **currently weekly**: the seed rotates
every 7 days (`games.seed_period_ms` default 604800000) and the board is snapshotted each Sunday
23:59 (`snapshot_leaderboard` cron). So a leaderboard is one build's scores on one week's seed. A
player's progress *across* seeds and builds is the job of the AI corpus / scouting report, not the
board.

---

## 11. Mobile & rendering requirements

- **Logical canvas 390 × 844**, scaled by CSS to fill the viewport preserving aspect ratio;
  the runtime maps touch/click back to logical space.
- Draw everything procedurally: vector shapes, paths, gradients, `fillText`. No raster assets.
- Budget for 60 fps on a mid-range phone — keep per-frame draw calls and allocations modest.
- The runtime overlays UNRANKED badge, mute icons, pause bar, and the upload/game-over screens
  on top of your `render` — keep the bottom ~22px and top-left corner usable but not critical.
- Touch ergonomics: controls reachable one-handed; the platform's joystick is a floating
  thumb-stick, the paddle tracks horizontal drag.

---

## 12. Verification & publish gates

A game moves sandbox → publish through four gates, each proving a different property:

| Gate | Mechanism | Proves |
|---|---|---|
| Not broken / malformed | Static checks (exports, `GAME_META`, forbidden tokens, no relative imports, loads clean) | Well-formed |
| Non-deterministic | Differential replay (N seeds, client vs server diff) | Leaderboard-safe |
| Malicious WIP | Sandbox runs isolated (no hub token, never on the server) until submitted | Contained |
| Not *good* | Manual playthrough by the operator | Meets the bar |

Sandbox games get **zero privilege** — client-only, no leaderboard, no S3, no coach. Privilege
is granted at publish, never at upload.

---

## 13. Minimal conforming game (skeleton)

```js
export const GAME_META = {
  name: 'Dodge', description: 'Dodge falling blocks. One tap = one lane hop.',
  icon: '/play/dodge/favicon.svg',
  input: { type: 'joystick', discreteMove: true },
  canvas: { width: 390, height: 844 },
  levels: [{ name: 'Endless', parTime: 0 }],
  result: { fields: ['score', 'elapsed', 'outcome'], outcomes: ['hit'] },
  cardStats: [{ key: 'score', label: 'Score' }],
};
export const ENGINE_VERSION = 1;
export const SCHEMA = `GAME: Dodge — deterministic lane-dodger. Same seed + inputs = same score.
MECHANICS: 3 lanes; tap left/right to hop. SCORING: +1 per block survived. ...`;

export function createPRNG(seed) { /* { next, int, pick } from §6 */ }

export function createGame(seed, opts = {}) {
  const rng = createPRNG(seed);
  let lane = 1, t = 0, score = 0, over = false, blocks = [];
  return {
    update(input) {
      if (over) return;
      if (input.dx < -0.5) lane = Math.max(0, lane - 1);
      else if (input.dx > 0.5) lane = Math.min(2, lane + 1);
      t++;
      if (t % 30 === 0) blocks.push({ lane: rng.int(0, 2), y: 0 });
      for (const b of blocks) { b.y += 6; if (b.y > 760 && b.y < 800 && b.lane === lane) over = true; }
      blocks = blocks.filter(b => b.y <= 844);
      if (!over && t % 30 === 0) score++;
    },
    render(ctx, W, H) {
      ctx.fillStyle = '#0a0b10'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#e8eaf0';
      ctx.fillRect(lane * (W / 3) + 40, 780, W / 3 - 80, 20);
      for (const b of blocks) { ctx.fillStyle = '#ff6b1a'; ctx.fillRect(b.lane * (W / 3) + 40, b.y, W / 3 - 80, 20); }
      ctx.fillText('SCORE ' + score, 12, 24);
    },
    isOver() { return over; },
    getState() { return { phase: 'PLAY', score }; },
    getResult() { return { score, elapsed: t / 60, outcome: 'hit' }; },
  };
}
```

This file — plus a `favicon.svg` and `CHANGELOG.md` — is a complete, hostable, verifiable,
coachable gamefilm game.
