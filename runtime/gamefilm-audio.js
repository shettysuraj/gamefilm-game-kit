// GameFilm Runtime Audio — procedural Web Audio API.
// BGM: shared ambient pad + melody (same as POP/Bricks).

let _noiseSeed = 1;
function noiseRand() {
  _noiseSeed = (_noiseSeed * 16807) % 2147483647;
  return (_noiseSeed - 1) / 2147483646 * 2 - 1;
}

let ctx = null;
let masterGain = null;
let bgmGain = null;
let sfxGain = null;
let bgmPlaying = false;
let _bgmMuted = false;
let _sfxMuted = false;
let bgmLevel = 0.25;
let _slug = '';
let bgmOscillators = [];
let bgmLFO = null;
let melodyIdx = 0;
let melodyTimer = null;
let chordIndex = 0;
let chordTimer = null;
let melodyFilter = null;
let padFilter = null;

export function init(slug) {
  _slug = slug;
  // localStorage throws in a sandboxed (opaque-origin) iframe — guard it (mute prefs are optional).
  try {
    _bgmMuted = localStorage.getItem(`${slug}_bgm_muted`) === '1';
    _sfxMuted = localStorage.getItem(`${slug}_sfx_muted`) === '1';
  } catch { _bgmMuted = false; _sfxMuted = false; }
}

export function isBGMMuted() { return _bgmMuted; }
export function isSFXMuted() { return _sfxMuted; }

export function toggleBGM() {
  _bgmMuted = !_bgmMuted;
  try { localStorage.setItem(`${_slug}_bgm_muted`, _bgmMuted ? '1' : '0'); } catch { /* sandboxed */ }
  if (bgmGain) bgmGain.gain.value = _bgmMuted ? 0 : bgmLevel;
  return _bgmMuted;
}

export function toggleSFX() {
  _sfxMuted = !_sfxMuted;
  try { localStorage.setItem(`${_slug}_sfx_muted`, _sfxMuted ? '1' : '0'); } catch { /* sandboxed */ }
  if (sfxGain) sfxGain.gain.value = _sfxMuted ? 0 : 0.5;
  return _sfxMuted;
}

function ensureCtx() {
  if (ctx) return true;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.7;
    masterGain.connect(ctx.destination);
    bgmGain = ctx.createGain();
    bgmGain.gain.value = _bgmMuted ? 0 : bgmLevel;
    bgmGain.connect(masterGain);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = _sfxMuted ? 0 : 0.5;
    sfxGain.connect(masterGain);
    return true;
  } catch { return false; }
}

function sfxGuard() {
  if (!ensureCtx()) return false;
  if (_sfxMuted) return false;
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}

// --- BGM: pad + melody, one synth, swappable note data ---
//
// The synth engine below is fixed; the MUSIC is just data (a melody array + a pad-chord
// progression + an oscillator waveform). So changing a game's music is changing a preset name,
// nothing more. A game picks one with `GAME_META.music: 'arcade'`, supplies its own
// `{ melody, chords, wave }`, or `'none'` for silence. Default = 'ambient' (the original track), so
// every existing game sounds exactly as before.

