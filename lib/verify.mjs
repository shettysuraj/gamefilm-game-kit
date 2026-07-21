#!/usr/bin/env node
// gamefilm-verify — conformance harness for the createGame game.js contract (sdk/GAME_SPEC.md).
//
// Validates a hub-hosted game.js against the platform contract:
//   - static source scan: no forbidden APIs / relative imports
//   - required module exports + GAME_META completeness
//   - createPRNG determinism (seed-sensitive, [0,1))
//   - the createGame instance contract (update/render/isOver/getResult)
//   - DETERMINISM: identical (seed, inputs) replays to an identical outcome (double-run)
//
// Usage:
//   node scripts/gamefilm-verify.js <slug | path/to/game.js> [--seeds=N] [--frames=N] [--json]
//
// PHASE 1 SCOPE / SAFETY: this increment runs the game by importing it — safe for trusted
// first-party games (POP/Shapes/Amphibian/Systems). UNTRUSTED contributor code must run in an
// isolate (isolated-vm); that execution backend, plus AST-based static extraction, is the next
// Phase-1 increment. The static scan and the determinism check here are intentionally
// backend-agnostic so import→isolate swaps in without restructuring.
//
// Note: the determinism check proves ENGINE PURITY (same seed+inputs → same outcome over two
// runs). The full client-record → server-replay PARITY check (the production drift test) is a
// separate, complementary check landing in the next increment.

