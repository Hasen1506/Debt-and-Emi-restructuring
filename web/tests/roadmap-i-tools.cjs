const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const test = require('node:test');
const root = path.resolve(__dirname, '../src');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
    if (request.startsWith('@/'))
        request = path.join(root, request.slice(2));
    return originalResolve.call(this, request, parent, ...rest);
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'next/navigation')
        return { useRouter: () => ({ refresh() { } }) };
    return originalLoad.call(this, request, ...rest);
};
for (const ext of ['.ts', '.tsx'])
    require.extensions[ext] = (module, file) => {
        const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText;
        module._compile(output, file);
    };
const lib = name => require(path.join(root, 'lib', name));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const py = (p) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

// PR D (roadmap 2026-10-07): user-programmable values, defaults shown and editable.
const repo = path.resolve(__dirname, '../..');

// PR I (roadmap 2026-10-07): Right time removed; Big purchase merged into New debt check (?mode=purchase).

test('the tools list has no Right time and no separate Big purchase; New debt check covers purchases', () => {
  const { TOOLS } = lib('tools.ts');
  const ids = TOOLS.map((t) => t.id);
  assert.ok(!ids.includes('right-time'), 'Right time is retired');
  assert.ok(!ids.includes('purchase'), 'Big purchase is a mode of New debt check');
  const nd = TOOLS.find((t) => t.id === 'new-debt');
  assert.match(nd.question + ' ' + nd.sub, /purchase/i);
  for (const t of TOOLS) assert.ok(fs.existsSync(path.join(root, 'app', t.href.replace(/^\//, ''), 'page.tsx')), `${t.href} has a page`);
});

test('?mode=purchase picks the purchase mode; anything else is the loan-offer mode', () => {
  const { newDebtMode } = lib('new-debt-mode.ts');
  assert.equal(newDebtMode('purchase'), 'purchase');
  for (const v of [undefined, '', 'offer', 'PURCHASE', ['purchase'], 'right-time']) assert.equal(newDebtMode(v), 'offer');
});

test('New debt check renders the purchase tool under ?mode=purchase and the offer tool otherwise', () => {
  const s = src('app/tools/new-debt/page.tsx');
  assert.match(s, /mode === 'purchase' \? <PurchaseTool \/> : <NewDebtTool \/>/);
  assert.match(s, /href="\/tools\/new-debt\?mode=purchase"/);
  assert.match(s, /newDebtMode\(\(await searchParams\)\?\.mode\)/);
});

test('old links redirect, the removed routes are gone, and nothing still links to them', () => {
  const cfg = fs.readFileSync(path.join(repo, 'web/next.config.mjs'), 'utf8');
  assert.match(cfg, /source: '\/tools\/purchase', destination: '\/tools\/new-debt\?mode=purchase'/);
  assert.match(cfg, /source: '\/tools\/right-time', destination: '\/tools\/new-debt'/);
  assert.ok(!fs.existsSync(path.join(root, 'app/tools/right-time')), 'right-time route removed');
  assert.ok(!fs.existsSync(path.join(root, 'app/tools/purchase/page.tsx')), 'purchase page removed (tool lives on in new-debt)');
  assert.ok(!fs.existsSync(path.join(root, 'components/ledger/RateOdds.tsx')), 'odds widget removed');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = [...walk(root), ...walk(path.join(repo, 'scripts')), ...walk(path.join(repo, 'web/e2e'))].filter((f) => /\.(tsx?|cjs|mjs|js)$/.test(f));
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(t, /['"`(]\/tools\/right-time|\/api\/right-time-to-borrow|\/api\/rates\/odds|\brightTime: \(|api\.rightTime\b|api\.rateOdds\b|\brateOdds: \(/, `${path.relative(repo, f)} still uses Right time`);
    assert.doesNotMatch(t, /['"`(]\/tools\/purchase['"`)]|base ?\+ ?'\/tools\/purchase'/, `${path.relative(repo, f)} still links to /tools/purchase`);
  }
});
