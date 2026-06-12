// Pong — the original video game, deterministic, for GameFilm.
// Portrait: your paddle at the BOTTOM (drag it), the AI defends the TOP, the ball rallies between.
// Self-contained, zero imports. Same seed + inputs = same game (server-verified).
// The default template — a clean, minimal starting point (and a natural on-ramp to Bricks).

export const GAME_META = {
  name: 'Pong',
  description: 'The original. Drag your paddle along the bottom to keep the ball in play; the AI guards the top. First to 7 wins.',
  icon: '/play/pong/favicon.svg',
  seedOffset: 21000000,
  input: { type: 'paddle' },
  canvas: { width: 390, height: 844 },
  levels: [{ name: 'Rally', parTime: 60 }],
  result: {
    fields: ['score', 'aiScore', 'rallies', 'longestRally', 'elapsed', 'outcome'],
    outcomes: ['win', 'lose'],
  },
  cardStats: [
    { key: 'score', label: 'You' },
    { key: 'aiScore', label: 'CPU' },
    { key: 'longestRally', label: 'Best Rally', compact: 'R' },
  ],
};

export const ENGINE_VERSION = 1;

export const SCHEMA = `GAME: Pong — the original video game, deterministic. Same seed + inputs reproduce the exact rally; the score is server-verified from the replay.
LAYOUT (portrait): your paddle slides along the BOTTOM (you control its X by dragging); the AI paddle guards the TOP and tracks the ball. The ball rallies vertically between them and bounces off the side walls.
GOAL: get the ball past the AI to score; if it gets past you, the AI scores. First to 7 wins.
PHYSICS: every paddle hit speeds the ball up slightly and adds "english" based on where on the paddle it lands (hit it off-center to angle your return). Serves use the seed.
STRATEGY: meet the ball with the edge of the paddle to angle returns past the AI; the AI is fast but has a capped speed, so a sharp cross-court angle can beat it; longer rallies mean a faster ball — stay centered and ready.`;

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

const W = 390, H = 844;
const PADDLE_W = 74, PADDLE_H = 12, BALL_R = 8;
const PLAYER_Y = H - 70, AI_Y = 58;        // paddle top edges
const AI_SPEED = 3.6, BASE_SPEED = 5.2, MAX_VX = 6.5, SPEEDUP = 1.04, SERVE_PAUSE = 36, WIN = 7;
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const HALF = PADDLE_W / 2;

export function createGame(seed) {
  const rng = createPRNG(seed);
  let playerX = W / 2, aiX = W / 2;
  const ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
  let score = 0, aiScore = 0, rallies = 0, longestRally = 0, rally = 0;
  let frame = 0, serveTimer = 0, over = false, outcome = 'lose';

  function serve(toPlayer) {
    ball.x = W / 2; ball.y = H / 2;
    const ang = (rng.next() - 0.5) * 0.7;
    ball.vx = Math.sin(ang) * BASE_SPEED;
    ball.vy = (toPlayer ? 1 : -1) * Math.abs(Math.cos(ang)) * BASE_SPEED;
    rally = 0; serveTimer = SERVE_PAUSE;
  }
  function bounce(paddleX, up) {
    ball.vy = (up ? -1 : 1) * Math.abs(ball.vy) * SPEEDUP;
    ball.vx = clamp(ball.vx + (ball.x - paddleX) / HALF * 2, -MAX_VX, MAX_VX);
    rally++; rallies++; if (rally > longestRally) longestRally = rally;
  }
  serve(true);

  return {
    update(input) {
      if (over) return;
      frame++;
      const px = (typeof input === 'number') ? input : (input && typeof input.x === 'number' ? input.x : playerX);
      playerX = clamp(px, HALF, W - HALF);
      aiX = clamp(aiX + clamp(ball.x - aiX, -AI_SPEED, AI_SPEED), HALF, W - HALF);  // AI tracks ball (capped)

      if (serveTimer > 0) { serveTimer--; return; }
      ball.x += ball.vx; ball.y += ball.vy;

      if (ball.x < BALL_R) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx); }
      else if (ball.x > W - BALL_R) { ball.x = W - BALL_R; ball.vx = -Math.abs(ball.vx); }

      if (ball.vy > 0 && ball.y + BALL_R >= PLAYER_Y && ball.y < PLAYER_Y + PADDLE_H && Math.abs(ball.x - playerX) <= HALF + BALL_R) {
        ball.y = PLAYER_Y - BALL_R; bounce(playerX, true);
      } else if (ball.vy < 0 && ball.y - BALL_R <= AI_Y + PADDLE_H && ball.y > AI_Y && Math.abs(ball.x - aiX) <= HALF + BALL_R) {
        ball.y = AI_Y + PADDLE_H + BALL_R; bounce(aiX, false);
      }

      if (ball.y > H + BALL_R) { aiScore++; if (aiScore >= WIN) { over = true; outcome = 'lose'; } else serve(true); }
      else if (ball.y < -BALL_R) { score++; if (score >= WIN) { over = true; outcome = 'win'; } else serve(false); }
    },

    isOver() { return over; },
    getState() { return { phase: 'PLAY', score, aiScore }; },
    getResult() {
      return { score, aiScore, rallies, longestRally, elapsed: Math.round(frame / 60 * 10) / 10, outcome };
    },

    render(ctx, W, H) {
      ctx.fillStyle = '#06070d'; ctx.fillRect(0, 0, W, H);
      // center net
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 3; ctx.setLineDash([10, 12]);
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke(); ctx.setLineDash([]);
      // scores
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.font = 'bold 64px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(String(aiScore), W / 2, H / 2 - 40);
      ctx.fillText(String(score), W / 2, H / 2 + 96);
      // paddles
      ctx.fillStyle = '#79f4ff'; ctx.fillRect(aiX - HALF, AI_Y, PADDLE_W, PADDLE_H);
      ctx.fillStyle = '#ffe14d'; ctx.fillRect(playerX - HALF, PLAYER_Y, PADDLE_W, PADDLE_H);
      // ball
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ball.x, ball.y, BALL_R, 0, 7); ctx.fill();
    },
  };
}
