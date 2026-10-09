# GameFilm Game Design Guide — how to make a game that's *good*, not just valid

The [Game Spec](./GAME_SPEC.md) is the contract: satisfy it and your game *runs, verifies, and ranks*.
This guide is the other half: how to make a game people actually want to replay. The spec is
enforced by a verifier; this is judgment, so treat it as a checklist of questions to ask, not rules
to obey blindly.

Everything here is grounded in the four games already on the platform — steal from them:

| Game | Genre | Input | Steal its… |
|---|---|---|---|
| **POP** | wave shooter | joystick | enemy archetypes, attack-pattern telegraphing, upgrade economy, boss cadence |
| **Shapes** | falling-block puzzle | joystick | escalating speed, "one bad placement" tension, line-clear payoff |
| **Bricks** | breakout / paddle | paddle | powerup risk/reward, streak multiplier, angle skill ceiling |
| **Amphibian** | lane-crosser | joystick | readable hazards, incremental progress, near-miss tension |

---

## 0. The one thing

**The core loop must be fun in ten seconds, with no explanation.** A player lands on your game, taps
once, and either feels something or leaves. Everything below serves that. Before you add a second
mechanic, a level system, or a boss, the *base action* — the tap, the dodge, the shot — must be
satisfying on its own. Prototype that first. If dodging one block isn't fun, dodging a hundred won't
be either.

Ask: *what is the single verb?* Dodge. Stack. Aim. Time. Build the whole game outward from that verb.

---

## 1. The weekly seed: design a new game every week

Every published game is played on a **hub seed that rotates every 7 days**. Everyone plays the same
seed that week, every score is verified by replaying `(seed, inputs)`, and the leaderboard is
scoped to *(build + seed)*, so each week is a fresh board (spec: *Leaderboard scope*). That makes
the seed your biggest design lever, not just a source of variety. **Use it so that each week's seed
gives effectively a new game with the same skills.** A returning player should open your game on
Monday and find a new challenge to learn and master. They shouldn't get last week's layout shuffled,
and they shouldn't get a game so different that their practice is worthless.

**POP is the reference implementation.** Study how it splits the seed into two layers:

**Layer 1: the week's identity, rolled once at game start.** Before anything spawns,
`generateTournamentMods(rng)` (`games/pop/game/state.js`) draws one frozen set of rules from the seed:

| What the seed sets | Range | Effect |
|---|---|---|
| enemy speed / HP / fire rate / bullet speed | ×0.55–1.45 / ×0.6–1.4 / ×0.5–1.5 / ×0.65–1.35 | the week's tempo and pressure |
| enemy movement frequency / amplitude | ×0.4–1.6 / ×0.5–1.5 | how erratic the field feels |
| shield chance, shield-up and vulnerable durations | 15–40%, 2–4 s, 1–3 s | how much timing matters |
| wave order: which enemy type fills which slot, per level | one of 6 permutations × 5 levels (7,776 combinations) | the week's route through the game |
| mix / cameo chance: off-type and cross-level enemies mixed in | 30–80% / 10–30% | how much surprise |
| boss shot pattern | derived from the mods | the bosses' week |

Then it **names the week** from the most extreme modifier: BLITZ or CRAWL, IRON TIDE or GLASS CANNON,
FIRESTORM or LULL, BULLET STORM or SLOW BURN, CHAOS or STEADY, TEMPEST or TIGHT (GAUNTLET when nothing
dominates). The name is computed from the seed on the title screen *before* play and shown in the
HUD, so players know "this is a BLITZ week" and adjust their strategy. A name turns random numbers
into a theme people talk about. The mods are also logged as an analytics event, so the corpus can
compare play across weeks.

**Layer 2: moment-to-moment variance, scaled by level.** Spawn positions, phases, cooldown jitter
and variant/cameo spawns all draw from the same seeded stream. In POP that variance is multiplied
by a per-level `rngMul` (`SPAWN_TUNING` in `waves.js`): **0.15 on level 1, rising to 1.0 by level 4**.
Early levels are close to fixed, so they're learnable, fair onboarding. Late levels are where the
seed really bites.

