// GameFilm SDK — drop this into your game.
// Handles: deterministic RNG, input recording, hub integration, replay playback.
// No dependencies. No build step. Just <script src="gamefilm.js">.

export const GameFilm = {
  _hubUrl: null,
  _token: null,
  _seed: null,
  _replayToken: null,
  _replayHub: null,
  _gameType: null,
  _engineVersion: null,

  init({ gameType, engineVersion }) {
    this._gameType = gameType;
    this._engineVersion = engineVersion;

    const params = new URLSearchParams(window.location.search);
    const hub = params.get('hub');
    const ALLOWED = /^https:\/\/[\w-]+\.gamefilm\.org$|^https:\/\/gamefilm\.org$|^http:\/\/localhost(:\d+)?$/;

    if (hub && ALLOWED.test(hub)) {
      this._hubUrl = hub;
      this._token = params.get('token');
      this._replayToken = params.get('replay');
      this._replayHub = hub;
    }

    const seedParam = params.get('seed');
    if (seedParam != null) this._seed = Number(seedParam);

    this._ranked = params.get('ranked') !== '0';

    // Sandbox/bridge mode: when embedded in the gamefilm parent shell as a cross-origin iframe,
    // results are handed to the parent via postMessage instead of submitted to the hub — there is
    // no token in the frame. `po` is the parent origin (postMessage target); `nonce` ties the
    // message to this session so the parent can trust it.
    this._bridge = params.get('bridge') === '1';
    this._parentOrigin = params.get('po') || null;
    this._nonce = params.get('nonce') || null;

    const rp = params.get('returnPath') || '/profile';
    this._returnPath = (rp.startsWith('/') && !rp.startsWith('//') && !rp.includes(':')) ? rp : '/profile';

    this.retryPending().then(results => {
      for (const r of results) {
        if (r.ok) console.log(`[GameFilm] Recovered pending submission: ${r.token.slice(0, 8)}…`);
      }
    }).catch(() => {});
  },

  getSeed() {
    return this._seed;
  },

  isRanked() {
    return this._ranked;
  },

  getHubUrl() {
    return this._hubUrl;
  },

  getReturnUrl() {
    return this._hubUrl ? this._hubUrl + this._returnPath : null;
  },

  hasCallback() {
    return !!((this._token && this._hubUrl) || this._bridge);
  },

  async checkToken() {
    if (!this._token || !this._hubUrl) return { valid: true };
    try {
      const res = await fetch(`${this._hubUrl}/api/games/${this._gameType}/token-status?token=${this._token}`);
      if (!res.ok) return { valid: true };
      return res.json();
    } catch { return { valid: true }; }
  },

  isReplay() {
    return !!(this._replayToken && this._replayHub);
  },

  async submitResults({ seed, frames, score, timeline, sensitivity, onProgress }) {
    // Bridge/sandbox mode: hand the result to the parent shell via postMessage. The parent
    // (which holds the token) decides what to do — show the dev their score (sandbox) or perform
    // the authenticated submit (published UGC). No token, no hub POST from inside the frame.
    if (this._bridge) {
      if (onProgress) onProgress(1, 'finalizing');
      const msg = {
        type: 'gamefilm:result', nonce: this._nonce, gameType: this._gameType,
        engineVersion: this._engineVersion, seed, frames, score, timeline: timeline || null,
      };
      if (sensitivity !== undefined) msg.sensitivity = sensitivity;
      // Always target the explicit parent origin — never broadcast to '*'. If the parent didn't
      // pass `po`, the embed is misconfigured; refuse rather than leak the result to any listener.
      if (!this._parentOrigin) { console.warn('[GameFilm] bridge mode without a parent origin (po) — not posting'); return { sent: false, error: 'no parent origin' }; }
      try { (window.parent || window).postMessage(msg, this._parentOrigin); } catch { /* no parent */ }
      return { sent: true, bridged: true };
    }

    if (!this._token || !this._hubUrl) return { sent: false };

    const payload = {
      token: this._token,
      seed,
      frames,
      score,
      timeline: timeline || null,
      engineVersion: this._engineVersion,
    };
    if (sensitivity !== undefined) payload.sensitivity = sensitivity;

    const url = `${this._hubUrl}/api/games/${this._gameType}/results`;

    this._savePending(payload, url);

    try {
      const result = await this._postWithRetry(url, payload, onProgress);
      this._clearPending(this._token);
      return result;
    } catch (e) {
      e.payload = payload;
      throw e;
    }
  },

  downloadReplay({ seed, frames, score, timeline }) {
    const payload = {
      gameType: this._gameType,
      engineVersion: this._engineVersion,
      token: this._token,
      seed,
      frames,
      score,
      timeline: timeline || null,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gamefilm-${this._gameType}-${seed}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // POST via XHR (not fetch) so we get upload progress events. onProgress(frac, phase)
  // is called with frac 0..1 and phase 'uploading' (bytes leaving the device) then
  // 'finalizing' (server verifying + storing the replay in S3).
  _xhrPost(url, body, headers, onProgress) {
    return new Promise((resolve, reject) => {
      let xhr;
      try { xhr = new XMLHttpRequest(); } catch { reject(new Error('no XHR')); return; }
      xhr.open('POST', url, true);
      for (const k in headers) xhr.setRequestHeader(k, headers[k]);
      xhr.timeout = 60000;
      if (onProgress) {
        onProgress(0, 'uploading');
        if (xhr.upload) {
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress(Math.min(0.99, e.loaded / e.total), 'uploading');
          };
          xhr.upload.onload = () => onProgress(1, 'finalizing');
        }
      }
      xhr.onload = () => {
        let json = {};
        try { json = JSON.parse(xhr.responseText); } catch { /* non-JSON body */ }
        resolve({ status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300, json });
      };
      xhr.onerror = () => reject(new Error('network error'));
      xhr.ontimeout = () => reject(new Error('timeout'));
      xhr.send(body);
    });
  },

  async _postWithRetry(url, payload, onProgress) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const err = new Error('offline');
      err.offline = true;
      throw err;
    }

    const json = JSON.stringify(payload);
    let body = json;
    let headers = { 'Content-Type': 'application/json' };

    if (typeof CompressionStream !== 'undefined') {
      try {
        const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
        body = await new Response(stream).blob();
        headers = { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' };
      } catch { body = json; }
    }

    const MAX_RETRIES = 5;
    const BACKOFF = [0, 2000, 5000, 10000, 20000];
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          const err = new Error('offline');
          err.offline = true;
          throw err;
        }
        await new Promise(r => setTimeout(r, BACKOFF[attempt - 1]));
      }
      try {
        const res = await this._xhrPost(url, body, headers, onProgress);
        if (res.ok) return res.json;
        if (res.status >= 400 && res.status < 500) {
          const err = new Error(res.json?.error || 'rejected');
          err.clientError = true;
          throw err;
        }
        // 5xx (incl. 503 'replay upload failed, retry') — record and retry.
        lastError = new Error(res.json?.error || `server error ${res.status}`);
        lastError.status = res.status;
      } catch (e) {
        if (e.clientError || e.offline) throw e;
        lastError = e;
      }
    }
    // Retries exhausted without a successful upload — surface so the caller keeps
    // the pending payload (localStorage) for a later retry and shows the failure.
    throw lastError || new Error('upload failed');
  },

  _savePending(payload, url) {
    try {
      const key = `gamefilm_pending_${payload.token}`;
      localStorage.setItem(key, JSON.stringify({ url, payload, savedAt: Date.now() }));
    } catch { /* localStorage full or unavailable */ }
  },

  _clearPending(token) {
    try { localStorage.removeItem(`gamefilm_pending_${token}`); } catch {}
  },

  async retryPending() {
    const results = [];
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('gamefilm_pending_')) keys.push(k);
      }
      for (const key of keys) {
        try {
          const { url, payload, savedAt } = JSON.parse(localStorage.getItem(key));
          if (Date.now() - savedAt > 7 * 24 * 60 * 60 * 1000) {
            localStorage.removeItem(key);
            continue;
          }
          const result = await this._postWithRetry(url, payload);
          localStorage.removeItem(key);
          results.push({ token: payload.token, ok: true, result });
        } catch (e) {
          if (e.clientError) localStorage.removeItem(key);
          results.push({ token: key.replace('gamefilm_pending_', ''), ok: false, error: e.message });
        }
      }
    } catch {}
    return results;
  },

  async fetchReplay() {
    try {
      if (!this._replayToken || !this._replayHub) return null;
      const res = await fetch(`${this._replayHub}/api/replay/${this._replayToken}`);
      if (!res.ok) return null;
      return res.json();
    } catch (e) {
      console.error('[GameFilm] fetchReplay failed:', e);
      return null;
    }
  },
};

