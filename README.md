# GameFilm Game Kit

Make a game for **gamefilm.org** with your own LLM. No account, no API keys, no tokens, no build
step — just Node and a browser. You bring the AI; this kit makes sure what it writes actually
loads on GameFilm.

## Setup (≈30 seconds)

1. Have **Node 18+** (you almost certainly do: `node -v`).
2. That's it. There's nothing to install.

> **Using Claude Code?** Just open this folder in it. It auto-reads `CLAUDE.md` and already knows
> the whole workflow — say *"make me a game where you dodge falling rocks"* and it'll write,
> validate, and play it. Or run the `/new-game` command.

## The loop

```
       (you + your LLM write game.js)
                 │
   node gf.mjs verify game.js     ✓ ALL PASS   — or specific errors to fix
                 │
   node gf.mjs play game.js       ▶ plays in your browser
                 │
        (iterate until you like it)
                 │
   paste game.js into gamefilm.org   → done
```

## Commands

| Command | What it does |
|---|---|
| `node gf.mjs verify game.js` | Checks your game loads on GameFilm — exports, `GAME_META`, **determinism**, no banned APIs. Pass/fail with exact reasons. |
| `node gf.mjs play game.js` | Serves your game in the **real GameFilm runtime** and opens your browser. |

(Both default to `./game.js` if you omit the file.)

## What's here

- **`GAME_SPEC.md`** — the full contract. Hand it to your LLM.
- **`game.js`** — a working sample (Pac-Man). Edit it, or replace it with your own.
- **`gf.mjs`** — the `verify` / `play` CLI.
- **`runtime/`** — the actual GameFilm runtime, so local play matches production.
- **`CLAUDE.md`** + **`.claude/commands/new-game.md`** — primes Claude Code for the workflow.

## The one rule that matters most

Your game must be **deterministic** — same seed + same inputs ⇒ same game, every time. That's
what lets GameFilm store a replay, verify the score, and let an AI watch the tape. Use the seeded
`createPRNG` for all randomness in the simulation; never `Math.random`/`Date.now` there. `verify`
will catch you if you slip.
