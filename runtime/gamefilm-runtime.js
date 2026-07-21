// GameFilm Runtime — wraps any conforming game.js with full platform integration.
// The game developer writes game logic + rendering. This handles everything else.

import { GameFilm, createRecorder, createTimeline, createGameLoop, createPRNG } from './gamefilm.js';
import * as centralAudio from './gamefilm-audio.js';
// A game may ship its own audio module at games/<slug>/audio.js exporting the same
// interface (startBGM/stopBGM/toggleBGM/toggleSFX/isBGMMuted/isSFXMuted/init) plus an
// optional onSnapshot(snap, prevSnap) for custom SFX. Defaults to the central module;
// boot() swaps it in if present. All `audio.X` calls below resolve to this binding.
let audio = centralAudio;

const BITMASK_KEYS = {
  ArrowLeft: 1, KeyA: 1,
  ArrowRight: 2, KeyD: 2,
  ArrowUp: 4, KeyW: 4,
  ArrowDown: 8, KeyS: 8,
  Space: 16,
};

function createBitmaskInput() {
  let bitmask = 0;
  document.addEventListener('keydown', e => {
    if (BITMASK_KEYS[e.code]) { bitmask |= BITMASK_KEYS[e.code]; e.preventDefault(); }
  });
  document.addEventListener('keyup', e => {
    if (BITMASK_KEYS[e.code]) bitmask &= ~BITMASK_KEYS[e.code];
  });
  return { read() { return bitmask; }, type: 'bitmask' };
}

function createPaddleInput(canvas, gameW, scale) {
  let paddleX = gameW / 2;
  let shaking = false;

  function onMove(clientX) {
    const rect = canvas.getBoundingClientRect();
    paddleX = Math.max(0, Math.min(gameW, (clientX - rect.left) * scale));
  }

  canvas.addEventListener('mousemove', e => onMove(e.clientX));
  canvas.addEventListener('touchmove', e => { e.preventDefault(); onMove(e.touches[0].clientX); }, { passive: false });
  canvas.addEventListener('touchstart', e => { e.preventDefault(); onMove(e.touches[0].clientX); }, { passive: false });
  document.addEventListener('keydown', e => { if (e.code === 'KeyK' || e.code === 'ShiftLeft') shaking = true; });
  document.addEventListener('keyup', e => { if (e.code === 'KeyK' || e.code === 'ShiftLeft') shaking = false; });

  return {
    read() { return shaking ? { x: Math.round(paddleX), k: 1 } : Math.round(paddleX); },
    type: 'paddle',
  };
}

