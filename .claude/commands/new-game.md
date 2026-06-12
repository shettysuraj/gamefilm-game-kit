Create a new GameFilm game in this kit.

1. Read `GAME_SPEC.md` for the contract (and skim the existing `game.js` sample).
2. If I haven't told you the game idea, ask me for it.
3. Write a complete, conforming, **self-contained** `game.js` (zero imports, deterministic sim,
   seeded PRNG, `createGame`/`render`/`isOver`/`getResult`, all `GAME_META.result.fields` returned).
4. Run `node gf.mjs verify game.js`. If it fails, fix `game.js` per the exact errors and re-run —
   do not stop until it reports `✓ ALL PASS`.
5. Run `node gf.mjs play game.js` so I can play it, then ask me what to refine.
