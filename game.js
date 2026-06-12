// Pac — a simple deterministic Pac-Man for GameFilm.
// Self-contained, zero imports. Same seed + inputs = same game (server-verifiable).
// AI-generated from a one-line prompt against sdk/GAME_SPEC.md, as a demo of the authoring loop.

export const GAME_META = {
  name: 'Pac',
  description: 'Eat every dot in the maze while three ghosts hunt you. Grab a power pellet to turn the tables and eat them. Three lives.',
  icon: '/play/pacman/favicon.svg',
  seedOffset: 20000000,
  input: { type: 'joystick' },
  canvas: { width: 390, height: 844 },
  levels: [{ name: 'The Maze', parTime: 90 }],
  result: {
    fields: ['score', 'dotsEaten', 'ghostsEaten', 'deaths', 'livesLeft', 'elapsed', 'outcome'],
    outcomes: ['victory', 'caught'],
  },
  cardStats: [
    { key: 'score', label: 'Score' },
    { key: 'dotsEaten', label: 'Dots' },
    { key: 'ghostsEaten', label: 'Ghosts', compact: 'G' },
  ],
};

export const ENGINE_VERSION = 2;

export const SCHEMA = `GAME: Pac — a deterministic Pac-Man maze game. Same seed + inputs reproduce the exact game; the score is server-verified from the replay.
MAZE: a 13x15 grid of corridors with pillars; all dots are reachable. Four power pellets sit in the corners.
GOAL: eat all dots (and power pellets) to win. Three lives — a ghost touching you (when not frightened) costs a life; lose all three and the run ends.
SCORING: dot +10, power pellet +50, eating a frightened ghost +200.
GHOSTS (3): "Chaser" greedily heads for your cell; "Ambusher" targets two cells ahead of you; "Drifter" wanders (seeded). After you eat a power pellet they turn blue ("frightened") for a few seconds, flee randomly, move slower, and become edible.
STRATEGY: bank corners and power pellets; lure ghosts together before eating a pellet to chain +200s; don't get cornered in a dead corridor; ghosts are slower while frightened — use that window to clear contested dots.`;

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

const MAZE = [
  '###### ######',
  '#o.........o#',
  '#.#.#.#.#.#.#',
  '#...........#',
  '#.#.#.#.#.#.#',
  '#...........#',
  '#.#.#.#.#.#.#',
  ' .....G..... ',
  '#.#.#.#.#.#.#',
  '#...........#',
  '#.#.#.#.#.#.#',
  '#...........#',
  '#.#.#.#.#.#.#',
  '#o...P.....o#',
  '###### ######',
];
const COLS = 13, ROWS = 15, CELL = 30;
const TUNNEL_ROW = 7, TUNNEL_COL = 6;   // edge-center wrap-around tunnels (left↔right, top↔bottom)
const OX = 0, OY = 120;                 // maze pixel offset (HUD above)
const PAC_MOVE = 7, GHOST_MOVE = 9, FRIGHT_MOVE = 15, FRIGHT_FRAMES = 360, RESPAWN = 45, LIVES = 3;
const DIRS = [{ x: 0, y: -1 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }]; // up,left,down,right (tie-break order)
const GHOST_SPAWN = [{ x: 4, y: 7 }, { x: 6, y: 7 }, { x: 8, y: 7 }];
const GHOST_COLOR = ['#ff5959', '#ff8ad6', '#59d2ff'];
const PAC_SPAWN = { x: 5, y: 13 };

function isWall(x, y) { return x < 0 || y < 0 || x >= COLS || y >= ROWS || MAZE[y][x] === '#'; }
// Move one cell, wrapping through the edge-center tunnels (left↔right at TUNNEL_ROW, top↔bottom at TUNNEL_COL).
function step(x, y, d) {
  let nx = x + d.x, ny = y + d.y;
  if (y === TUNNEL_ROW) { if (nx < 0) nx = COLS - 1; else if (nx >= COLS) nx = 0; }
  if (x === TUNNEL_COL) { if (ny < 0) ny = ROWS - 1; else if (ny >= ROWS) ny = 0; }
  return { x: nx, y: ny };
}