function createJoystickInput(canvas, gameW, gameH, getScale, meta) {
  let dx = 0, dy = 0;
  let joystickId = null;
  let joystickOrigin = null;
  let joystickMoved = false;
  let tapBtn = 0;
  let tapX = -1, tapY = -1;
  let onUiTap = null;
  const DEAD_ZONE = 14;
  const MAX_DIST = 80;

  function toGameCoords(t) {
    const rect = canvas.getBoundingClientRect();
    const s = typeof getScale === 'function' ? getScale() : getScale;
    return { gx: (t.clientX - rect.left) * s, gy: (t.clientY - rect.top) * s };
  }

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const { gx, gy } = toGameCoords(t);
      tapX = gx; tapY = gy;
      if (onUiTap && onUiTap(gx, gy)) continue;
      if (joystickId === null) {
        joystickId = t.identifier;
        joystickOrigin = { x: t.clientX, y: t.clientY, gx, gy };
        joystickMoved = false;
      } else {
        tapBtn = gx < gameW / 2 ? 2 : 1;
      }
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === joystickId && joystickOrigin) {
        const rawDx = t.clientX - joystickOrigin.x;
        const rawDy = t.clientY - joystickOrigin.y;
        const dist = Math.sqrt(rawDx * rawDx + rawDy * rawDy);
        if (dist < DEAD_ZONE) { dx = 0; dy = 0; }
        else {
          joystickMoved = true;
          const clamped = Math.min(dist, MAX_DIST);
          dx = Math.round((rawDx / dist) * (clamped / MAX_DIST) * 1000) / 1000;
          dy = Math.round((rawDy / dist) * (clamped / MAX_DIST) * 1000) / 1000;
        }
      }
    }
  }, { passive: false });

  canvas.addEventListener('touchend', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === joystickId) {
        if (!joystickMoved) {
          const gx = joystickOrigin.gx, gy = joystickOrigin.gy;
          tapBtn = gx < gameW / 2 ? 2 : 1;
        }
        joystickId = null;
        joystickOrigin = null;
        joystickMoved = false;
        dx = 0;
        dy = 0;
      }
    }
  });

  const keys = {};
  const keyEdges = {};
  const discrete = meta?.input?.discreteMove;
  const GAME_KEYS = new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyA','KeyD','KeyW','KeyS','Space','KeyJ','KeyK','KeyH']);
  document.addEventListener('keydown', e => {
    if (!keys[e.code]) keyEdges[e.code] = true;
    keys[e.code] = true;
    if (GAME_KEYS.has(e.code)) e.preventDefault();
  });
  document.addEventListener('keyup', e => { keys[e.code] = false; });

  return {
    read() {
      let kdx = 0, kdy = 0;
      if (discrete) {
        if (keyEdges['ArrowLeft'] || keyEdges['KeyA']) kdx -= 1;
        if (keyEdges['ArrowRight'] || keyEdges['KeyD']) kdx += 1;
        keyEdges['ArrowLeft'] = false;
        keyEdges['ArrowRight'] = false;
        keyEdges['KeyA'] = false;
        keyEdges['KeyD'] = false;
        if (keys['ArrowUp'] || keys['KeyW']) kdy -= 1;
        if (keys['ArrowDown'] || keys['KeyS']) kdy += 1;
      } else {
        if (keys['ArrowLeft'] || keys['KeyA']) kdx -= 1;
        if (keys['ArrowRight'] || keys['KeyD']) kdx += 1;
        if (keys['ArrowUp'] || keys['KeyW']) kdy -= 1;
        if (keys['ArrowDown'] || keys['KeyS']) kdy += 1;
      }

      let kb = 0;
      if (discrete) {
        if (keys['Space'] || keys['KeyK']) kb |= 1;
        if (keys['KeyJ']) kb |= 2;
      } else {
        if (keys['Space'] || keys['KeyJ']) kb |= 1;
        if (keys['KeyK']) kb |= 2;
      }
      if (keys['KeyH']) kb |= 4;

      const tb = tapBtn;
      tapBtn = 0;
      const tx = tapX, ty = tapY;
      tapX = -1; tapY = -1;

      const fdx = kdx || dx;
      const fdy = kdy || dy;
      const jo = joystickOrigin;
      return { dx: Math.round(fdx * 1000) / 1000, dy: Math.round(fdy * 1000) / 1000, b: kb | tb, tapX: tx, tapY: ty, touchActive: jo != null, touchOX: jo ? jo.gx : -1, touchOY: jo ? jo.gy : -1 };
    },
    setUiTapHandler(fn) { onUiTap = fn; },
    injectTap(gx, gy) { tapX = gx; tapY = gy; },
    type: 'joystick',
  };
}

function setupCanvas(root, meta) {
  const W = meta.canvas?.width || 390;
  const H = meta.canvas?.height || 844;

  const wrapper = document.createElement('div');
  wrapper.id = 'gf-canvas-wrap';
  root.appendChild(wrapper);

  const canvas = document.createElement('canvas');
  canvas.id = 'gf-canvas';
  canvas.width = W;
  canvas.height = H;
  wrapper.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  let scale = 1;
  function resize() {
    const r = W / H;
    const vw = window.innerWidth, vh = window.innerHeight;
    let cw, ch;
    if (vw / vh > r) { ch = vh; cw = ch * r; } else { cw = vw; ch = cw / r; }
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    scale = W / cw;
  }
  resize();
  window.addEventListener('resize', resize);

  return { canvas, ctx, W, H, getScale: () => scale };
}

function showOverlay(root, message, returnUrl) {
  const overlay = document.createElement('div');
  overlay.id = 'gf-overlay';
  overlay.innerHTML = `
    <div class="gf-overlay-content">
      <div class="gf-overlay-message">${message}</div>
      ${returnUrl ? `<a href="${returnUrl}" class="gf-overlay-btn">Return to Hub</a>` : ''}
      <button class="gf-overlay-btn gf-replay-btn" style="display:none">Play Again</button>
    </div>
  `;
  root.appendChild(overlay);
  return overlay;
}

function showStatus(root, text) {
  let el = root.querySelector('#gf-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'gf-status';
    root.appendChild(el);
  }
  el.textContent = text;
}

function drawWatermarks(ctx, W, H, now) {
  ctx.font = 'bold 22px "Courier New", monospace';
  ctx.textAlign = 'center';
  const positions = [
    [W * 0.5, 100, 0],
    [W * 0.25, 300, 1.2],
    [W * 0.75, 460, 2.4],
    [W * 0.4, 620, 3.6],
    [W * 0.6, 780, 4.8],
  ];
  for (const [x, y, phase] of positions) {
    const a = 0.14 + 0.06 * Math.sin((now || 0) * 0.003 + phase);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.3);
    ctx.fillStyle = `rgba(106,106,240,${a})`;
    ctx.fillText('REPLAY', 0, 0);
    ctx.restore();
  }
}