import { readFileSync, existsSync } from 'fs';
import { join, dirname, isAbsolute, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { staticChecks } from './static-checks.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// ---- CLI ----
const args = process.argv.slice(2);
const target = args.find(a => !a.startsWith('--'));
const SEEDS = parseInt(args.find(a => a.startsWith('--seeds='))?.split('=')[1] || '5', 10);
const MAX_FRAMES = parseInt(args.find(a => a.startsWith('--frames='))?.split('=')[1] || '3600', 10);
const JSON_OUT = args.includes('--json');

if (!target) {
  console.error('Usage: node scripts/gamefilm-verify.js <slug | path/to/game.js> [--seeds=N] [--frames=N] [--json]');
  process.exit(2);
}

function resolveGamePath(t) {
  if (t.endsWith('.js')) {
    const p = isAbsolute(t) ? t : resolve(process.cwd(), t);
    return existsSync(p) ? p : null;
  }
  const c = join(ROOT, 'games', t, 'game.js');
  return existsSync(c) ? c : null;
}
const gamePath = resolveGamePath(target);
if (!gamePath) {
  console.error(`Cannot find game: ${target} (tried games/${target}/game.js)`);
  process.exit(2);
}

// ---- check collector ----
const checks = [];
const check = (name, pass, detail = '') => checks.push({ name, level: pass ? 'pass' : 'fail', detail });
const warn = (name, ok, detail = '') => checks.push({ name, level: ok ? 'pass' : 'warn', detail });

// harness-internal PRNG (mulberry32) — used to generate synthetic test inputs, so the
// harness never depends on the game's own createPRNG return shape.
function hrng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// normalize a createPRNG return value to a () => [0,1) function (accepts a bare function
// or an object exposing .next() — both conventions exist in the reference games).
function prngNext(p) {
  if (typeof p === 'function') return p;
  if (p && typeof p.next === 'function') return () => p.next();
  return null;
}

function report() {
  if (JSON_OUT) {
    console.log(JSON.stringify({ game: target, path: gamePath.replace(ROOT + '/', ''), checks }, null, 2));
  } else {
    const LABEL = { pass: 'PASS', fail: 'FAIL', warn: 'WARN' };
    console.log(`\ngamefilm-verify — ${target}  (${gamePath.replace(ROOT + '/', '')})\n`);
    for (const c of checks) {
      console.log(`  ${LABEL[c.level]}  ${c.name}${c.detail ? `\n        ↳ ${c.detail}` : ''}`);
    }
    const failed = checks.filter(c => c.level === 'fail').length;
    const warned = checks.filter(c => c.level === 'warn').length;
    console.log(`\n${failed === 0 ? '✓ ALL PASS' : `✗ ${failed} FAILED`}${warned ? ` · ${warned} warning(s)` : ''}  (${checks.length} checks)\n`);
  }
}
function finish() { report(); process.exit(checks.some(c => c.level === 'fail') ? 1 : 0); }

// ---- 1. static source scan (AST, two tiers) ----
// Shared with the hub verbatim (lib/static-checks.mjs is generated from verifier/static-checks.js),
// so "passes here" means the same thing as "passes on upload". It is AST-based, not regex: a
// `fetch()` mentioned inside a SCHEMA string or a comment is not a violation, and a regex scan
// that flags it sends an author chasing an error that isn't there.
const src = readFileSync(gamePath, 'utf-8');
for (const row of staticChecks(src)) checks.push(row);

// ---- 2. import module + contract ----
let mod;
try {
  mod = await import(pathToFileURL(gamePath).href);
  check('module: imports without throwing', true);
} catch (e) {
  check('module: imports without throwing', false, e.message);
  finish();
}

const REQUIRED = ['GAME_META', 'ENGINE_VERSION', 'SCHEMA', 'createPRNG', 'createGame'];
const missing = REQUIRED.filter(k => !(k in mod));
check('exports: GAME_META, ENGINE_VERSION, SCHEMA, createPRNG, createGame',
  missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : '');

const meta = mod.GAME_META || {};
{
  const m = [];
  if (!meta.name) m.push('name');
  if (!meta.description) m.push('description');
  if (!['joystick', 'paddle', 'bitmask'].includes(meta.input?.type)) m.push(`input.type must be joystick|paddle|bitmask (got ${meta.input?.type})`);
  if (!meta.result?.fields?.length) m.push('result.fields');
  if (!meta.result?.outcomes?.length) m.push('result.outcomes');
  if (!Array.isArray(meta.cardStats)) m.push('cardStats[]');
  check('GAME_META: required fields', m.length === 0, m.join(', '));
}
check('ENGINE_VERSION is an integer', Number.isInteger(mod.ENGINE_VERSION), `got ${typeof mod.ENGINE_VERSION} ${mod.ENGINE_VERSION}`);
check('SCHEMA is a substantial string', typeof mod.SCHEMA === 'string' && mod.SCHEMA.length >= 100, `len ${mod.SCHEMA?.length ?? 0} (min 100)`);
check('createPRNG / createGame are functions', typeof mod.createPRNG === 'function' && typeof mod.createGame === 'function');

// ---- 3. PRNG determinism ----
if (typeof mod.createPRNG === 'function') {
  try {
    const seqOf = (s) => { const r = prngNext(mod.createPRNG(s)); if (!r) return null; return Array.from({ length: 8 }, () => r()); };
    const a = seqOf(12345), b = seqOf(12345), c = seqOf(999);
    const callable = a && b && c;
    const sameSeed = callable && JSON.stringify(a) === JSON.stringify(b);
    const diffSeed = callable && JSON.stringify(a) !== JSON.stringify(c);
    const inRange = callable && a.every(x => typeof x === 'number' && x >= 0 && x < 1);
    check('createPRNG: deterministic, seed-sensitive, output in [0,1)', callable && sameSeed && diffSeed && inRange,
      !callable ? 'createPRNG must return a function or an object with .next()' : !sameSeed ? 'same seed → different output' : !diffSeed ? 'different seeds → identical output' : !inRange ? 'output outside [0,1)' : '');
  } catch (e) { check('createPRNG: deterministic, seed-sensitive, output in [0,1)', false, e.message); }
}

// ---- 4. createGame instance contract ----
const W = meta.canvas?.width ?? 390, H = meta.canvas?.height ?? 844;
if (typeof mod.createGame === 'function') {
  try {
    const g = mod.createGame(1, { skipTitle: true });
    const need = ['update', 'render', 'isOver', 'getResult'];
    const miss = need.filter(k => typeof g[k] !== 'function');
    check('createGame instance: update, render, isOver, getResult', miss.length === 0, miss.length ? `not functions: ${miss.join(', ')}` : '');
  } catch (e) { check('createGame instance: update, render, isOver, getResult', false, e.message); }
}

// ---- 5. determinism (double-run) + completion ----
function makeInputGen(seed) {
  const rng = hrng((seed ^ 0x9e3779b9) >>> 0);
  const type = meta.input?.type;
  return () => {
    if (type === 'paddle') return Math.round(rng() * W);
    if (type === 'bitmask') return (rng() * 64) | 0;
    // joystick (default): occasional button + occasional tap to clear menus
    const tap = rng() < 0.02;
    return {
      dx: Math.round((rng() * 2 - 1) * 1000) / 1000,
      dy: Math.round((rng() * 2 - 1) * 1000) / 1000,
      b: rng() < 0.08 ? 1 : 0,
      tapX: tap ? Math.round(rng() * W) : -1,
      tapY: tap ? Math.round(rng() * H) : -1,
      touchActive: false,
    };
  };
}
function runGame(seed, inputs) {
  const g = mod.createGame(seed, { skipTitle: true });
  const trace = [];
  let f = 0;
  for (; f < inputs.length; f++) {
    if (g.isOver && g.isOver()) break;
    g.update(inputs[f]);
    const snap = typeof g.getState === 'function' ? g.getState() : null;
    trace.push(snap && typeof snap.score === 'number' ? snap.score : 0);
  }
  const ended = !!(g.isOver && g.isOver());
  const result = typeof g.getResult === 'function' ? g.getResult() : null;
  return { result, trace, frames: f, ended };
}
if (typeof mod.createGame === 'function' && typeof mod.createPRNG === 'function') {
  let detPass = true, ended = 0;
  const detail = [];
  for (let i = 0; i < SEEDS; i++) {
    const seed = 1000 + i * 7919;
    let A, B;
    try {
      const inputs = Array.from({ length: MAX_FRAMES }, makeInputGen(seed));
      A = runGame(seed, inputs); B = runGame(seed, inputs);
    } catch (e) { detPass = false; detail.push(`seed ${seed}: threw "${e.message}"`); continue; }
    const same = A.frames === B.frames
      && JSON.stringify(A.result) === JSON.stringify(B.result)
      && JSON.stringify(A.trace) === JSON.stringify(B.trace);
    if (!same) { detPass = false; detail.push(`seed ${seed}: NON-DETERMINISTIC (frames ${A.frames}/${B.frames})`); }
    if (A.ended) ended++;
    if (A.result) {
      const rf = (meta.result?.fields || []).filter(k => !(k in A.result));
      if (rf.length) { detPass = false; detail.push(`seed ${seed}: getResult missing field(s) ${rf.join(',')}`); }
    } else { detPass = false; detail.push(`seed ${seed}: getResult() returned null`); }
  }
  detail.unshift(`${ended}/${SEEDS} terminated within ${MAX_FRAMES} frames (rest hit cap)`);
  check(`determinism: ${SEEDS} seeds replay identically (engine purity)`, detPass, detail.join('; '));
}

finish();