const TRACKS = {
  // The original ambient pad + melody (unchanged — POP/Bricks/Shapes/Amphibian keep this).
  ambient: {
    wave: 'triangle',
    melody: [
      { note: 261.63, dur: 2.0 }, { note: 0, dur: 0.5 }, { note: 311.13, dur: 1.5 },
      { note: 392.00, dur: 2.5 }, { note: 0, dur: 0.5 }, { note: 349.23, dur: 1.5 },
      { note: 311.13, dur: 2.0 }, { note: 0, dur: 0.5 }, { note: 392.00, dur: 2.0 },
      { note: 523.25, dur: 3.0 }, { note: 0, dur: 0.5 }, { note: 466.16, dur: 1.5 },
      { note: 392.00, dur: 2.0 }, { note: 349.23, dur: 2.0 }, { note: 0, dur: 0.5 },
      { note: 311.13, dur: 1.5 }, { note: 261.63, dur: 3.0 }, { note: 0, dur: 1.0 },
    ],
    chords: [[65.41, 130.81, 155.56], [58.27, 116.54, 174.61], [55.00, 110.00, 164.81], [61.74, 123.47, 185.00]],
  },
  // Bright, bouncy, major — an upbeat arcade feel.
  arcade: {
    wave: 'square',
    melody: [
      { note: 523.25, dur: 0.4 }, { note: 659.25, dur: 0.4 }, { note: 783.99, dur: 0.4 }, { note: 659.25, dur: 0.4 },
      { note: 587.33, dur: 0.4 }, { note: 698.46, dur: 0.4 }, { note: 587.33, dur: 0.8 }, { note: 0, dur: 0.2 },
      { note: 523.25, dur: 0.4 }, { note: 659.25, dur: 0.4 }, { note: 783.99, dur: 0.8 }, { note: 0, dur: 0.4 },
    ],
    chords: [[130.81, 196.00, 261.63], [146.83, 220.00, 293.66], [164.81, 246.94, 329.63], [146.83, 220.00, 293.66]],
  },
  // Classic 8-bit lead — square wave, catchy and fast.
  chiptune: {
    wave: 'square',
    melody: [
      { note: 392.00, dur: 0.3 }, { note: 392.00, dur: 0.3 }, { note: 523.25, dur: 0.6 }, { note: 392.00, dur: 0.3 },
      { note: 349.23, dur: 0.3 }, { note: 329.63, dur: 0.6 }, { note: 293.66, dur: 0.6 }, { note: 0, dur: 0.3 },
      { note: 440.00, dur: 0.3 }, { note: 523.25, dur: 0.3 }, { note: 659.25, dur: 0.6 }, { note: 523.25, dur: 0.6 },
    ],
    chords: [[130.81, 164.81, 196.00], [110.00, 146.83, 174.61], [123.47, 155.56, 196.00], [130.81, 164.81, 196.00]],
  },
  // Low, sparse, minor — ominous.
  tense: {
    wave: 'sawtooth',
    melody: [
      { note: 220.00, dur: 2.5 }, { note: 0, dur: 0.5 }, { note: 233.08, dur: 2.0 }, { note: 220.00, dur: 2.0 },
      { note: 0, dur: 1.0 }, { note: 207.65, dur: 2.5 }, { note: 196.00, dur: 3.0 }, { note: 0, dur: 1.0 },
    ],
    chords: [[55.00, 82.41, 110.00], [58.27, 87.31, 116.54], [51.91, 77.78, 103.83], [55.00, 82.41, 110.00]],
  },
};

let track = TRACKS.ambient;
let melodyWave = track.wave;
let _silent = false;

// Select the BGM: a preset name, a custom { melody, chords, wave }, or 'none'. Unknown → ambient.
// Optional-chained by the runtime, so a per-game audio.js without it is fine.
export function setTrack(sel) {
  if (sel === 'none') { _silent = true; return; }
  _silent = false;
  if (sel && typeof sel === 'object' && Array.isArray(sel.melody)) {
    track = { wave: sel.wave || 'triangle', melody: sel.melody, chords: sel.chords || TRACKS.ambient.chords };
  } else if (typeof sel === 'string' && TRACKS[sel]) {
    track = TRACKS[sel];
  } else {
    track = TRACKS.ambient;
  }
  melodyWave = track.wave || 'triangle';
}

export function startBGM() {
  if (_silent) return;
  if (!ensureCtx()) return;
  if (bgmPlaying) return;
  bgmPlaying = true;
  if (ctx.state === 'suspended') ctx.resume();

  padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = 600;
  padFilter.Q.value = 0.5;

  const padGain = ctx.createGain();
  padGain.gain.value = 0.18;
  padFilter.connect(padGain);
  padGain.connect(bgmGain);

  bgmLFO = ctx.createOscillator();
  bgmLFO.type = 'sine';
  bgmLFO.frequency.value = 0.06;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.02;
  bgmLFO.connect(lfoGain);
  lfoGain.connect(padGain.gain);
  bgmLFO.start();

  playPad(track.chords[0]);

  chordIndex = 0;
  chordTimer = setInterval(() => {
    chordIndex = (chordIndex + 1) % track.chords.length;
    morphPad(track.chords[chordIndex]);
  }, 12000);

  melodyFilter = ctx.createBiquadFilter();
  melodyFilter.type = 'lowpass';
  melodyFilter.frequency.value = 1800;
  melodyFilter.Q.value = 0.7;

  const melodyDelay = ctx.createDelay(1.0);
  melodyDelay.delayTime.value = 0.4;
  const delayFeedback = ctx.createGain();
  delayFeedback.gain.value = 0.3;
  const delayFilter = ctx.createBiquadFilter();
  delayFilter.type = 'lowpass';
  delayFilter.frequency.value = 1200;

  melodyFilter.connect(bgmGain);
  melodyFilter.connect(melodyDelay);
  melodyDelay.connect(delayFilter);
  delayFilter.connect(delayFeedback);
  delayFeedback.connect(melodyDelay);
  delayFilter.connect(bgmGain);

  melodyIdx = 0;
  playMelodyNote();
}