function fmtTime(frames) {
  const secs = Math.floor(frames / 60);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function createSeekBar(root, totalFrames, onSeek) {
  const bar = document.createElement('div');
  bar.id = 'gf-seek';
  bar.innerHTML = '<button class="gf-speed-btn">1x</button><div class="gf-seek-track"><div class="gf-seek-fill"><div class="gf-seek-thumb"></div></div></div><div class="gf-seek-time">0:00 / ' + fmtTime(totalFrames) + '</div>';
  root.appendChild(bar);

  const track = bar.querySelector('.gf-seek-track');
  const fill = bar.querySelector('.gf-seek-fill');
  const timeEl = bar.querySelector('.gf-seek-time');
  const totalTime = fmtTime(totalFrames);
  let dragging = false;

  function updateFromEvent(e) {
    const rect = track.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const frame = Math.round(pct * totalFrames);
    fill.style.width = (pct * 100) + '%';
    timeEl.textContent = fmtTime(frame) + ' / ' + totalTime;
    onSeek(frame);
  }

  track.addEventListener('mousedown', e => { dragging = true; updateFromEvent(e); });
  document.addEventListener('mousemove', e => { if (dragging) updateFromEvent(e); });
  document.addEventListener('mouseup', () => { dragging = false; });
  track.addEventListener('touchstart', e => { e.preventDefault(); updateFromEvent(e); }, { passive: false });
  track.addEventListener('touchmove', e => { e.preventDefault(); updateFromEvent(e); }, { passive: false });

  const speedBtn = bar.querySelector('.gf-speed-btn');

  return {
    update(frame) {
      fill.style.width = ((frame / totalFrames) * 100) + '%';
      timeEl.textContent = fmtTime(frame) + ' / ' + totalTime;
    },
    speedBtn,
  };
}

async function runLiveGame(root, gameMod, seed, input, canvasState) {
  const { ctx, W, H } = canvasState;
  const game = gameMod.createGame(seed);
  const initSnap = typeof game.getState === 'function' ? game.getState() : null;
  if (initSnap?.phase && initSnap.phase !== 'PLAY') document.body.classList.add('gf-title');
  const recorder = createRecorder();
  const timeline = createTimeline(30);

  let done = false;
  let result = null;
  let prevSnap = null;
  let paused = false;
  let gameOverFrame = 0;
  let submitState = null; // null | 'sending' | 'sent' | 'error' | 'saved-offline'
  let submitted = false;
  let sendingStartedAt = 0;
  let uploadProgress = 0;   // 0..1, bytes leaving the device
  let uploadPhase = 'uploading'; // 'uploading' | 'finalizing'
  function onUploadProgress(frac, phase) { uploadProgress = frac; uploadPhase = phase; }

  function setPaused(v) { paused = v; document.body.classList.toggle('gf-paused', v); }

  document.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') { setPaused(!paused); e.preventDefault(); }
  });

  const { canvas } = canvasState;
  window.gamePause = () => { setPaused(true); };
  window.gameResume = () => { setPaused(false); };

  const returnUrl = GameFilm.getReturnUrl();

  function retrySubmit() {
    submitState = 'sending';
    sendingStartedAt = performance.now();
    uploadProgress = 0; uploadPhase = 'uploading';
    const extra = {};
    if (prevSnap?.sensitivity !== undefined) extra.sensitivity = prevSnap.sensitivity;
    GameFilm.submitResults({ seed, frames: recorder.getFrames(), score: result.score, timeline: timeline.getEntries(), onProgress: onUploadProgress, ...extra })
      .then(() => { submitState = 'sent'; })
      .catch(e => { submitState = (e?.offline || !navigator.onLine) ? 'saved-offline' : 'error'; });
  }

  function hitButton(gx, gy) {
    if (done && (submitState === 'error' || submitState === 'saved-offline')) {
      const retryBtnW = Math.round(W * 0.5);
      const retryBtnH = 36;
      const retryBtnX = (W - retryBtnW) / 2;
      const retryBtnY = Math.round(H * 0.56);
      if (gx >= retryBtnX && gx <= retryBtnX + retryBtnW && gy >= retryBtnY && gy <= retryBtnY + retryBtnH) {
        retrySubmit();
        return true;
      }
      if (returnUrl) {
        const retBtnW = Math.round(W * 0.55);
        const retBtnH = 36;
        const retBtnX = (W - retBtnW) / 2;
        const retBtnY = Math.round(H * 0.64);
        if (gx >= retBtnX && gx <= retBtnX + retBtnW && gy >= retBtnY && gy <= retBtnY + retBtnH) {
          window.location.href = returnUrl;
          return true;
        }
      }
      return false;
    }
    if (done && returnUrl && gameOverFrame >= 60 && (submitState === 'sent' || submitState === 'done' || submitState === 'sending')) {
      const btnW = Math.round(W * 0.55);
      const btnH = 36;
      const btnX = (W - btnW) / 2;
      const btnY = Math.round(H * 0.565);
      if (gx >= btnX && gx <= btnX + btnW && gy >= btnY && gy <= btnY + btnH) {
        window.location.href = returnUrl;
        return true;
      }
      return false;
    }
    if (paused) { setPaused(false); return true; }
    const barY = H - 22;
    if (gy > barY - 18 && gy < barY + 18) {
      if (gx > W - 96 && gx < W - 64) { setPaused(!paused); return true; }
      if (gx > W - 60 && gx < W - 32) { audio.toggleBGM(); return true; }
      if (gx > W - 28 && gx < W) { audio.toggleSFX(); return true; }
    }
    return false;
  }

  if (input.setUiTapHandler) input.setUiTapHandler(hitButton);

  let lastTouchTime = 0;
  canvas.addEventListener('touchstart', () => { lastTouchTime = Date.now(); }, { passive: true });
  canvas.addEventListener('click', e => {
    if (Date.now() - lastTouchTime < 500) return;
    const rect = canvas.getBoundingClientRect();
    const s = W / rect.width;
    const gx = (e.clientX - rect.left) * s, gy = (e.clientY - rect.top) * s;
    if (!hitButton(gx, gy) && input.injectTap) input.injectTap(gx, gy);
  });

  const loop = createGameLoop({
    fps: 60,
    update() {
      if (done) {
        gameOverFrame++;
        if (!submitted) {
          submitted = true;
          if (GameFilm.hasCallback()) {
            submitState = 'sending';
            sendingStartedAt = performance.now();
            uploadProgress = 0; uploadPhase = 'uploading';
            const extra = {};
            if (prevSnap?.sensitivity !== undefined) extra.sensitivity = prevSnap.sensitivity;
            GameFilm.submitResults({ seed, frames: recorder.getFrames(), score: result.score, timeline: timeline.getEntries(), onProgress: onUploadProgress, ...extra })
              .then(() => { submitState = 'sent'; })
              .catch(e => { submitState = (e?.offline || !navigator.onLine) ? 'saved-offline' : 'error'; });
          } else {
            submitState = 'done';
          }
        }
        return;
      }
      if (paused) return;
      const inputState = input.read();

      const prevPhase = prevSnap?.phase;
      game.update(inputState);

      const snap = typeof game.getState === 'function' ? game.getState() : { score: game.getResult().score };

      // Per-game event-driven audio (e.g. bricks): forward the game's frame sound
      // events to the per-game audio module. Fires in every phase (title + play).
      if (typeof audio.onSfx === 'function' && typeof game.getSfx === 'function') audio.onSfx(game.getSfx());

      if (snap.wantsReturn && returnUrl) {
        window.location.href = returnUrl;
        return;
      }

      if (snap.phase && snap.phase !== 'PLAY') {
        document.body.classList.add('gf-title');
        prevSnap = { ...snap };
        return;
      }

      if (prevPhase && prevPhase !== 'PLAY') {
        document.body.classList.remove('gf-title');
        prevSnap = { ...snap };
        return;
      }

      if (input.type === 'joystick') {
        recorder.recordJoystick(inputState.dx, inputState.dy, inputState.b, inputState.tapX, inputState.tapY);
      } else {
        recorder.record(inputState);
      }

      timeline.tick(snap);

      if (typeof game.getEvents === 'function') {
        const events = game.getEvents();
        if (events) for (const ev of events) timeline.forceSnapshot(ev);
      }

      if (snap.wantsNav) {
        window.open(snap.wantsNav, '_blank');
      }

      if (prevSnap) {
        if (typeof audio.onSnapshot === 'function') {
          // Per-game audio maps its own state deltas to its own SFX palette.
          audio.onSnapshot(snap, prevSnap);
        } else if (audio === centralAudio) {
          // Built-in puzzle-SFX deltas only apply to the central audio module.
          // A per-game audio module (e.g. bricks) owns its SFX entirely via onSfx,
          // and may expose snapshot fields (like `level`) that would otherwise call
          // central-only functions (sfxLevelUp) it doesn't implement.
          if (snap.moveCount !== undefined && snap.moveCount > prevSnap.moveCount) audio.sfxMove();
          if (snap.rotateCount !== undefined && snap.rotateCount > prevSnap.rotateCount) audio.sfxRotate();
          if (snap.hardDropCount !== undefined && snap.hardDropCount > prevSnap.hardDropCount) audio.sfxHardDrop();
          if (snap.lockCount !== undefined && snap.lockCount > prevSnap.lockCount) audio.sfxLock();
          if (snap.holdCount !== undefined && snap.holdCount > (prevSnap.holdCount || 0)) audio.sfxHold();
          if (snap.clearingCount > 0 && !(prevSnap.clearingCount > 0)) {
            audio.sfxClear(snap.clearingCount);
          }
          if (snap.perfectClears !== undefined && snap.perfectClears > (prevSnap.perfectClears || 0)) audio.sfxPerfectClear();
          if (snap.level !== undefined && snap.level > prevSnap.level) audio.sfxLevelUp();
          if (snap.combo !== undefined && snap.combo > 1 && snap.combo > (prevSnap.combo || 0)) audio.sfxCombo();
        }
      }
      prevSnap = { ...snap };

      if (game.isOver()) {
        done = true;
        result = game.getResult();
        // The run is saved locally the instant it ends (persist-first). Show 'SAVING…' while
        // the background upload runs — the score stays visible. Submit kicks off next tick.
        if (GameFilm.hasCallback()) submitState = 'sending';
        // Central audio fires game-over from here; a per-game audio module owns
        // its own SFX (incl. game-over/victory) via the game's own event stream.
        if (audio === centralAudio) audio.sfxGameOver();
        audio.stopBGM?.();
      }
    },
    render() {
      game.render(ctx, W, H);

      if (!GameFilm.isRanked()) {
        ctx.save();
        ctx.font = 'bold 11px "Courier New", monospace';
        ctx.fillStyle = 'rgba(255, 100, 60, 0.6)';
        ctx.textAlign = 'left';
        ctx.fillText('UNRANKED', 8, 16);
        ctx.restore();
      }

      const sndR = 12;
      const sndY = H - 22;
      for (const [x, muted] of [[W - 46, audio.isBGMMuted()], [W - 14, audio.isSFXMuted()]]) {
        if (muted) {
          ctx.strokeStyle = 'rgba(255,80,80,0.4)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x - sndR + 3, sndY + sndR - 3);
          ctx.lineTo(x + sndR - 3, sndY - sndR + 3);
          ctx.stroke();
        }
      }

      if (done && result) {
        ctx.textAlign = 'center';
        if (submitState === 'saved-offline') {
          ctx.fillStyle = 'rgba(10, 11, 16, 0.95)';
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = '#f0c040';
          ctx.font = `bold ${Math.round(W * 0.045)}px "Courier New", monospace`;
          ctx.fillText('SCORE SAVED OFFLINE', W / 2, H * 0.38);
          ctx.fillStyle = '#888';
          ctx.font = `${Math.round(W * 0.03)}px "Courier New", monospace`;
          ctx.fillText('Your score is stored locally and', W / 2, H * 0.44);
          ctx.fillText('will sync automatically when online.', W / 2, H * 0.48);
          const retryBtnW = Math.round(W * 0.5);
          const retryBtnH = 36;
          const retryBtnX = (W - retryBtnW) / 2;
          const retryBtnY = Math.round(H * 0.56);
          ctx.strokeStyle = '#f0c040';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(retryBtnX, retryBtnY, retryBtnW, retryBtnH);
          ctx.fillStyle = 'rgba(240,192,64,0.08)';
          ctx.fillRect(retryBtnX, retryBtnY, retryBtnW, retryBtnH);
          ctx.fillStyle = '#f0c040';
          ctx.font = 'bold 14px "Courier New", monospace';
          ctx.textBaseline = 'middle';
          ctx.fillText('RETRY NOW', W / 2, retryBtnY + retryBtnH / 2);
          ctx.textBaseline = 'alphabetic';
          if (returnUrl) {
            const retBtnW = Math.round(W * 0.55);
            const retBtnH = 36;
            const retBtnX = (W - retBtnW) / 2;
            const retBtnY = Math.round(H * 0.64);
            ctx.strokeStyle = '#6a6af0';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(retBtnX, retBtnY, retBtnW, retBtnH);
            ctx.fillStyle = 'rgba(106,106,240,0.08)';
            ctx.fillRect(retBtnX, retBtnY, retBtnW, retBtnH);
            ctx.fillStyle = '#6a6af0';
            ctx.font = 'bold 14px "Courier New", monospace';
            ctx.textBaseline = 'middle';
            ctx.fillText('RETURN TO GAMEFILM', W / 2, retBtnY + retBtnH / 2);
            ctx.textBaseline = 'alphabetic';
          }
        } else if (submitState === 'error') {
          ctx.fillStyle = 'rgba(10, 11, 16, 0.95)';
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = '#FF4444';
          ctx.font = `bold ${Math.round(W * 0.045)}px "Courier New", monospace`;
          ctx.fillText('SCORE SUBMISSION FAILED', W / 2, H * 0.38);
          ctx.fillStyle = '#888';
          ctx.font = `${Math.round(W * 0.03)}px "Courier New", monospace`;
          ctx.fillText('Your score was saved locally and', W / 2, H * 0.44);
          ctx.fillText('will retry automatically next visit.', W / 2, H * 0.48);
          const retryBtnW = Math.round(W * 0.5);
          const retryBtnH = 36;
          const retryBtnX = (W - retryBtnW) / 2;
          const retryBtnY = Math.round(H * 0.56);
          ctx.strokeStyle = '#FF6644';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(retryBtnX, retryBtnY, retryBtnW, retryBtnH);
          ctx.fillStyle = 'rgba(255,102,68,0.08)';
          ctx.fillRect(retryBtnX, retryBtnY, retryBtnW, retryBtnH);
          ctx.fillStyle = '#FF6644';
          ctx.font = 'bold 14px "Courier New", monospace';
          ctx.textBaseline = 'middle';
          ctx.fillText('RETRY', W / 2, retryBtnY + retryBtnH / 2);
          ctx.textBaseline = 'alphabetic';
          if (returnUrl) {
            const retBtnW = Math.round(W * 0.55);
            const retBtnH = 36;
            const retBtnX = (W - retBtnW) / 2;
            const retBtnY = Math.round(H * 0.64);
            ctx.strokeStyle = '#6a6af0';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(retBtnX, retBtnY, retBtnW, retBtnH);
            ctx.fillStyle = 'rgba(106,106,240,0.08)';
            ctx.fillRect(retBtnX, retBtnY, retBtnW, retBtnH);
            ctx.fillStyle = '#6a6af0';
            ctx.font = 'bold 14px "Courier New", monospace';
            ctx.textBaseline = 'middle';
            ctx.fillText('RETURN TO GAMEFILM', W / 2, retBtnY + retBtnH / 2);
            ctx.textBaseline = 'alphabetic';
          }
        } else if (submitState === 'sent' || submitState === 'done' || submitState === 'sending') {
          // Score stays visible (game.render drew it). Small status; the run is already saved
          // locally the instant it ended (persist-first), so the upload is background-only.
          if (submitState === 'sending') {
            ctx.fillStyle = '#888';
            ctx.font = '12px "Courier New", monospace';
            ctx.fillText('SAVING…', W / 2, H * 0.515);
          } else if (submitState === 'sent') {
            ctx.fillStyle = '#00FF88';
            ctx.font = '12px "Courier New", monospace';
            ctx.fillText('SCORE SAVED', W / 2, H * 0.515);
          }
          if (returnUrl && gameOverFrame >= 60) {
            const btnW = Math.round(W * 0.55);
            const btnH = 36;
            const btnX = (W - btnW) / 2;
            const btnY = Math.round(H * 0.565);
            ctx.strokeStyle = '#6a6af0';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(btnX, btnY, btnW, btnH);
            ctx.fillStyle = 'rgba(106,106,240,0.08)';
            ctx.fillRect(btnX, btnY, btnW, btnH);
            ctx.fillStyle = '#6a6af0';
            ctx.font = 'bold 14px "Courier New", monospace';
            ctx.textBaseline = 'middle';
            ctx.fillText('RETURN TO GAMEFILM', W / 2, btnY + btnH / 2);
            ctx.textBaseline = 'alphabetic';
          } else if (returnUrl) {
            // brief fat-finger guard before the button arms
            ctx.fillStyle = '#666';
            ctx.font = '10px "Courier New", monospace';
            ctx.fillText('one moment…', W / 2, H * 0.575);
          }
        }
      }

      if (paused) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, W, H);

        const btnW = Math.round(W * 0.4);
        const btnH = 36;
        const btnX = (W - btnW) / 2;
        const btnY = H / 2 - btnH / 2;

        ctx.strokeStyle = '#6a6af0';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(btnX, btnY, btnW, btnH);
        ctx.fillStyle = 'rgba(106,106,240,0.08)';
        ctx.fillRect(btnX, btnY, btnW, btnH);

        ctx.fillStyle = '#6a6af0';
        ctx.font = 'bold 14px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('RESUME', W / 2, H / 2);
        ctx.textBaseline = 'alphabetic';
      }
    },
  });

  loop.start();

  await new Promise(resolve => {
    const check = setInterval(() => { if (done) { clearInterval(check); resolve(); } }, 100);
  });

  return {
    result,
    seed,
    frames: recorder.getFrames(),
    timeline: timeline.getEntries(),
  };
}

