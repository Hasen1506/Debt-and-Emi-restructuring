// UX50 F1 (landing and public site): the gate lets unknown paths 404, the
// gated list covers every app page, robots/sitemap/manifest, the landing's
// head tags and the landing fixes that are plain HTML.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const test = require('node:test');
const root = path.resolve(__dirname, '../src');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, ...rest);
};
for (const ext of ['.ts', '.tsx'])
  require.extensions[ext] = (module, file) => {
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    module._compile(output, file);
  };
const WELCOME = fs.readFileSync(path.resolve(__dirname, '../public/welcome.html'), 'utf8');

test('E-13: every app page folder is gated; public pages and unknown paths are not', () => {
  const { isGatedAppPath, GATED_ROOTS } = require(path.join(root, 'lib/app-routes.ts'));
  const PUBLIC = new Set(['login', 'glossary', 'privacy', 'terms', 'account', 'api', 'cant-pay']);
  const dirs = fs.readdirSync(path.join(root, 'app'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const d of dirs) if (!PUBLIC.has(d)) assert.ok(GATED_ROOTS.includes(d), `app/${d} is a page folder but isn't in GATED_ROOTS`);
  for (const p of ['/', '/plan', '/plan/x', '/profile/assets', '/tools/windfall', '/onboarding', '/tax']) assert.ok(isGatedAppPath(p), p);
  for (const p of ['/this-does-not-exist', '/glossarry', '/docs', '/.well-known/security.txt', '/plans', '/toolsx']) assert.ok(!isGatedAppPath(p), p);
  const mw = fs.readFileSync(path.join(root, 'middleware.ts'), 'utf8');
  assert.match(mw, /if \(!isGatedAppPath\(url\.pathname\)\) return next\(\);/);
  // The static files a signed-out browser asks for skip the gate.
  for (const f of ['manifest\\\\.webmanifest', 'og\\\\.png', 'apple-touch-icon\\\\.png', 'apple-icon\\\\.png', 'favicon\\\\.ico', 'robots\\\\.txt', 'sitemap\\\\.xml']) assert.ok(mw.includes(f), f);
});

test('E-13 / E-16: robots, sitemap and manifest', () => {
  const robots = require(path.join(root, 'app/robots.ts')).default();
  assert.equal(robots.sitemap, 'https://rightdue.app/sitemap.xml');
  assert.ok(robots.rules[0].allow.includes('/tools/loan-check'));
  for (const p of ['/api/', '/plan', '/profile', '/activity', '/account']) assert.ok(robots.rules[0].disallow.includes(p), p);
  const sm = require(path.join(root, 'app/sitemap.ts')).default().map((e) => e.url);
  assert.deepEqual(sm, ['https://rightdue.app/', 'https://rightdue.app/tools/loan-check', 'https://rightdue.app/glossary', 'https://rightdue.app/privacy', 'https://rightdue.app/terms']);
  const mf = require(path.join(root, 'app/manifest.ts')).default();
  assert.equal(mf.start_url, '/');
  assert.equal(mf.display, 'standalone');
  for (const i of mf.icons) if (i.src.endsWith('.png')) assert.ok(fs.existsSync(path.resolve(__dirname, '../public' + i.src)), i.src);
  assert.ok(mf.icons.some((i) => i.purpose === 'maskable'));
  for (const f of ['public/og.png', 'public/og-loan-check.png', 'public/apple-touch-icon.png', 'src/app/favicon.ico', 'src/app/apple-icon.png'])
    assert.ok(fs.existsSync(path.resolve(__dirname, '..', f)), f);
});

test('A-13 / E-14 / E-16: the landing head has icons, share card, canonical and JSON-LD', () => {
  for (const rx of [/<link rel="icon" href="\/favicon\.ico"/, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/, /<meta property="og:image" content="https:\/\/rightdue\.app\/og\.png">/,
    /<meta name="twitter:card" content="summary_large_image">/, /<link rel="canonical" href="https:\/\/rightdue\.app\/">/, /<meta name="theme-color"/, /<link rel="manifest"/])
    assert.match(WELCOME, rx);
  const ld = JSON.parse(WELCOME.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
  assert.equal(ld['@type'], 'WebApplication');
  assert.equal(ld.offers.price, '0');
  // A-12: only the weights the page uses.
  // (R6: now self-hosted instead of the Google Fonts URL; still exactly 400 and 700.)
  const weights = [...WELCOME.matchAll(/@font-face \{[^}]*font-family: 'IBM Plex Mono';[^}]*font-weight: (\d+);/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(weights)].sort(), ['400', '700']);
});

test('A-08 / A-12 / A-19 / A-20 / A-24 / A-25: landing HTML fixes', () => {
  // The masthead wrapper and the register row no longer share a class.
  assert.doesNotMatch(WELCOME, /class="top"|\.top\{|class="row top"/);
  assert.match(WELCOME, /<div class="topbar">/);
  assert.match(WELCOME, /class="row first"/);
  // Hero and register paint without JS.
  assert.doesNotMatch(WELCOME, /<div class="hero">\s*<div class="rv">/);
  assert.doesNotMatch(WELCOME, /class="card rv[^"]*" id="register"/);
  // The stamps run once.
  assert.doesNotMatch(WELCOME, /x\.textContent = 'MARK PAID'/);
  assert.match(WELCOME, /\.stamp\{[^}]*pointer-events:none/);
  // A trust line under the CTAs (no lender-money promise until the founder decides).
  assert.match(WELCOME, /<ul class="trust"[\s\S]*?Free[\s\S]*?No bank login[\s\S]*?Not a lender/);
  assert.doesNotMatch(WELCOME, /no bank or app pays us/i);
  assert.doesNotMatch(WELCOME, /Six tools: a bonus, a new loan, a sale, invest or prepay/);
  // Every tool card says whether it needs sign-in.
  const cards = WELCOME.match(/<a class="tool[\s\S]*?<\/a>/g);
  assert.equal(cards.length, 6);
  for (const c of cards) assert.match(c, /class="tag( gated)?">(OPEN · NO SIGN-IN|SIGN IN TO USE) →/);
  // The footer has 24px targets and the email once (it's in About).
  assert.match(WELCOME, /\.foot a\{display:inline-block;padding:6px 0;min-height:24px\}/);
  const foot = WELCOME.match(/<footer>[\s\S]*?<\/footer>/)[0];
  assert.doesNotMatch(foot, /mailto:/);
  assert.match(WELCOME, /this&nbsp;month\./);
});

test('A-14: the 404 has no /tax leftover and offers a way back for guests', () => {
  const nf = fs.readFileSync(path.join(root, 'app/not-found.tsx'), 'utf8');
  assert.doesNotMatch(nf, /Tax settings are in Profile/);
  assert.match(nf, /BACK TO RIGHTDUE/);
  assert.match(nf, /GO TO HOME/);
});
