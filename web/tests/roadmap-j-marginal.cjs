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

// PR E (roadmap 2026-10-07): "Your rules" replaces Hybrid.

const Decimal = require('decimal.js');

// PR J (roadmap 2026-10-07, founder decision): rank payoff by the marginal
// cost of the next rupee prepaid. One formula, engine and web, kept equal here.
const cases = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../engine/tests/fixtures/marginal_cost_cases.json'), 'utf8'));
const close = (a, b, msg) => assert.ok(new Decimal(a).minus(new Decimal(b)).abs().lt('1e-15'), `${msg}: ${a} vs ${b}`);

test('differential: marginalCost equals the engine on every component', () => {
  const { marginalCost } = lib('marginal-cost.ts');
  assert.ok(cases.cost.length >= 80);
  for (const c of cases.cost) {
    const a = c.args;
    const mc = marginalCost(a.nominal_rate, a.card_gst, a.shield_fraction, a.prepayment_fee_pct, a.months_left, a.lock_in_months);
    for (const [k, py] of [['interest', 'interest'], ['gst', 'gst'], ['taxBenefit', 'tax_benefit'], ['fee', 'fee'], ['total', 'total'], ['orderKey', 'order_key']]) close(mc[k], c.out[py], `${k} ${JSON.stringify(a)}`);
    assert.equal(mc.lockInMonths, c.out.lock_in_months);
  }
});

test('differential: marginalShield equals the engine (caps, regimes, itemising)', () => {
  const { marginalShield } = lib('marginal-cost.ts');
  assert.ok(cases.shield.length >= 400);
  for (const c of cases.shield) {
    const a = c.args;
    close(marginalShield(a.loan_type, a.country, a.marginal_rate, a.regime, a.itemises, a.itemised_share, a.interest_total, a.debt_total, a.phaseout_factor), c.out, JSON.stringify(a));
  }
});

test('differential: per-portfolio marginal costs and the avalanche order equal the engine', () => {
  const { userMarginalCosts } = lib('marginal-cost.ts');
  const { payoffOrders } = lib('payoff-order.ts');
  assert.ok(cases.portfolio.length >= 60);
  for (const c of cases.portfolio) {
    const user = { country: c.user.country, tax_regime: c.user.tax_regime ?? undefined, loans: c.loans.map((l) => ({ ...l, currency: l.currency ?? undefined })) };
    const mcs = userMarginalCosts(user, c.marginal_rate);
    c.costs.forEach((py, i) => close(mcs.get(i).total, py.total, `loan ${i} ${JSON.stringify(c)}`));
    assert.deepEqual(payoffOrders(user, c.marginal_rate).avalanche, c.avalanche, JSON.stringify(c));
  }
});

test('sunk costs are out, a binding cap gives no tax benefit, locked loans go last', () => {
  const { userMarginalCosts } = lib('marginal-cost.ts');
  const { payoffOrders } = lib('payoff-order.ts');
  const base = { loan_type: 'personal_loan', outstanding: '300000', tenure_months_remaining: 60, scheduled_emi: '7000', rate_type: 'fixed', bank: 'X' };
  // A 14% loan with fees (old key: 18.7% effective) vs a plain 16% loan.
  const u1 = { country: 'IN', tax_regime: 'new', loans: [{ ...base, nominal_rate: '0.14', processing_fee_amortised: '0.03', insurance_premium_pct: '0.015' }, { ...base, nominal_rate: '0.16' }] };
  assert.deepEqual(payoffOrders(u1, '0.3').avalanche, [1, 0]);
  // ₹60L home loan at 9% (₹5.4L interest, over the ₹2L cap): its full rate at the margin.
  const u2 = { country: 'IN', tax_regime: 'old', loans: [{ ...base, loan_type: 'home_loan', outstanding: '6000000', nominal_rate: '0.09' }, { ...base, nominal_rate: '0.085' }] };
  assert.ok(userMarginalCosts(u2, '0.3').get(0).taxBenefit.isZero());
  assert.deepEqual(payoffOrders(u2, '0.3').avalanche, [0, 1]);
  // Locked for 6 months: after a 9% loan even at 40%.
  const u3 = { country: 'IN', tax_regime: 'new', loans: [{ ...base, nominal_rate: '0.40', prepay_lock_in_months: 6 }, { ...base, nominal_rate: '0.09' }] };
  assert.deepEqual(payoffOrders(u3, '0').avalanche, [1, 0]);
  // US mortgage: the shield follows usMortgageShieldShare (itemisers only).
  const us = { country: 'US', filing_status: 'single', loans: [{ ...base, loan_type: 'home_loan', outstanding: '400000', nominal_rate: '0.07' }] };
  assert.ok(userMarginalCosts(us, '0.24').get(0).taxBenefit.gt(0));
});

test('"why this loan first": the breakdown on Home, same words as the engine', () => {
  const { marginalCost, whyFirst, whyFirstLines } = lib('marginal-cost.ts');
  const s = whyFirst(marginalCost('0.09', false, '0.3', '0.02', 24, 2));
  assert.match(s, /^The next payment here saves \d+\.\d\d% a year: \d+\.\d\d% interest \(compounded monthly\) − \d+\.\d\d% tax break you'd give up − 1\.00% prepayment fee; locked against prepayment for 2 more months$/);
  const lines = whyFirstLines(marginalCost('0.36', true, '0', '0', 0));
  assert.deepEqual(lines.map((l) => l.sign), ['+', '+', '=']);
  assert.match(lines[1].label, /GST/);
  const home = src('components/home/HomeDebtFree.tsx');
  assert.match(home, /userMarginalCosts\(plan\.user, plan\.marginalRate\)/);
  assert.match(home, /whyFirst\(mc\)/);
  const py = fs.readFileSync(path.resolve(__dirname, '../../engine/marginal_cost.py'), 'utf8');
  for (const w of ['The next payment here saves', 'interest (compounded monthly)', 'GST on it', "tax break you'd give up", 'prepayment fee', 'locked against prepayment for']) {
    assert.ok(py.includes(w) && src('lib/marginal-cost.ts').includes(w), w);
  }
});

// Merge of #31 (GST in one place) with #37: the marginal-cost order must read
// India's GST from lib/gst.ts (engine/tax/gst.py's export), not type 18% itself.
test('Marginal cost: GST on card interest comes from the one GST source', () => {
  const { GST_RATE_IN } = lib('gst.ts');
  const { GST_ON_CARD_INTEREST_IN } = lib('marginal-cost.ts');
  assert.equal(GST_ON_CARD_INTEREST_IN.toString(), GST_RATE_IN.toString());
  const libDir = path.join(root, 'lib');
  const typed = fs.readdirSync(libDir)
    .filter((f) => /\.tsx?$/.test(f) && f !== 'gst.ts')
    .filter((f) => /(?:D|Decimal)\(\s*['"]?0\.18['"]?\s*\)/.test(fs.readFileSync(path.join(libDir, f), 'utf8')));
  assert.deepEqual(typed, [], `GST typed outside lib/gst.ts: ${typed}`);
});