export function createGame(seed) {
  const rng = createPRNG(seed);

  // dot / power grids (power cells also count as dots for the win condition)
  const dot = [], power = [];
  let totalDots = 0;
  for (let y = 0; y < ROWS; y++) {
    dot.push([]); power.push([]);
    for (let x = 0; x < COLS; x++) {
      const c = MAZE[y][x];
      const isPower = c === 'o';
      const hasDot = c === '.' || isPower;
      dot[y].push(hasDot); power[y].push(isPower);
      if (hasDot) totalDots++;
    }
  }
  // clear dots under spawns
  for (const s of GHOST_SPAWN) if (dot[s.y][s.x]) { dot[s.y][s.x] = false; totalDots--; }

  const pac = { x: PAC_SPAWN.x, y: PAC_SPAWN.y, px: PAC_SPAWN.x, py: PAC_SPAWN.y, dir: { x: -1, y: 0 }, want: { x: -1, y: 0 }, t: 0 };
  const ghosts = GHOST_SPAWN.map((s, i) => ({ x: s.x, y: s.y, px: s.x, py: s.y, dir: { x: 0, y: -1 }, t: 0, kind: i }));

  let frame = 0, score = 0, eaten = 0, dotsEaten = 0, ghostsEaten = 0, deaths = 0, lives = LIVES;
  let fright = 0, respawn = 0, over = false, outcome = 'caught';

  function reset() {
    pac.x = pac.px = PAC_SPAWN.x; pac.y = pac.py = PAC_SPAWN.y; pac.dir = { x: -1, y: 0 }; pac.want = { x: -1, y: 0 }; pac.t = 0;
    ghosts.forEach((g, i) => { g.x = g.px = GHOST_SPAWN[i].x; g.y = g.py = GHOST_SPAWN[i].y; g.dir = { x: 0, y: -1 }; g.t = 0; });
    fright = 0; respawn = RESPAWN;
  }

  function openDirs(x, y, from) {
    const out = [];
    for (const d of DIRS) {
      if (from && d.x === -from.x && d.y === -from.y) continue;    // don't reverse
      const n = step(x, y, d);
      if (!isWall(n.x, n.y)) out.push(d);
    }
    return out.length ? out : DIRS.filter(d => { const n = step(x, y, d); return !isWall(n.x, n.y); }); // dead-end: allow reverse
  }
  const dist = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);

  function movePac() {
    const w = step(pac.x, pac.y, pac.want);
    if (!isWall(w.x, w.y)) pac.dir = pac.want;
    const n = step(pac.x, pac.y, pac.dir);
    if (isWall(n.x, n.y)) return;                                   // blocked, stay
    pac.px = pac.x; pac.py = pac.y;
    pac.x = n.x; pac.y = n.y;
    if (dot[pac.y][pac.x]) {
      dot[pac.y][pac.x] = false; eaten++; dotsEaten++;
      if (power[pac.y][pac.x]) { score += 50; fright = FRIGHT_FRAMES; } else { score += 10; }
    }
  }

  function moveGhost(g) {
    const opts = openDirs(g.x, g.y, g.dir);
    let choice;
    if (fright > 0) {
      choice = opts[Math.floor(rng.next() * opts.length)];          // frightened: wander (seeded)
    } else if (g.kind === 2) {
      choice = opts[Math.floor(rng.next() * opts.length)];          // drifter: seeded wander
    } else {
      const tx = g.kind === 1 ? pac.x + pac.dir.x * 2 : pac.x;       // ambusher targets ahead
      const ty = g.kind === 1 ? pac.y + pac.dir.y * 2 : pac.y;
      let best = Infinity;
      for (const d of opts) {                                        // greedy toward target, DIRS tie-break
        const n = step(g.x, g.y, d);
        const dd = dist(n.x, n.y, tx, ty);
        if (dd < best) { best = dd; choice = d; }
      }
    }
    g.dir = choice; g.px = g.x; g.py = g.y;
    const gn = step(g.x, g.y, choice); g.x = gn.x; g.y = gn.y;
  }

  function collide() {
    for (const g of ghosts) {
      if (g.x === pac.x && g.y === pac.y) {
        if (fright > 0) { score += 200; ghostsEaten++; g.x = g.px = GHOST_SPAWN[g.kind].x; g.y = g.py = GHOST_SPAWN[g.kind].y; g.dir = { x: 0, y: -1 }; g.t = 0; }
        else { deaths++; lives--; if (lives <= 0) { over = true; outcome = 'caught'; } else reset(); return; }
      }
    }
  }

  return {
    update(input) {
      if (over) return;
      frame++;
      if (input) {
        const ax = input.dx || 0, ay = input.dy || 0;
        if (Math.abs(ax) > Math.abs(ay)) { if (ax > 0.3) pac.want = { x: 1, y: 0 }; else if (ax < -0.3) pac.want = { x: -1, y: 0 }; }
        else if (Math.abs(ay) > 0.3) { pac.want = { x: 0, y: ay > 0 ? 1 : -1 }; }
      }
      if (respawn > 0) { respawn--; return; }
      if (fright > 0) fright--;
      if (++pac.t >= PAC_MOVE) { pac.t = 0; movePac(); }
      const gspd = fright > 0 ? FRIGHT_MOVE : GHOST_MOVE;
      for (const g of ghosts) if (++g.t >= gspd) { g.t = 0; moveGhost(g); }
      collide();
      if (eaten >= totalDots) { over = true; outcome = 'victory'; }
    },

    isOver() { return over; },

    getState() { return { phase: 'PLAY', score, lives, dotsLeft: totalDots - eaten }; },

    getResult() {
      return { score, dotsEaten, ghostsEaten, deaths, livesLeft: Math.max(0, lives), elapsed: Math.round(frame / 60 * 10) / 10, outcome };
    },

    render(ctx, W, H) {
      ctx.fillStyle = '#06070d'; ctx.fillRect(0, 0, W, H);
      // HUD
      ctx.fillStyle = '#ffe14d'; ctx.font = 'bold 20px system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('SCORE ' + score, 14, 44);
      ctx.textAlign = 'right';
      for (let i = 0; i < lives; i++) { ctx.beginPath(); ctx.fillStyle = '#ffe14d'; ctx.arc(W - 20 - i * 26, 38, 9, 0.25 * Math.PI, 1.75 * Math.PI); ctx.lineTo(W - 20 - i * 26, 38); ctx.fill(); }
      // maze
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
        const cx = OX + x * CELL, cy = OY + y * CELL;
        if (MAZE[y][x] === '#') {
          ctx.fillStyle = '#1b2c66'; ctx.fillRect(cx + 3, cy + 3, CELL - 6, CELL - 6);
          ctx.fillStyle = '#3a5bd0'; ctx.fillRect(cx + 6, cy + 6, CELL - 12, CELL - 12);
        } else if (dot[y][x]) {
          if (power[y][x]) { ctx.fillStyle = '#ffd24d'; ctx.beginPath(); ctx.arc(cx + CELL / 2, cy + CELL / 2, 6 + Math.sin(frame * 0.2) * 1.5, 0, 7); ctx.fill(); }
          else { ctx.fillStyle = '#ffd9a0'; ctx.beginPath(); ctx.arc(cx + CELL / 2, cy + CELL / 2, 2.5, 0, 7); ctx.fill(); }
        }
      }
      // ghosts
      const gf = fright > 0;
      ghosts.forEach((g) => {
        const f = (Math.abs(g.x - g.px) > 1 || Math.abs(g.y - g.py) > 1) ? 1 : g.t / (gf ? FRIGHT_MOVE : GHOST_MOVE);
        const gx = OX + (g.px + (g.x - g.px) * f) * CELL + CELL / 2;
        const gy = OY + (g.py + (g.y - g.py) * f) * CELL + CELL / 2;
        ctx.fillStyle = gf ? (fright < 90 && (frame >> 3) % 2 ? '#e8eaf0' : '#3a5bd0') : GHOST_COLOR[g.kind];
        ctx.beginPath(); ctx.arc(gx, gy, 11, Math.PI, 0); ctx.lineTo(gx + 11, gy + 11); ctx.lineTo(gx - 11, gy + 11); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(gx - 4, gy - 2, 3, 0, 7); ctx.arc(gx + 4, gy - 2, 3, 0, 7); ctx.fill();
      });
      // pac
      const pf = (Math.abs(pac.x - pac.px) > 1 || Math.abs(pac.y - pac.py) > 1) ? 1 : pac.t / PAC_MOVE;
      const cx = OX + (pac.px + (pac.x - pac.px) * pf) * CELL + CELL / 2;
      const cy = OY + (pac.py + (pac.y - pac.py) * pf) * CELL + CELL / 2;
      const mouth = (Math.abs(Math.sin(frame * 0.25)) * 0.28);
      const a = Math.atan2(pac.dir.y, pac.dir.x);
      ctx.fillStyle = '#ffe14d'; ctx.beginPath();
      ctx.moveTo(cx, cy); ctx.arc(cx, cy, 12, a + mouth * Math.PI, a - mouth * Math.PI + 2 * Math.PI); ctx.closePath(); ctx.fill();
    },
  };
}