function playPad(freqs) {
  bgmOscillators.forEach(o => { try { o.stop(); } catch {} });
  bgmOscillators = [];
  for (const freq of freqs) {
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = freq;
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 1.003;
    const env = ctx.createGain();
    env.gain.value = 0;
    env.gain.setTargetAtTime(0.15, ctx.currentTime, 2.0);
    osc1.connect(env);
    osc2.connect(env);
    env.connect(padFilter);
    osc1.start();
    osc2.start();
    bgmOscillators.push(osc1, osc2);
  }
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = freqs[0] / 2;
  const subEnv = ctx.createGain();
  subEnv.gain.value = 0;
  subEnv.gain.setTargetAtTime(0.12, ctx.currentTime, 3.0);
  sub.connect(subEnv);
  subEnv.connect(padFilter);
  sub.start();
  bgmOscillators.push(sub);
}

function morphPad(freqs) {
  if (!bgmOscillators.length) return;
  let idx = 0;
  for (const freq of freqs) {
    if (bgmOscillators[idx]) bgmOscillators[idx].frequency.setTargetAtTime(freq, ctx.currentTime, 4.0);
    if (bgmOscillators[idx + 1]) bgmOscillators[idx + 1].frequency.setTargetAtTime(freq * 1.003, ctx.currentTime, 4.0);
    idx += 2;
  }
  if (bgmOscillators[idx]) bgmOscillators[idx].frequency.setTargetAtTime(freqs[0] / 2, ctx.currentTime, 4.0);
}

function playMelodyNote() {
  if (!bgmPlaying) return;
  const step = track.melody[melodyIdx];
  melodyIdx = (melodyIdx + 1) % track.melody.length;

  if (step.note > 0) {
    const now = ctx.currentTime;
    const attack = 0.15;
    const release = Math.min(0.4, step.dur * 0.3);
    const sustainEnd = now + step.dur - release;

    const osc = ctx.createOscillator();
    osc.type = melodyWave;
    osc.frequency.value = step.note;
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = step.note * 2;
    const octGain = ctx.createGain();
    octGain.gain.value = 0.03;
    osc2.connect(octGain);

    const env = ctx.createGain();
    env.gain.value = 0;
    env.gain.setTargetAtTime(0.3, now, attack);
    env.gain.setTargetAtTime(0, sustainEnd, release * 0.4);

    osc.connect(env);
    octGain.connect(env);
    env.connect(melodyFilter);

    osc.start(now);
    osc2.start(now);
    osc.stop(now + step.dur + 0.5);
    osc2.stop(now + step.dur + 0.5);
  }
  melodyTimer = setTimeout(playMelodyNote, step.dur * 1000);
}

export function stopBGM() {
  if (!bgmPlaying) return;
  bgmPlaying = false;
  if (chordTimer) { clearInterval(chordTimer); chordTimer = null; }
  if (melodyTimer) { clearTimeout(melodyTimer); melodyTimer = null; }
  if (bgmGain) bgmGain.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
  setTimeout(() => {
    bgmOscillators.forEach(o => { try { o.stop(); } catch {} });
    bgmOscillators = [];
    if (bgmLFO) { try { bgmLFO.stop(); } catch {} bgmLFO = null; }
    if (bgmGain) bgmGain.gain.value = _bgmMuted ? 0 : bgmLevel;
  }, 2000);
}

// --- SFX ---

export function sfxMove() {
  if (!sfxGuard()) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 220;
  const gain = ctx.createGain();
  gain.gain.value = 0.04;
  gain.gain.setTargetAtTime(0, now + 0.02, 0.01);
  osc.connect(gain);
  gain.connect(sfxGain);
  osc.start(now);
  osc.stop(now + 0.05);
}

