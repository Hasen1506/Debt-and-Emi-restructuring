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
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// UX50 F3 (critique C): tools, Profile, mobile, a11y.
const engineSrc = fs.readFileSync(path.resolve(__dirname, '../../engine/tax/india.py'), 'utf8');

test('C-18: the Profile slab popover lines come from the engine table (12–16, 16–20, 20–24 lakh, 30% above 24)', () => {
  const tb = lib('tax-brackets.ts');
  assert.deepEqual(tb.inNewRegimeSlabLines(), [
    '₹0–4 lakh: 0%',
    '₹4–8 lakh: 5%',
    '₹8–12 lakh: 10%',
    '₹12–16 lakh: 15%',
    '₹16–20 lakh: 20%',
    '₹20–24 lakh: 25%',
    'Above ₹24 lakh: 30%',
  ]);
  assert.match(engineSrc, /D\("2400000"\),\s+D\("0\.25"\)/);
  const profile = src('app/profile/ProfileClient.tsx');
  assert.match(profile, /inNewRegimeSlabLines\(\)/);
  assert.doesNotMatch(profile, /12–15L|Above ₹20L: 30%|New regime \(FY 2025-26\)/);
});

test('C-19: limits are written out in lakh, one formatter', () => {
  const { formatScale } = lib('amount.ts');
  assert.equal(formatScale(200000), '₹2 lakh');
  assert.equal(formatScale(150000), '₹1.5 lakh');
  assert.equal(formatScale(10000000), '₹1 crore');
  assert.equal(formatScale(75000), '₹75,000');
  assert.doesNotMatch(src('components/tax/TaxPage.tsx'), /₹2L|₹1\.5L/);
});

test('C-01/C-06: LField renders a real <label for> tied to its input, a numeric keypad and no spinner', () => {
  const p = src('components/ledger/primitives.tsx');
  const field = p.slice(p.indexOf('export function LField'), p.indexOf('// ─── LCardHard'));
  assert.match(field, /useId\(\)/);
  assert.match(field, /<label\s+htmlFor=\{editable \? id : undefined\}/);
  assert.match(field, /id=\{id\}/);
  assert.match(field, /type="text"/);
  assert.match(field, /aria-invalid/);
  assert.doesNotMatch(field, /fontSize: 9\b/);
});

test('C-02/C-04/C-24: phones get 16px fields and 44px bracket targets; reduced motion is honoured', () => {
  const css = src('styles/globals.css');
  assert.match(css, /@media \(max-width: 640px\)\s*\{\s*input,\s*select,\s*textarea,\s*\.l-field-input\s*\{\s*font-size: 16px !important;/);
  assert.match(css, /@media \(pointer: coarse\)[\s\S]*min-height: 44px/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(src('lib/motion.ts'), /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(src('components/activity/ActivityPage.tsx'), /behavior: 'smooth'/);
  assert.doesNotMatch(src('app/login/page.tsx'), /fontSize: 15,/);
});

test('C-03/C-11: money fields open the number pad; take-home and spending examples are monthly-sized', () => {
  const tp = src('components/ToolPrimitives.tsx');
  assert.match(tp, /kind === 'decimal' \|\| isPercent \|\| isMoney \? 'decimal'/);
  assert.doesNotMatch(tp, /'e\.g\. 25,00,000 or 25L' : 'e\.g\. 250,000 or 250k'\) : undefined/);
  const qs = src('components/setup/QuickSetup.tsx');
  assert.match(qs, /e\.g\. 65,000 or 65k/);
  assert.match(qs, /e\.g\. 30,000 or 30k/);
  const { parseAmountText } = lib('amount.ts');
  assert.equal(parseAmountText('65k').value, '65000');
});

test('C-08: every Activity row child is a cell (narrow rows held the action buttons outside one)', () => {
  const a = src('components/activity/ActivityPage.tsx');
  assert.match(a, /<span role="cell" style=\{\{ gridColumn: '2 \/ -1'/);
});

test('C-20: no bare toLocaleString(); lint bans it', () => {
  for (const f of ['app/profile/assumptions/AssumptionsClient.tsx', 'components/onboarding/DeductionsPanel.tsx', 'lib/expense-commit.ts']) {
    assert.doesNotMatch(src(f), /\.toLocaleString\(\)/, f);
  }
  const lint = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../.eslintrc.json'), 'utf8'));
  assert.match(JSON.stringify(lint.rules['no-restricted-syntax']), /toLocaleString/);
  assert.match(src('lib/expense-commit.ts'), / a month to fund/);
});

test('C-26/E-15: every page has its own tab title', () => {
  const pages = ['activity/page.tsx', 'goals/page.tsx', 'plan/page.tsx', 'profile/page.tsx', 'tax/page.tsx', 'portfolio/page.tsx', 'glossary/page.tsx', 'onboarding/page.tsx',
    'tools/windfall/page.tsx', 'tools/new-debt/page.tsx', 'tools/loan-check/page.tsx', 'tools/liquidate/page.tsx', 'tools/invest-vs-prepay/page.tsx', 'tools/cash-yield/page.tsx',
    'tools/nri-prepay/page.tsx', 'tools/recompute/page.tsx', 'account/layout.tsx', 'login/layout.tsx', 'profile/assets/layout.tsx', 'cant-pay/page.tsx'];
  const titles = pages.map((p) => { const m = /title: (?:'([^']+)'|"([^"]+)")/.exec(src('app/' + p)); return m ? m[1] ?? m[2] : undefined; });
  titles.forEach((t, i) => assert.match(t ?? '', / · RightDue$/, pages[i]));
  assert.equal(new Set(titles).size, titles.length);
});

test('C-23 / C-25 / C-10 / C-12: glyph hidden, one gross-pay label, email in its own case, wrong code refocuses', () => {
  assert.match(src('app/tools/new-debt/tool.tsx'), /<span aria-hidden="true">\{on \? '● ' : '○ '\}<\/span>/);
  const tax = src('components/tax/TaxPage.tsx');
  assert.equal((tax.match(/ADD YOUR GROSS PAY/g) ?? []).length, 2);
  assert.doesNotMatch(tax, /ENTER GROSS PAY INSTEAD|ADD GROSS INCOME/);
  assert.doesNotMatch(src('components/chrome/SessionIndicator.tsx'), /toUpperCase\(\)/);
  const login = src('app/login/page.tsx');
  assert.match(login, /codeRef\.current\?\.select\(\)/);
  assert.doesNotMatch(login, /disabled=\{submitting \|\| !email/);
});

test('C-05: the hardship letter is editable with copy, email, share and download', () => {
  const c = src('components/distress/CantPay.tsx');
  assert.doesNotMatch(c, /readOnly/);
  for (const s of ['COPY LETTER', 'EMAIL IT', 'SHARE', 'DOWNLOAD .TXT', 'RESET TO DRAFT', 'navigator.clipboard.writeText', 'label="Lender"', 'label="Your name"']) assert.ok(c.includes(s), s);
});

test('Invest or prepay: a bad inflation or years field says why the runs are missing (O-1); retyping a loan rate keeps it picked (O-2)', () => {
  const t = src('app/tools/invest-vs-prepay/tool.tsx');
  assert.match(t, /Fix "Prices rise a year" to see the 5,000 runs/);
  assert.match(t, /loans\.find\(\(l\) => Number\(pctOf\(l\.effective\)\) === n\)/);
});