// --- Deterministic PRNG (Mulberry32) ---
// Seed once per game. Every call produces the same sequence for the same seed.

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
    float(min, max) { return min + next() * (max - min); },
    pick(arr) { return arr[Math.floor(next() * arr.length)]; },
    chance(p = 0.5) { return next() < p; },
    getSeed() { return seed; },
  };
}

// --- Input Recorder ---
// Delta-compressed: only records frames where input changes.

export function createRecorder() {
  const frames = [];
  let lastState = null;
  let seqFrame = 0;

  return {
    // Record a frame. `inputState` can be anything — a number (bitmask),
    // an array [x, y], an object — as long as it serializes consistently.
    record(inputState) {
      const s = JSON.stringify(inputState);
      if (s !== lastState) {
        frames.push({ f: seqFrame, s: inputState });
        lastState = s;
      }
      seqFrame++;
    },

    // For bitmask-style inputs (simpler, more compact)
    recordBitmask(bitmask) {
      if (frames.length === 0 || frames[frames.length - 1].s !== bitmask) {
        frames.push({ f: seqFrame, s: bitmask });
      }
      seqFrame++;
    },

    // For joystick-style inputs (dx, dy, buttons, optional tap coordinates)
    recordJoystick(dx, dy, buttons = 0, tapX = -1, tapY = -1) {
      const rdx = Math.round(dx * 1000) / 1000;
      const rdy = Math.round(dy * 1000) / 1000;
      const rtx = Math.round(tapX);
      const rty = Math.round(tapY);
      const last = frames.length > 0 ? frames[frames.length - 1] : null;
      const prevTx = last?.s.tapX ?? -1;
      const prevTy = last?.s.tapY ?? -1;
      if (!last || last.s.dx !== rdx || last.s.dy !== rdy || last.s.b !== buttons ||
          prevTx !== rtx || prevTy !== rty) {
        const s = { dx: rdx, dy: rdy, b: buttons };
        if (rtx >= 0 || rty >= 0) { s.tapX = rtx; s.tapY = rty; }
        frames.push({ f: seqFrame, s });
      }
      seqFrame++;
    },

    getFrames() { return frames; },
    getFrameCount() { return seqFrame; },
    reset() { frames.length = 0; lastState = null; seqFrame = 0; },
  };
}