export function sfxRotate() {
  if (!sfxGuard()) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = 440;
  osc.frequency.setTargetAtTime(660, now, 0.02);
  const gain = ctx.createGain();
  gain.gain.value = 0.07;
  gain.gain.setTargetAtTime(0, now + 0.04, 0.015);
  osc.connect(gain);
  gain.connect(sfxGain);
  osc.start(now);
  osc.stop(now + 0.08);
}

export function sfxHardDrop() {
  if (!sfxGuard()) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 200;
  osc.frequency.setTargetAtTime(80, now, 0.02);
  const gain = ctx.createGain();
  gain.gain.value = 0.18;
  gain.gain.setTargetAtTime(0, now + 0.06, 0.02);
  osc.connect(gain);
  gain.connect(sfxGain);
  osc.start(now);
  osc.stop(now + 0.12);

  const bufLen = Math.floor(ctx.sampleRate * 0.05);
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = noiseRand() * Math.pow(1 - i / bufLen, 4);
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const nGain = ctx.createGain();
  nGain.gain.value = 0.1;
  noise.connect(nGain);
  nGain.connect(sfxGain);
  noise.start(now);
  noise.stop(now + 0.05);
}

export function sfxLock() {
  if (!sfxGuard()) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 120;
  const gain = ctx.createGain();
  gain.gain.value = 0.1;
  gain.gain.setTargetAtTime(0, now + 0.04, 0.015);
  osc.connect(gain);
  gain.connect(sfxGain);
  osc.start(now);
  osc.stop(now + 0.08);
}

export function sfxDrop() {
  if (!sfxGuard()) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 150;
  osc.frequency.setTargetAtTime(60, now, 0.03);
  const gain = ctx.createGain();
  gain.gain.value = 0.15;
  gain.gain.setTargetAtTime(0, now + 0.05, 0.02);
  osc.connect(gain);
  gain.connect(sfxGain);
  osc.start(now);
  osc.stop(now + 0.12);

  const bufLen = Math.floor(ctx.sampleRate * 0.04);
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = noiseRand() * Math.pow(1 - i / bufLen, 6);
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const nGain = ctx.createGain();
  nGain.gain.value = 0.06;
  noise.connect(nGain);
  nGain.connect(sfxGain);
  noise.start(now);
  noise.stop(now + 0.04);
}

export function sfxClear(count) {
  if (!sfxGuard()) return;
  const now = ctx.currentTime;
  const vol = count <= 1 ? 0.12 : count === 2 ? 0.132 : count === 3 ? 0.145 : 0.15;
  const baseFreq = count >= 4 ? 300 : 400;
  const dur = 0.3 + count * 0.08;
  const tracks = Math.min(count, 4);

  let reverbNode = null;
  if (count >= 4) {
    reverbNode = ctx.createConvolver();
    const revLen = Math.floor(ctx.sampleRate * 1.2);
    const revBuf = ctx.createBuffer(2, revLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = revBuf.getChannelData(ch);
      for (let i = 0; i < revLen; i++) d[i] = noiseRand() * Math.pow(1 - i / revLen, 2.5);
    }
    reverbNode.buffer = revBuf;
    const revGain = ctx.createGain();
    revGain.gain.value = 0.3;
    reverbNode.connect(revGain);
    revGain.connect(sfxGain);
  }

  for (let t = 0; t < tracks; t++) {
    const detune = (t - (tracks - 1) / 2) * 15;
    const delay = t * 0.012;

    const bufLen = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = noiseRand() * Math.pow(1 - i / bufLen, 2.0 + t * 0.3);
    const noise = ctx.createBufferSource();
    noise.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = baseFreq + t * 80;
    filter.Q.value = 1.5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, now + delay);
    gain.gain.setTargetAtTime(0, now + delay + dur * 0.6, dur * 0.2);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(sfxGain);
    if (reverbNode) gain.connect(reverbNode);
    noise.start(now + delay);
    noise.stop(now + delay + dur + 0.1);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = baseFreq * 2 + detune;
    osc.frequency.setTargetAtTime(baseFreq * 0.5, now + delay, dur * 0.4);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(vol * 0.6, now + delay);
    oscGain.gain.setTargetAtTime(0, now + delay + dur * 0.7, dur * 0.15);
    osc.connect(oscGain);
    oscGain.connect(sfxGain);
    if (reverbNode) oscGain.connect(reverbNode);
    osc.start(now + delay);
    osc.stop(now + delay + dur + 0.2);
  }

  if (count >= 4) {
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 60;
    sub.frequency.setTargetAtTime(30, now, 0.15);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.2, now);
    subGain.gain.setTargetAtTime(0, now + 0.4, 0.12);
    sub.connect(subGain);
    subGain.connect(sfxGain);
    sub.start(now);
    sub.stop(now + 0.6);
  }
}

