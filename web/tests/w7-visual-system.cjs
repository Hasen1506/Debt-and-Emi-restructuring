// Audit 80+ W7 (14 Oct 2026): visual system, "+ More" navigation, Portfolio +
// Tax merge, layout shift and screen-reader structure. Each test guards a
// class of defect across the whole source tree, not one repro. The browser
// side (rendered sizes, overflow, CLS, aria snapshot) is
// e2e/visual-system.spec.ts.
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
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText;
    module._compile(output, file);
  };
const lib = (name) => require(path.join(root, 'lib', name));
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(e.name)) out.push(p);
  }
  return out;
}
const FILES = walk(root).map((f) => ({ rel: path.relative(root, f), text: fs.readFileSync(f, 'utf8') }));

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

// ── B5: type floor ─────────────────────────────────────────────────────────
test('B5: the type scale tokens: 16px body, nothing under 12px', () => {
  const css = src('styles/globals.css');
  const tok = (name) => {
    const m = css.match(new RegExp(`--${name}:\\s*(\\d+)px`));
    assert.ok(m, `--${name} defined`);
    return Number(m[1]);
  };
  assert.equal(tok('fs-body'), 16);
  assert.ok(tok('fs-label') >= 12, 'labels at least 12px');
  for (const t of ['fs-small', 'fs-table', 'fs-dense']) assert.ok(tok(t) >= 14, `${t} at least 14px`);
  assert.ok(tok('fs-lead') > tok('fs-body') && tok('fs-figure') > tok('fs-lead') && tok('fs-h1') > tok('fs-figure'), 'the scale rises');
  // Body text is IBM Plex Sans, self-hosted (no third-party font request).
  const faces = css.match(/@font-face \{[^}]*\}/g) || [];
  const sans = faces.filter((f) => /IBM Plex Sans'/.test(f));
  assert.ok(sans.length >= 2, 'IBM Plex Sans faces');
  for (const f of sans) {
    const file = f.match(/url\('\/fonts\/([^']+)'\)/)[1];
    const bytes = fs.readFileSync(path.join(__dirname, '../public/fonts', file));
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'wOF2', `${file} is a woff2`);
  }
});

test('B5: no inline or stylesheet font size under 12px anywhere in the app', () => {
  const bad = [];
  for (const { rel, text } of FILES) {
    for (const m of text.matchAll(/fontSize:\s*'?(\d+(?:\.\d+)?)(px)?'?\s*[,}\n]/g)) {
      if (Number(m[1]) < 12) bad.push(`${rel}:${lineOf(text, m.index)} fontSize ${m[1]}`);
    }
    for (const m of text.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
      if (Number(m[1]) < 12) bad.push(`${rel}:${lineOf(text, m.index)} font-size ${m[1]}px`);
    }
  }
  assert.deepEqual(bad, []);
});

test('B5: the type-scale codemod has nothing left to convert to a smaller size', () => {
  // Re-running scripts/w7-type-scale.py after a merge is idempotent; any
  // numeric fontSize <= 11 it would move is caught by the test above.
  const py = fs.readFileSync(path.join(__dirname, '../scripts/w7-type-scale.py'), 'utf8');
  assert.match(py, /--fs-label/);
  assert.match(py, /--fs-small/);
});

// ── B26 / A20: four core tabs + More ───────────────────────────────────────
test('B26/A20: four core tabs; every other app section sits in More and lights More', () => {
  const nav = lib('app-nav.ts');
  assert.deepEqual(nav.CORE_TABS.map((t) => t.href), ['/', '/plan', '/activity', '/profile']);
  for (const t of nav.CORE_TABS) assert.equal(nav.sectionFromPath(t.href), t.key, t.href);
  const users = [
    { country: 'IN' },
    { country: 'US' },
    { country: 'US', is_nri_us: true },
  ];
  for (const u of users) {
    const groups = nav.moreGroups(u);
    const links = groups.flatMap((g) => g.links);
    const hrefs = links.map((l) => l.href.split('#')[0]);
    // The sections that used to be tabs, and the tools, are all one tap away.
    for (const must of ['/goals', '/portfolio', '/cant-pay', '/glossary', '/account']) assert.ok(hrefs.includes(must), `${JSON.stringify(u)} More has ${must}`);
    for (const l of links) {
      const p = l.href.split('#')[0];
      if (p === '/plan') continue; // Advance tax is a part of Plan.
      assert.equal(nav.sectionFromPath(p), 'more', `${l.href} lights More`);
      assert.ok(l.label && !/[[\]]/.test(l.label), `${l.href} has a plain label`);
    }
    // Each tool page linked exists.
    for (const p of hrefs.filter((h) => h.startsWith('/tools/'))) {
      assert.ok(fs.existsSync(path.join(root, 'app', p, 'page.tsx')), `${p} has a page`);
    }
    // NRI tools only for someone who said NRI (founder, 14 Oct 2026).
    const nri = links.some((l) => /nri/i.test(l.href));
    assert.equal(nri, u.is_nri_us === true, `${JSON.stringify(u)} NRI tools`);
  }
  // Pages outside the app light no tab.
  assert.equal(nav.sectionFromPath('/login'), null);
});

test('A20: Portfolio and Tax are one section: both pages carry the same sub-nav', () => {
  const nav = lib('app-nav.ts');
  assert.deepEqual(nav.ASSETS_TAX_TABS.map((t) => t.href), ['/portfolio', '/tax']);
  assert.match(src('app/portfolio/page.tsx'), /<AssetsTaxNav current="\/portfolio" \/>/);
  assert.match(src('app/tax/page.tsx'), /<AssetsTaxNav current="\/tax" \/>/);
  const sub = src('components/chrome/AssetsTaxNav.tsx');
  assert.match(sub, /aria-label="Assets and tax"/);
  assert.match(sub, /aria-current/);
});