async function runReplay(root, gameMod, replayData, canvasState) {
  const { canvas, ctx, W, H } = canvasState;
  const { seed, frames: replayFrames, sensitivity } = replayData;
  const gameOpts = { skipTitle: true };
  if (sensitivity !== undefined) gameOpts.sensitivity = sensitivity;

  const totalFrames = replayFrames.length > 0 ? replayFrames[replayFrames.length - 1].f + 120 : 600;
  let currentFrame = 0;
  let game = gameMod.createGame(seed, gameOpts);
  let seekTarget = null;

  const inputType = gameMod.GAME_META?.input?.type || 'bitmask';
  const canvasW = gameMod.GAME_META?.canvas?.width || 390;
  const defaultInput = inputType === 'paddle' ? canvasW / 2
    : inputType === 'joystick' ? { dx: 0, dy: 0, b: 0 }
    : 0;

  const inputMap = new Map();
  for (const f of replayFrames) inputMap.set(f.f, f.s);

  const seekBar = createSeekBar(root, totalFrames, frame => { seekTarget = frame; });

  const SPEED_OPTIONS = [1, 2, 4, 10];
  seekBar.speedBtn.addEventListener('click', () => {
    const cur = loop.getSpeed();
    const idx = SPEED_OPTIONS.indexOf(cur);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    loop.setSpeed(next);
    seekBar.speedBtn.textContent = next + 'x';
  });

  const returnUrl = GameFilm.getReturnUrl();

  function seekTo(targetFrame) {
    game = gameMod.createGame(seed, gameOpts);
    let lastInput = defaultInput;
    for (let f = 0; f < targetFrame && !game.isOver(); f++) {
      if (inputMap.has(f)) lastInput = inputMap.get(f);
      game.update(lastInput);
    }
    currentFrame = targetFrame;
  }

  let lastInput = defaultInput;
  let done = false;
  let paused = false;
  function setPausedReplay(v) { paused = v; document.body.classList.toggle('gf-paused', v); }

  document.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') { setPausedReplay(!paused); e.preventDefault(); }
  });

  canvas.addEventListener('click', e => {
    const rect = canvas.getBoundingClientRect();
    const s = W / rect.width;
    const gx = (e.clientX - rect.left) * s, gy = (e.clientY - rect.top) * s;

    if (done && returnUrl) {
      const btnW = Math.round(W * 0.55);
      const btnH = 36;
      const btnX = (W - btnW) / 2;
      const btnY = Math.round(H * 0.55);
      if (gx >= btnX && gx <= btnX + btnW && gy >= btnY && gy <= btnY + btnH) {
        window.location.href = returnUrl;
        return;
      }
    }

    if (paused) { setPausedReplay(false); return; }
    const barY = H - 22;
    if (gy > barY - 18 && gy < barY + 18) {
      if (gx > W - 96 && gx < W - 64) { setPausedReplay(!paused); return; }
      if (gx > W - 60 && gx < W - 32) { audio.toggleBGM(); return; }
      if (gx > W - 28 && gx < W) { audio.toggleSFX(); return; }
    }
  });

  const loop = createGameLoop({
    fps: 60,
    update() {
      if (seekTarget !== null) {
        seekTo(seekTarget);
        seekTarget = null;
        done = game.isOver();
        return;
      }
      if (done || paused) return;
      if (inputMap.has(currentFrame)) lastInput = inputMap.get(currentFrame);
      game.update(lastInput);
      if (typeof audio.onSfx === 'function' && typeof game.getSfx === 'function') audio.onSfx(game.getSfx());
      currentFrame++;
      seekBar.update(currentFrame);
      if (game.isOver()) done = true;
    },
    render() {
      game.render(ctx, W, H);

      const sndR = 12;
      const sndY = H - 22;
      for (const [x, muted] of [[W - 46, audio.isBGMMuted()], [W - 14, audio.isSFXMuted()]]) {
        if (muted) {
          ctx.strokeStyle = 'rgba(255,80,80,0.4)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x - sndR + 3, sndY + sndR - 3);
          ctx.lineTo(x + sndR - 3, sndY - sndR + 3);
          ctx.stroke();
        }
      }

      drawWatermarks(ctx, W, H, performance.now());
      if (done) {
        ctx.fillStyle = 'rgba(10, 11, 16, 0.7)';
        ctx.fillRect(0, 0, W, H);
        const r = game.getResult();
        ctx.fillStyle = '#e8eaf0';
        ctx.font = `bold ${Math.round(W * 0.07)}px "Courier New", monospace`;
        ctx.textAlign = 'center';
        ctx.fillText('REPLAY COMPLETE', W / 2, H * 0.4);
        ctx.font = `${Math.round(W * 0.045)}px "Courier New", monospace`;
        ctx.fillText(`Score: ${Math.round(r.score).toLocaleString()}`, W / 2, H * 0.46);
        if (returnUrl) {
          const btnW = Math.round(W * 0.55);
          const btnH = 36;
          const btnX = (W - btnW) / 2;
          const btnY = Math.round(H * 0.55);
          ctx.strokeStyle = '#6a6af0';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(btnX, btnY, btnW, btnH);
          ctx.fillStyle = 'rgba(106,106,240,0.08)';
          ctx.fillRect(btnX, btnY, btnW, btnH);
          ctx.fillStyle = '#6a6af0';
          ctx.font = 'bold 14px "Courier New", monospace';
          ctx.textBaseline = 'middle';
          ctx.fillText('RETURN TO GAMEFILM', W / 2, btnY + btnH / 2);
          ctx.textBaseline = 'alphabetic';
        }
      }

      if (paused && !done) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, W, H);
        const btnW = Math.round(W * 0.4);
        const btnH = 36;
        const btnX = (W - btnW) / 2;
        const btnY = H / 2 - btnH / 2;
        ctx.strokeStyle = '#6a6af0';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(btnX, btnY, btnW, btnH);
        ctx.fillStyle = 'rgba(106,106,240,0.08)';
        ctx.fillRect(btnX, btnY, btnW, btnH);
        ctx.fillStyle = '#6a6af0';
        ctx.font = 'bold 14px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('RESUME', W / 2, H / 2);
        ctx.textBaseline = 'alphabetic';
      }
    },
  });

  loop.start();
}

