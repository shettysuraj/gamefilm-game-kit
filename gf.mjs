#!/usr/bin/env node
// gf — GameFilm game dev CLI. Node-only, no install, no account, no tokens.
//   node gf.mjs verify [game.js]            — check your game loads on gamefilm (conformance + determinism)
//   node gf.mjs play   [game.js] [--seed N] — play it locally in your browser
// Defaults to ./game.js if no file is given.
//
// The seed is ALWAYS chosen here and passed explicitly, never left to the runtime's internal
// fallback — otherwise a random local run is unreproducible, and "I just saw a crash" becomes
// undebuggable. Random by default (so you see many worlds), printed every time (so you can pin
// the one that broke): `gf play --seed 12345`.

import { spawnSync } from 'child_process';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, extname, resolve, isAbsolute } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

// --seed N (or --seed=N). Pulled out before the positional file arg so order doesn't matter.
let seedArg = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--seed') { seedArg = argv[i + 1]; argv.splice(i, 2); break; }
  if (a.startsWith('--seed=')) { seedArg = a.slice(7); argv.splice(i, 1); break; }
}
if (seedArg != null && !/^\d+$/.test(seedArg)) {
  console.error(`--seed must be a non-negative integer (got "${seedArg}")`); process.exit(2);
}
const seed = seedArg != null ? Number(seedArg) : (Math.random() * 0x7fffffff) | 0;

const [cmd, arg] = argv;
const game = arg ? (isAbsolute(arg) ? arg : resolve(process.cwd(), arg)) : join(HERE, 'game.js');

if (cmd !== 'verify' && cmd !== 'play') {
  console.log('GameFilm game dev kit\n\n  node gf.mjs verify [game.js]              check it loads on gamefilm\n  node gf.mjs play   [game.js] [--seed N]   play it locally in your browser\n\n  (defaults to ./game.js; play uses a random seed unless --seed is given)');
  process.exit(cmd ? 1 : 0);
}
if (!existsSync(game)) { console.error(`game not found: ${game}`); process.exit(2); }

if (cmd === 'verify') {
  const r = spawnSync(process.execPath, [join(HERE, 'lib', 'verify.mjs'), game], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

// --- play: serve the real runtime + your game, open the browser ---
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.css': 'text/css', '.json': 'application/json' };
const PORT = 8123;
createServer(async (req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  try {
    let file;
    if (p === '/') file = join(HERE, 'runtime', 'play.html');
    else if (p === '/play/local/game.js') file = game;                 // your game, where the runtime imports it
    else if (p === '/play/local/favicon.svg') file = join(HERE, 'runtime', 'favicon.svg');
    else if (p.startsWith('/play/local/')) { res.writeHead(404); return res.end(); } // optional per-game audio.js etc.
    else if (p.startsWith('/runtime/')) file = join(HERE, p.slice(1));  // the runtime + SDK
    else { res.writeHead(404); return res.end('not found'); }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, () => {
  const url = `http://localhost:${PORT}/?seed=${seed}`;
  console.log(`\n▶ playing  ${game}\n   ${url}   (Ctrl-C to stop)`);
  console.log(`   seed ${seed}${seedArg != null ? '' : '  (random — rerun this exact world with --seed ' + seed + ')'}\n`);
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try { spawnSync(opener, [url], { stdio: 'ignore', shell: process.platform === 'win32' }); } catch { /* open it yourself */ }
});
