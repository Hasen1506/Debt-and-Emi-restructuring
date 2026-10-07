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

// PR C (roadmap 2026-10-07): the true annual cost, the TypeScript twin of engine/true_apr.py.
test('differential: the TypeScript true annual cost matches the engine on every fixture case', () => {
  const { trueApr } = lib('true-apr.ts');
  const cases = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../engine/tests/fixtures/true_apr_cases.json'), 'utf8'));
  assert.ok(cases.length >= 40);
  for (const c of cases) {
    const got = trueApr(c.in);
    for (const k of Object.keys(c.out)) assert.ok(Math.abs(got[k] - c.out[k]) < 1e-9, `${JSON.stringify(c.in)} ${k}: ${got[k]} vs ${c.out[k]}`);
  }
});

test('the breakdown shows the true annual cost: a 42% Indian card is about 62.5%, not 49.56%', () => {
  const { computeBreakdown } = lib('effective-apr.ts');
  const loan = { id: 'c', bank: 'HDFC', loan_type: 'credit_card', outstanding: '50000', nominal_rate: '0.42', currency: 'INR' };
  const b = computeBreakdown(loan, '0.3', 'IN', undefined);
  assert.equal(b.effective.toFixed(4), '0.4956');
  // Rendered from the breakdown component's module, which the Home row and Profile open.
  const src = fs.readFileSync(path.join(root, 'components/EffectiveAprBreakdown.tsx'), 'utf8');
  assert.match(src, /<TrueAnnualCost loan=\{loan\} lines=\{lines\} \/>/);
  const { TrueAnnualCost } = require(path.join(root, 'components/EffectiveAprBreakdown.tsx'));
  const html = renderToStaticMarkup(React.createElement(TrueAnnualCost, { loan, lines: b.lines }));
  assert.match(html, /True annual cost/);
  assert.match(html, /Monthly compounding/);
  assert.match(html, /= 62\.52%/);
  const { trueAprInputsFromBreakdown } = lib('true-apr.ts');
  const x = trueAprInputsFromBreakdown(loan, b.lines);
  assert.ok(Math.abs(x.gst_on_interest - 0.18) < 1e-12); assert.equal(x.months, null); assert.equal(x.shield, 0);
});