test('B26: the masthead nav has no Portfolio/Goals/Tax tab of its own', () => {
  const mh = src('components/ledger/LMasthead.tsx');
  assert.match(mh, /CORE_TABS\.map/);
  assert.match(mh, /aria-controls="rd-more-panel"/);
  assert.match(mh, /aria-expanded=\{moreOpen\}/);
  assert.doesNotMatch(mh, /href="\/(portfolio|goals|tax)"/);
});

// ── B20: payoff order ─────────────────────────────────────────────────────
test('B20: the payoff order is a labelled radio group with a word for every strategy', () => {
  const { STRATEGIES } = lib('strategy.ts');
  const sw = require(path.join(root, 'components/chrome/PayoffOrderSwitch.tsx'));
  for (const s of STRATEGIES) assert.ok(sw.PAYOFF_SEGMENT[s] && sw.PAYOFF_SEGMENT[s].length <= 10, s);
  const t = src('components/chrome/PayoffOrderSwitch.tsx');
  assert.match(t, /role="radiogroup"/);
  assert.match(t, /role="radio"/);
  assert.match(t, /aria-checked=\{on\}/);
  assert.match(t, /ArrowRight/);
  assert.ok(!fs.existsSync(path.join(root, 'components/personas/StrategyMedallion.tsx')), 'medallion deleted');
  for (const { rel, text } of FILES) assert.doesNotMatch(text, /StrategyMedallion/, rel);
});

// ── E13: screen-reader structure ──────────────────────────────────────────
test('E13: no link or button text is wrapped in spoken bracket glyphs', () => {
  const bad = [];
  for (const { rel, text } of FILES) {
    if (!rel.endsWith('.tsx')) continue;
    // ">[WORDS]<" or ">[ WORDS ]<": the brackets must be aria-hidden spans.
    for (const m of text.matchAll(/>\s*\[\s*[A-Z][^\]<{}]*\]\s*</g)) bad.push(`${rel}:${lineOf(text, m.index)} ${m[0].trim()}`);
  }
  assert.deepEqual(bad, []);
  const p = src('components/ledger/primitives.tsx');
  assert.match(p, /<span aria-hidden="true">\[<\/span>\s*\{children\}\s*<span aria-hidden="true">\]<\/span>/);
});

test('E13: one footer landmark in the app shell', () => {
  const footers = FILES.filter(({ rel, text }) => rel.endsWith('.tsx') && /^\s*<footer\b/m.test(text)).map((f) => f.rel);
  assert.deepEqual(footers, ['components/site/SiteFooter.tsx']);
});

test('E13: KPI figures are a term list; the plan answer reads as whole words', () => {
  const p = src('components/ledger/primitives.tsx');
  assert.match(p, /<dl\s+aria-label=\{label\}/);
  const { monthsInWords } = lib('plan-headline.ts');
  for (let n = 0; n <= 600; n++) {
    const w = monthsInWords(n);
    assert.doesNotMatch(w, /\b(yrs?|mos?)\b/i, w);
    const y = Number((w.match(/(\d+) years?/) || [0, 0])[1]);
    const m = Number((w.match(/(\d+) months?/) || [0, 0])[1]);
    assert.equal(y * 12 + m, n, `${n} → ${w}`);
    assert.doesNotMatch(w, /\b1 (years|months)\b/, w);
  }
});

test('B18/E13: the month table has a caption and scoped headers; phones get cards', () => {
  const s = src('components/plan/PlanSchedule.tsx');
  assert.match(s, /<caption className="sr-only">/);
  assert.match(s, /scope="col"/);
  assert.match(s, /@media \(max-width: 820px\)\{\.rd-month-table\{display:none !important\}\.rd-month-cards\{display:block\}\}/);
  assert.match(s, /data-testid="month-card"/);
});

// ── B19: red means act ────────────────────────────────────────────────────
test('B19: planned figures (interest, the dearest loan) are never drawn in alarm red', () => {
  const home = src('components/home/LedgerHome.tsx');
  assert.doesNotMatch(home, /l: 'INTEREST'[^}]*tone: L_T\.negative/);
  const pos = src('components/home/OpenPositions.tsx');
  assert.doesNotMatch(pos, /isDearest \? L_T\.negative/);
  assert.doesNotMatch(pos, /isDearest \? lStrip\('negative'\)/);
});

// ── E10 / E11 ─────────────────────────────────────────────────────────────
test('E10: streamed Home strip and Setup hold their space; E11 marks time-to-useful once', () => {
  assert.match(src('app/page.tsx'), /fallback=\{hasOpenLoans \? <HomeThisMonthPlaceholder \/> : null\}/);
  const css = src('styles/globals.css');
  assert.match(css, /\.rd-this-month\s*\{[^}]*min-height/);
  assert.match(css, /\.rd-setup-shell\s*\{[^}]*min-height/);
  assert.match(src('app/onboarding/page.tsx'), /className="rd-setup-shell"/);
  const layout = src('app/layout.tsx');
  assert.equal((layout.match(/<UsefulMark \/>/g) || []).length, 1);
  assert.equal((layout.match(/import \{ UsefulMark \}/g) || []).length, 1);
  assert.match(src('components/site/UsefulMark.tsx'), /performance\.mark\('rd-useful'/);
});