export async function boot(slug, opts = {}) {
  const root = document.getElementById('gf-root');
  if (!root) throw new Error('Missing #gf-root element');

  showStatus(root, 'Loading...');

  new MutationObserver(muts => {
    for (const m of muts) {
      m.addedNodes.forEach(n => { if (n.classList?.contains('sjs-bug-overlay')) window.gamePause?.(); });
      m.removedNodes.forEach(n => { if (n.classList?.contains('sjs-bug-overlay')) window.gameResume?.(); });
    }
  }).observe(document.body, { childList: true });

  // Dev-console / sandbox path: boot from an INJECTED source string (the unsaved game.js the
  // parent posted in) by importing a blob URL — no file on a server. Otherwise import the
  // game from its served path. Requires the sandbox CSP to allow `script-src 'self' blob:`.
  let gameMod;
  try {
    if (opts.source) {
      const blobUrl = URL.createObjectURL(new Blob([opts.source], { type: 'text/javascript' }));
      try { gameMod = await import(blobUrl); } finally { URL.revokeObjectURL(blobUrl); }
    } else {
      gameMod = await import(`/play/${slug}/game.js`);
    }
  } catch (e) {
    showStatus(root, `Failed to load game: ${e.message}`);
    return;
  }

  if (!gameMod.createGame || !gameMod.GAME_META || !gameMod.ENGINE_VERSION) {
    showStatus(root, 'Invalid game module — missing createGame, GAME_META, or ENGINE_VERSION');
    return;
  }

  const meta = gameMod.GAME_META;
  GameFilm.init({ gameType: slug, engineVersion: gameMod.ENGINE_VERSION });

  // Injected/dev games are a single game.js with no sibling audio.js — skip the probe (no 404).
  if (!opts.source) {
    try {
      const ga = await import(`/play/${slug}/audio.js`);
      if (ga && typeof ga.startBGM === 'function') audio = ga;
    } catch { /* no per-game audio module — use central */ }
  }
  audio.init?.(slug);
  const startAudio = () => {
    audio.startBGM();
    document.removeEventListener('keydown', startAudio);
    document.removeEventListener('click', startAudio);
    document.removeEventListener('touchstart', startAudio);
  };
  document.addEventListener('keydown', startAudio);
  document.addEventListener('click', startAudio);
  document.addEventListener('touchstart', startAudio);
  document.addEventListener('keydown', e => {
    if (e.code === 'KeyM') audio.toggleBGM();
    if (e.code === 'KeyN') audio.toggleSFX();
  });

  const canvasState = setupCanvas(root, meta);
  const { canvas, W, H, getScale } = canvasState;

  if (document.fonts?.ready) await document.fonts.ready;

  root.querySelector('#gf-status')?.remove();

  // --- Replay mode ---
  if (GameFilm.isReplay()) {
    document.body.classList.add('gf-replay');
    const replayData = await GameFilm.fetchReplay();
    if (!replayData) {
      showStatus(root, 'Replay not found.');
      return;
    }
    let replayMod = gameMod;
    if (replayData.engineVersion && replayData.engineVersion !== gameMod.ENGINE_VERSION) {
      try {
        replayMod = await import(`/play/${slug}/archive/v${replayData.engineVersion}.js`);
      } catch {
        showStatus(root, `Engine v${replayData.engineVersion} archive not found.`);
        return;
      }
    }
    // Legacy archives may predate the runtime contract (no createGame). Degrade
    // gracefully instead of crashing.
    if (typeof replayMod.createGame !== 'function') {
      showStatus(root, `This replay (engine v${replayData.engineVersion}) predates the current player and can no longer be viewed.`);
      return;
    }
    await runReplay(root, replayMod, replayData, canvasState);
    return;
  }

  // --- Live game ---
  const seed = GameFilm.getSeed() ?? ((Math.random() * 0x7FFFFFFF) | 0);

  // A game may supply its own input factory (e.g. bricks: paddle + sensitivity +
  // control strip + menu taps). Conforms to the same input contract
  // (read/type/setUiTapHandler/injectTap). Falls back to the built-in factories.
  let input;
  if (typeof gameMod.createInput === 'function') {
    input = gameMod.createInput(canvas, W, H, getScale, meta);
  } else {
    switch (meta.input?.type) {
      case 'paddle': input = createPaddleInput(canvas, W, getScale()); break;
      case 'joystick': input = createJoystickInput(canvas, W, H, getScale, meta); break;
      default: input = createBitmaskInput(); break;
    }
  }
  await runLiveGame(root, gameMod, seed, input, canvasState);
}
