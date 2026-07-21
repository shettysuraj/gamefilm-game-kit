// GENERATED FILE — do not edit. Source: verifier/static-checks.js
// Run: node scripts/sync-verify.mjs (in the gamefilm repo)
// acorn is vendored here (lib/vendor/) because the kit ships with no node_modules.

import { parse } from './vendor/acorn.mjs';
import * as walk from './vendor/acorn-walk.mjs';

function parseModule(source) {
  return parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
}

const isRel = (v) => typeof v === 'string' && (v.startsWith('./') || v.startsWith('../'));

// Walk the AST collecting hard/soft forbidden-API hits and relative-import hits.
function scan(ast) {
  const hard = [], soft = [];
  const L = (n) => n.loc.start.line;
  const memberIs = (n, obj, prop) => n.type === 'MemberExpression'
    && n.object.type === 'Identifier' && n.object.name === obj
    && ((n.property.type === 'Identifier' && !n.computed && n.property.name === prop)
      || (n.property.type === 'Literal' && n.property.value === prop));

  walk.simple(ast, {
    CallExpression(n) {
      const c = n.callee;
      if (c.type === 'Identifier') {
        if (c.name === 'eval') hard.push(`L${L(n)}: eval (code injection)`);
        if (c.name === 'fetch') hard.push(`L${L(n)}: fetch (network)`);
      }
      if (memberIs(c, 'Math', 'random')) soft.push(`L${L(n)}: Math.random — render/UI only`);
      if (memberIs(c, 'Date', 'now')) soft.push(`L${L(n)}: Date.now — render/UI only`);
      if (memberIs(c, 'performance', 'now')) soft.push(`L${L(n)}: performance.now — render/UI only`);
    },
    NewExpression(n) {
      if (n.callee.type === 'Identifier') {
        const nm = n.callee.name;
        if (nm === 'Function') hard.push(`L${L(n)}: new Function (code injection)`);
        if (nm === 'WebSocket') hard.push(`L${L(n)}: WebSocket (network)`);
        if (nm === 'XMLHttpRequest') hard.push(`L${L(n)}: XMLHttpRequest (network)`);
        if (nm === 'Date') soft.push(`L${L(n)}: new Date — render/UI only`);
      }
    },
    ImportExpression(n) { hard.push(`L${L(n)}: dynamic import() (loads external code)`); },
    MemberExpression(n) {
      if (memberIs(n, 'document', 'cookie')) hard.push(`L${L(n)}: document.cookie`);
      if (n.object.type === 'Identifier' && (n.object.name === 'localStorage' || n.object.name === 'sessionStorage'))
        soft.push(`L${L(n)}: ${n.object.name} — settings/UI only`);
    },
    ImportDeclaration(n) { if (isRel(n.source?.value)) hard.push(`L${L(n)}: relative import "${n.source.value}" (must be self-contained)`); },
    ExportNamedDeclaration(n) { if (n.source && isRel(n.source.value)) hard.push(`L${L(n)}: relative re-export "${n.source.value}"`); },
    ExportAllDeclaration(n) { if (isRel(n.source?.value)) hard.push(`L${L(n)}: relative re-export "${n.source.value}"`); },
  });
  return { hard, soft };
}

// Convert an AST expression into its JS value, or throw if it can't be evaluated without running
// the program. `resolve(name)` (optional) looks a module-scope const up in the symbol table —
// without it, only pure literals evaluate.
//
// Constant references are deliberately supported. A game that writes `canvas: { width: C.W }` is
// doing the right thing — one definition, no duplicated 390 that can silently disagree with the
// engine. Demanding inline literals here would push authors toward the more bug-prone spelling to
// satisfy a checker, which is backwards.
// Read-only value namespaces safe to dereference during static evaluation. Values only — the
// MemberExpression case rejects anything callable, so Math.PI resolves and Math.floor() does not.
const SAFE_GLOBALS = { Math, Number, Infinity, NaN };

