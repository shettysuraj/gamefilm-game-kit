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

// Convert a literal-only AST expression into its JS value, or throw if it isn't statically static.
function astToValue(node) {
  switch (node.type) {
    case 'Literal': return node.value;
    case 'TemplateLiteral':
      if (node.expressions.length) throw new Error('template literal with interpolation');
      return node.quasis.map((q) => q.value.cooked).join('');
    case 'ArrayExpression': return node.elements.map((e) => (e ? astToValue(e) : null));
    case 'ObjectExpression': {
      const o = {};
      for (const p of node.properties) {
        if (p.type !== 'Property' || p.computed) throw new Error('computed/spread property');
        const key = p.key.type === 'Identifier' ? p.key.name : p.key.value;
        o[key] = astToValue(p.value);
      }
      return o;
    }
    case 'UnaryExpression':
      if (node.operator === '-') return -astToValue(node.argument);
      if (node.operator === '+') return +astToValue(node.argument);
      throw new Error('unary ' + node.operator);
    case 'Identifier':
      if (node.name === 'undefined') return undefined;
      throw new Error('identifier reference: ' + node.name);
    default: throw new Error('non-static ' + node.type);
  }
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
            try { GAME_META = astToValue(dec.init); metaStatic = true; } catch (e) { metaErr = e.message; }
          }
          if (dec.id.name === 'ENGINE_VERSION' && dec.init) {
            try { ENGINE_VERSION = astToValue(dec.init); } catch { /* non-static */ }
          }
          if (dec.id.name === 'SCHEMA' && dec.init) {
            try { SCHEMA = astToValue(dec.init); schemaStatic = true; } catch (e) { schemaErr = e.message; }
          }
          if (dec.id.name === 'VERSION_CHANGELOG' && dec.init) {
            try { VERSION_CHANGELOG = astToValue(dec.init); } catch { /* non-static */ }
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