export function sfxLevelUp() {
  if (!sfxGuard()) return;
  const now = ctx.currentTime;
  const notes = [523, 659, 784, 1047];
  for (let i = 0; i < notes.length; i++) {
    const t = now + i * 0.08;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = notes[i];
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = notes[i] * 2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.setTargetAtTime(0, t + 0.1, 0.05);
    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0.04, t);
    gain2.gain.setTargetAtTime(0, t + 0.12, 0.05);
    osc.connect(gain);
    osc2.connect(gain2);
    gain.connect(sfxGain);
    gain2.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.2);
    osc2.start(t);
    osc2.stop(t + 0.2);
  }
}

export function sfxCombo() {
  if (!sfxGuard()) return;
  const now = ctx.currentTime;
  const notes = [880, 1047, 1319];
  for (let i = 0; i < notes.length; i++) {
    const t = now + i * 0.04;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = notes[i];
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.setTargetAtTime(0, t + 0.06, 0.025);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.12);
  }
}

export function sfxHold() {
  if (!sfxGuard()) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = 330;
  osc.frequency.setTargetAtTime(520, now, 0.03);
  const gain = ctx.createGain();
  gain.gain.value = 0.08;
  gain.gain.setTargetAtTime(0, now + 0.06, 0.02);
  osc.connect(gain);
  gain.connect(sfxGain);
  osc.start(now);
  osc.stop(now + 0.1);

  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = 660;
  const gain2 = ctx.createGain();
  gain2.gain.setValueAtTime(0.06, now + 0.03);
  gain2.gain.setTargetAtTime(0, now + 0.08, 0.02);
  osc2.connect(gain2);
  gain2.connect(sfxGain);
  osc2.start(now + 0.03);
  osc2.stop(now + 0.12);
}

export function sfxPerfectClear() {
  if (!sfxGuard()) return;
  const now = ctx.currentTime;
  const notes = [523, 659, 784, 1047, 1319, 1568];
  for (let i = 0; i < notes.length; i++) {
    const t = now + i * 0.07;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = notes[i];
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = notes[i] * 2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.setTargetAtTime(0, t + 0.15, 0.06);
    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0.05, t);
    gain2.gain.setTargetAtTime(0, t + 0.18, 0.06);
    osc.connect(gain);
    osc2.connect(gain2);
    gain.connect(sfxGain);
    gain2.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.25);
    osc2.start(t);
    osc2.stop(t + 0.25);
  }

  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = 65;
  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(0.2, now + 0.3);
  subGain.gain.setTargetAtTime(0, now + 0.8, 0.2);
  sub.connect(subGain);
  subGain.connect(sfxGain);
  sub.start(now + 0.3);
  sub.stop(now + 1.2);
}

export function sfxGameOver() {
  if (!sfxGuard()) return;
  const now = ctx.currentTime;

  const dur = 0.6;
  const bufferSize = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = noiseRand() * Math.pow(1 - i / bufferSize, 1.5);
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 400;
  filter.Q.value = 0.8;
  filter.frequency.setTargetAtTime(60, now, 0.15);
  const gain = ctx.createGain();
  gain.gain.value = 0.2;
  gain.gain.setTargetAtTime(0, now + 0.2, 0.12);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(sfxGain);

  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = 55;
  sub.frequency.setTargetAtTime(25, now, 0.2);
  const subGain = ctx.createGain();
  subGain.gain.value = 0.3;
  subGain.gain.setTargetAtTime(0, now + 0.3, 0.15);
  sub.connect(subGain);
  subGain.connect(sfxGain);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 200;
  osc.frequency.setTargetAtTime(60, now, 0.3);
  const oscGain = ctx.createGain();
  oscGain.gain.value = 0.12;
  oscGain.gain.setTargetAtTime(0, now + 0.4, 0.15);
  osc.connect(oscGain);
  oscGain.connect(sfxGain);

  noise.start(now);
  noise.stop(now + dur);
  sub.start(now);
  sub.stop(now + 0.5);
  osc.start(now);
  osc.stop(now + 0.6);
}