function astToValue(node, resolve = null) {
  const ev = (n) => astToValue(n, resolve);
  switch (node.type) {
    case 'Literal': return node.value;
    case 'TemplateLiteral': {
      // `...${LEVELS.length} levels...` is how a self-describing SCHEMA is naturally written;
      // it evaluates fine as long as every interpolation is itself static.
      const parts = [node.quasis[0].value.cooked];
      node.expressions.forEach((e, i) => { parts.push(String(ev(e)), node.quasis[i + 1].value.cooked); });
      return parts.join('');
    }
    case 'ArrayExpression': return node.elements.map((e) => (e ? ev(e) : null));
    case 'ObjectExpression': {
      const o = {};
      for (const p of node.properties) {
        if (p.type !== 'Property' || p.computed) throw new Error('computed/spread property');
        const key = p.key.type === 'Identifier' ? p.key.name : p.key.value;
        o[key] = ev(p.value);
      }
      return o;
    }
    case 'UnaryExpression':
      if (node.operator === '-') return -ev(node.argument);
      if (node.operator === '+') return +ev(node.argument);
      if (node.operator === '!') return !ev(node.argument);
      throw new Error('unary ' + node.operator);
    case 'BinaryExpression': {
      const l = ev(node.left), r = ev(node.right);
      switch (node.operator) {
        case '+': return l + r;   case '-': return l - r;
        case '*': return l * r;   case '/': return l / r;
        case '%': return l % r;   case '**': return l ** r;
        default: throw new Error('binary ' + node.operator);
      }
    }
    case 'MemberExpression': {
      const obj = ev(node.object);
      if (obj == null) throw new Error('member access on null/undefined');
      const key = node.computed ? ev(node.property)
        : node.property.type === 'Identifier' ? node.property.name : node.property.value;
      // .length on a resolved array/string is static; anything callable is not.
      const v = obj[key];
      if (typeof v === 'function') throw new Error('member is a function');
      return v;
    }
    case 'Identifier':
      if (node.name === 'undefined') return undefined;
      // `MAX_BOUNCE_ANGLE: Math.PI / 3` is a constant, not code. Reading a numeric property off
      // one of these is pure; calling anything on them is still a CallExpression and still throws.
      if (Object.hasOwn(SAFE_GLOBALS, node.name)) return SAFE_GLOBALS[node.name];
      if (resolve) return resolve(node.name);
      throw new Error('identifier reference: ' + node.name);
    default: throw new Error('non-static ' + node.type);
  }
}

// Symbol table over module-scope `const` bindings, resolved lazily so declaration order and
// const-referencing-const both work. Cycles throw rather than hang.
function buildResolver(ast) {
  const raw = new Map();
  for (const node of ast.body) {
    const d = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (!d || d.type !== 'VariableDeclaration' || d.kind !== 'const') continue;
    for (const dec of d.declarations) {
      if (dec.id.type === 'Identifier' && dec.init) raw.set(dec.id.name, dec.init);
    }
  }
  const cache = new Map(), inProgress = new Set();
  return function resolve(name) {
    if (cache.has(name)) return cache.get(name);
    if (inProgress.has(name)) throw new Error(`circular constant: ${name}`);
    if (!raw.has(name)) throw new Error(`identifier reference: ${name}`);
    inProgress.add(name);
    try {
      const v = astToValue(raw.get(name), resolve);
      cache.set(name, v);
      return v;
    } finally { inProgress.delete(name); }
  };
}

// GAME_META keys the platform reads WITHOUT running the game — the cartridge manifest
// (build-cartridge.js) and the DB row (db.js ensureGameRegistered). These must be statically
// readable if present. Everything else in GAME_META (levels, lives, per-game extras) is read at
// runtime from the loaded module, so it may be computed however the author likes.
const ESSENTIAL_META_KEYS = [
  'name', 'description', 'icon', 'sortOrder', 'input', 'canvas', 'result', 'cardStats',
  'subdomain', 'hostUrl', 'url', 'cartridge',
];

// Evaluate an object expression property-by-property so one computed field doesn't sink the rest.
function objectPartial(node, resolve) {
  const out = {}, failed = [];
  for (const p of node.properties) {
    if (p.type !== 'Property' || p.computed) { failed.push('<computed/spread>'); continue; }
    const key = p.key.type === 'Identifier' ? p.key.name : p.key.value;
    try { out[key] = astToValue(p.value, resolve); }
    catch (e) { failed.push(`${key} (${e.message})`); }
  }
  return { value: out, failed };
}