// --- Timeline (analytics snapshots) ---
// Periodically captures game state for AI analysis.

export function createTimeline(interval = 30) {
  const entries = [];
  let frameCount = 0;

  return {
    tick(snapshot) {
      frameCount++;
      if (frameCount % interval === 0) {
        entries.push({ f: frameCount, ...snapshot });
      }
    },
    forceSnapshot(snapshot) {
      entries.push({ f: frameCount, ...snapshot });
    },
    getEntries() { return entries; },
    reset() { entries.length = 0; frameCount = 0; },
  };
}

// --- Fixed Timestep Game Loop ---
// Guarantees deterministic simulation regardless of render performance.

export function createGameLoop({ fps = 60, update, render }) {
  const dt = 1 / fps;
  let accumulator = 0;
  let lastTime = 0;
  let running = false;
  let rafId = null;
  let speedMultiplier = 1;

  function tick(timestamp) {
    if (!running) return;
    if (lastTime === 0) lastTime = timestamp;

    const elapsed = Math.min((timestamp - lastTime) / 1000, 0.1) * speedMultiplier;
    lastTime = timestamp;
    accumulator += elapsed;

    while (accumulator >= dt) {
      update(dt);
      accumulator -= dt;
    }

    render(accumulator / dt);
    rafId = requestAnimationFrame(tick);
  }

  return {
    start() { running = true; lastTime = 0; accumulator = 0; rafId = requestAnimationFrame(tick); },
    stop() { running = false; if (rafId) cancelAnimationFrame(rafId); },
    isRunning() { return running; },
    setSpeed(s) { speedMultiplier = s; },
    getSpeed() { return speedMultiplier; },
  };
}