**What the seed must NOT touch:** in POP the wave *structure* stays fixed (how many waves, how many
enemies per wave, when the bosses come), and so do the scoring rules (streak multiplier, tempo bonus
against par times) and the upgrade system. In the code's own words: *"shifts positions, timings, and
phases each week while keeping wave structure/composition fixed."* That fixed spine is what makes skill
carry over from week to week and keeps scores meaningful.

**Rules of thumb:**
- **Bound every seeded rule to a range around a sane centre** (POP keeps every multiplier roughly
  centred on ×1.0). No seed may produce an unwinnable or trivial week. **Sweep many seeds when you
  test**, not just one. The 🎲 on the test page (gamefilm.org/test) and `verify` (N seeds) are there for exactly this.
- **Roll the week's rules once, up front, from the seed, in a fixed order.** Don't let them drift
  during play. Changing the draw order or the ranges changes every future week, so it's an
  `ENGINE_VERSION` bump.
- **Make the week legible.** Name or describe the week's twist where the player sees it before
  pressing start.
- **Keep cosmetic randomness on a separate stream.** POP's starfield uses its own fixed-seed PRNG
  (`stars.js`), so visuals can change without shifting the simulation.
- **Ask of your design:** *if I only changed the seed, would a skilled player notice and need to
  adapt, and would their skill still carry over?* If they wouldn't notice, the seed is under-used.
  If their skill wouldn't carry over, it's over-used.

---

## 2. Universal principles

**Difficulty is a curve, not a wall.** Start easy enough that the first 10 seconds are winnable, then
ramp. The ramp should come from the *systems already on screen* — more enemies, faster fall, tighter
gaps — not from a sudden new rule. POP adds enemies per wave and speeds them during descent; Shapes
speeds the fall each level. The player should lose because they got overwhelmed, never because the
game surprised them with something unfair.