// Statically extract exports + GAME_META + ENGINE_VERSION + SCHEMA + VERSION_CHANGELOG
// (no execution). This is the execution-free alternative to `await import(game.js)` — the whole
// point is that reading a game's metadata must never run the game's code. SCHEMA/VERSION_CHANGELOG
// are usually plain template literals and extract fine; a game that BUILDS its SCHEMA at runtime
// (string concat, function call) is not statically readable and the caller must decide what to do
// about it — see `metaStatic` / `schemaStatic`.
export function extractMeta(source) {
  let ast;
  try { ast = parseModule(source); }
  catch (e) { return { ok: false, error: `parse error: ${e.message}` }; }
  const resolve = buildResolver(ast);
  const exports = new Set();
  let GAME_META, ENGINE_VERSION, SCHEMA, VERSION_CHANGELOG;
  let metaStatic = false, metaErr = '', schemaStatic = false, schemaErr = '';
  for (const node of ast.body) {
    if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      const d = node.declaration;
      if (d.type === 'VariableDeclaration') {
        for (const dec of d.declarations) {
          if (dec.id.type !== 'Identifier') continue;
          exports.add(dec.id.name);
          if (dec.id.name === 'GAME_META' && dec.init) {
            if (dec.init.type !== 'ObjectExpression') {
              metaErr = `GAME_META is ${dec.init.type}, expected an object literal`;
            } else {
              const { value, failed } = objectPartial(dec.init, resolve);
              GAME_META = value;
              // Only an ESSENTIAL key failing is a problem — a computed `levels` is fine.
              const blocking = failed.filter((f) => ESSENTIAL_META_KEYS.some((k) => f.startsWith(k + ' ') || f === '<computed/spread>'));
              metaStatic = blocking.length === 0;
              if (blocking.length) metaErr = blocking.join('; ');
            }
          }
          if (dec.id.name === 'ENGINE_VERSION' && dec.init) {
            try { ENGINE_VERSION = astToValue(dec.init, resolve); } catch { /* non-static */ }
          }
          if (dec.id.name === 'SCHEMA' && dec.init) {
            try { SCHEMA = astToValue(dec.init, resolve); schemaStatic = true; } catch (e) { schemaErr = e.message; }
          }
          if (dec.id.name === 'VERSION_CHANGELOG' && dec.init) {
            try { VERSION_CHANGELOG = astToValue(dec.init, resolve); } catch { /* non-static */ }
          }
        }
      } else if (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') {
        if (d.id) exports.add(d.id.name);
      }
    } else if (node.type === 'ExportDefaultDeclaration') {
      exports.add('default');
    }
  }
  return {
    ok: true, exports: [...exports],
    GAME_META, ENGINE_VERSION, SCHEMA, VERSION_CHANGELOG,
    metaStatic, metaErr, schemaStatic, schemaErr,
  };
}

// Produce the static-tier check rows for the harness.
export function staticChecks(source) {
  let ast;
  try { ast = parseModule(source); }
  catch (e) {
    return [{ name: 'static: parses as an ES module', level: 'fail', detail: e.message }];
  }
  const { hard, soft } = scan(ast);
  const meta = extractMeta(source);
  return [
    { name: 'static: parses as an ES module', level: 'pass', detail: '' },
    { name: 'static (hard): no network / eval / dynamic-import / relative-import / cookies', level: hard.length ? 'fail' : 'pass', detail: hard.slice(0, 12).join('; ') },
    { name: 'static (warn): determinism-sensitive APIs are render/UI-only', level: soft.length ? 'warn' : 'pass', detail: soft.length ? `${soft.length} hit(s) — OK iff the determinism check passes. ${soft.slice(0, 6).join('; ')}${soft.length > 6 ? ' …' : ''}` : '' },
    { name: 'static: GAME_META is statically extractable (literal object — needed for the cartridge build)', level: meta.metaStatic ? 'pass' : 'fail', detail: meta.metaStatic ? '' : `GAME_META has non-literal values (${meta.metaErr || 'not found'})` },
  ];
}