**Every death must feel earned — and this platform makes that literal.** Determinism means the same
seed + inputs always produce the same result, so a loss is *never* the RNG screwing you; it's a
decision you can watch back on the replay. Design around that: make hazards *readable and telegraphed*
so a good player can always react. Cheap deaths (offscreen spawns, unavoidable hits, input you
couldn't have seen coming) break the contract with the player. Use the seeded PRNG for *variety*, not
for *gotchas*.

**Risk must pay.** The best moments are optional gambles. Bricks' ceiling-hit shrinks your paddle but
clears top rows for big points; POP's capsules tempt you into danger for an upgrade. Give the skilled
player a reason to take the harder line — a score multiplier, a shortcut, a power spike — and let the
cautious player survive without it. A game with no risk/reward decisions is just reflexes.

**Feedback is the game.** A hit needs a flash, a shake, a sound, a number popping. This is "juice,"
and it's most of what separates a good game from a technically-correct one. You draw procedurally, so
juice is cheap: scale a sprite on impact, flash the screen, spawn particles, punch the score up. The
platform gives you the sound layer (SFX + music) — use it. Silence and stillness read as broken.

**Readability beats realism.** Portrait phone, thumb on the screen, 60fps. The player must parse the
whole board at a glance. High contrast, distinct silhouettes per entity type, danger in a color that
means danger. POP gives every enemy a distinct crescent/shape and every attack a telegraph. If two
things that behave differently look alike, you've made an unfair game by accident.

**The "one more try" hook.** The game-over screen should make the next run feel one decision away. A
visible best score to beat, a run that ended on a mistake the player understands, a near-miss they
*almost* pulled off. Short runs (30s–3min) with instant restart beat long runs — this is a replay
platform; the whole point is running the same seed until you master it.

---

## 3. Structure — levels, mechanics, bosses

**Teach, then test.** Introduce one mechanic at a time in a safe context, then combine. Don't open
with everything. Amphibian starts with slow cars before adding rivers and snakes. A new enemy should
appear alone and survivable first, so the player learns its pattern, *then* in a crowd.

**Escalate along a few axes, not one.** Speed, density, variety, and precision-required are your dials.
Turn them up gradually and in combination. A level that's just "same thing but faster" gets stale; a
level that changes *what* you're dodging *and* how fast keeps attention.

**Levels/waves are pacing units.** Use them to (a) introduce, (b) intensify, (c) give a breath, (d)
spike. A boss or a hard wave should be followed by a moment of relief before the next climb. Constant
maximum intensity is exhausting and reads as noise. POP's waves distribute rising enemies at specific
counts (W8, W12–14) rather than a flat ramp — deliberate peaks and valleys.

**Bosses are a mechanic exam.** A good boss tests what the level taught, in a concentrated,
telegraphed, multi-phase fight. It should have: a readable tell before each attack, a punishable
window, and escalating phases (as its health drops, it gets harder or changes pattern). Don't add a
boss for spectacle — add it when you have a mechanic worth examining. POP's SABRE sweeps a shielded
telegraph before firing: threat you can see coming and beat with positioning.

**Progression the player feels.** Upgrades, combos, streaks — a sense of getting stronger or building
something. Bricks' streak multiplier makes a clean run worth exponentially more than scattered points;
POP's upgrade capsules build a loadout. Even a pure-score game benefits from a visible combo that the
player is trying to protect.

---

## 4. Designing *within* the constraints (they're features)

- **Portrait, one-handed, touch-first (390×844).** Controls must be reachable with one thumb. The
  platform's joystick is a floating thumb-stick; the paddle tracks horizontal drag. Design vertical —
  things fall toward you, rise away, cross laterally. Don't design a landscape game and rotate it.
- **Procedural vector graphics — embrace the aesthetic.** No sprite sheets. This is a *style*, not a
  limitation: clean shapes, gradients, glow, bold silhouettes (think *Geometry Wars*, vector arcade).
  It reads great on phones and it's instant to iterate. Lean into neon-on-dark, crisp geometry.
- **Seeded randomness is a design tool**: see §1. Never use `Math.random`/`Date.now` in the sim
  (it breaks determinism *and* fairness). Wall-clock is banned; count frames.
- **60fps on a mid-phone.** Keep per-frame allocations and draw calls modest. Pool objects, cap
  particle counts. A game that stutters feels broken regardless of design.

---

## 5. Genre playbook

Each is doable under the contract. For each: the core verb, the pacing spine, the platform game to
crib from, and the determinism gotcha.

**Wave shooter** (verb: *aim/shoot*). Waves of enemies with distinct archetypes (fodder, tank,
sniper, swarm); an upgrade economy; a boss every N waves. Pacing: escalate enemy count + speed +
variety; peak at the boss, then breathe. Crib: **POP** — everything. Gotcha: enemy AI must be a pure
function of frame/seed, never of wall-clock.

**Dodger / lane-crosser** (verb: *dodge/move*). Navigate hazards to a goal or for distance. Pacing:
add lanes, hazard types, and speed; reward near-misses. Crib: **Amphibian**. Gotcha: telegraph every
hazard — a dodger lives or dies on readability.

**Faller / stacker / puzzle** (verb: *place/time*). Pieces fall; place them well under rising speed.
Pacing: speed up, add piece variety, reward clears with combos. Crib: **Shapes**. Gotcha: if the
player sets sensitivity/timing (DAS), it must be recorded — it affects the sim (see spec §7.4).

**Paddle / breakout** (verb: *aim the bounce*). Keep a ball alive; angle it into targets. Pacing:
brick layouts, powerups (good and bad), a streak multiplier. Crib: **Bricks**. Gotcha: ball physics
must be deterministic — fixed timestep, no float drift; this is the hardest genre to keep in
client/server parity, so keep the physics simple and integer-friendly where you can.

**Endless runner / side-scroller** (verb: *time the jump/dodge*). Auto-advance; react to oncoming
hazards; distance = score. Pacing: gap/hazard density ramps; occasional "gauntlet" spikes then relief.
Crib: Amphibian's readability + Shapes' speed ramp. Gotcha: parallax/scroll is render-only; the sim
advances by frame count.

**Timing / rhythm / precision-tap** (verb: *tap on the beat/mark*). A single high-skill input with a
tight window. Pacing: shrink the window, speed the cadence, add fake-outs. Crib: the "one verb, mastered"
philosophy above. Gotcha: the "beat" is frame-driven, never audio-clock-driven.

**Pinball / physics sandbox** (verb: *nudge/flip*). Tempting, but **the hardest to ship** — realistic
float physics rarely stays byte-identical across client and server, and the verifier will reject a
non-deterministic game. If you attempt it: fixed timestep, quantized positions/velocities, and test
the determinism check *early and often*. Consider a simplified, grid-or-integer physics model rather
than continuous float simulation.

---

## 6. Use what the platform gives you

You inherit a lot — don't rebuild it, and *do* use it, because a game that ignores it feels bare:

- **Standard HUD** (`GAME_META.hud: true`): the platform draws the score + pause/music/sound buttons.
  Don't hand-draw a score if you use this. (See spec §5.)
- **Standard title / How-to-Play** (`GAME_META.howTo`): give it a few short lines and the platform
  draws a consistent title screen over your `TITLE` phase — game name, START, and a How-to-Play
  overlay — so every game teaches itself the same way. You keep owning the start (the tap that
  starts play is the first recorded input). Needs `getState().phase === 'TITLE'` before play. (§5.)
- **Music** (`GAME_META.music`): pick a preset (`'arcade'`, `'chiptune'`, `'tense'`, `'ambient'`,
  `'none'`) to match your game's feel, or supply a custom melody. Match the music to the mood — a
  tense dodger and a bright arcade shooter want different tracks.
- **Custom sound** (optional `audio.js`): for bespoke SFX/BGM beyond the presets, ship a per-game
  `audio.js` (the audio tab in the studio) — it's versioned and published with your game. Emit sound
  events from `getSfx()` and synthesize them in `audio.js`'s `onSfx`. Most games don't need it;
  `GAME_META.music` + central SFX go a long way (see spec §3). Reach for it when the sound *is* the
  identity (a signature hit, a distinct death sting).
- **`cardStats`**: choose 2–4 stats that tell the story of a run (Bricks shows Level + Bricks; POP
  shows kills + wave). These are what a player sees on their profile — pick the ones they'll want to
  beat.
- **`SCHEMA` is the AI coach's manual — write it well.** The corpus/film-session AI reads your SCHEMA
  to coach players. Describe your mechanics, every entity's role and counter, the scoring, and the
  strategy. A rich SCHEMA (see POP's) turns the AI coach from generic to genuinely useful; a thin one
  wastes the feature. This is also the single best way to make your game feel "understood" by the
  platform.

---

## 7. Common mistakes (the verifier won't catch these — a playtest will)

- **No juice.** Correct but lifeless. Add feedback to *every* action before anything else.
- **Difficulty wall, not curve.** Fun for 20 seconds then instantly unfair. Ramp gradually.
- **Cheap deaths.** Offscreen spawns, unavoidable hits, hazards you can't see coming. Telegraph.
- **Too many mechanics at once.** Teach one at a time. If you can't explain the game in one sentence,
  simplify.
- **Controls that fight the thumb.** Precise inputs that a phone can't deliver, or targets out of
  reach. Test one-handed.
- **A thin SCHEMA.** You built the game; spend ten minutes telling the coach how it works.
- **Ignoring the seed.** A game that plays identically every run has no mastery arc; one that uses
  `Math.random` breaks determinism. Use the seeded PRNG for *fair variety*.

---

**The loop:** build the core verb → make it juicy → wrap it in an escalating structure → tune the
difficulty curve on real playtests (change the seed, play it ten times) → write a rich SCHEMA →
verify → submit. Good games come from iterating on *feel*, which the verifier can't measure — only
you can, by playing it.
