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

test('differential: the TypeScript rules order matches the engine on every fixture case', () => {
  const { applyRules } = lib('payoff-rules.ts');
  const cases = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../engine/tests/fixtures/payoff_rules_cases.json'), 'utf8'));
  assert.ok(cases.length >= 60);
  for (const c of cases) {
    const idx = c.rates.map((_, i) => i);
    assert.deepEqual(applyRules(idx, c.rules, (i) => c.rates[i], (i) => c.balances[i]), c.order, JSON.stringify(c));
  }
});

test('Hybrid is migrated to "rules" with Hybrid\'s rule (cookie, synced slice, engine)', () => {
  const { normalizeStrategy, STRATEGIES, STRATEGY_LABEL } = lib('strategy.ts');
  // UX50 B-08: one order everywhere (cheapest, smallest, yours); was avalanche, rules, snowball.
  assert.deepEqual(STRATEGIES, ['avalanche', 'snowball', 'rules']);
  assert.equal(normalizeStrategy('hybrid'), 'rules');
  assert.equal(normalizeStrategy('snowball'), 'snowball');
  assert.equal(normalizeStrategy('junk'), 'avalanche');
  assert.equal(STRATEGY_LABEL.rules, 'Your rules');
  const { hybridRules, rulesOrDefault, parseRules } = lib('payoff-rules.ts');
  assert.deepEqual(rulesOrDefault(null, 'IN'), { small_first_below: '50000', pinned: [], custom_order: [] });
  assert.deepEqual(hybridRules('US').small_first_below, '1000');
  assert.deepEqual(parseRules('{"pinned":[1,1,99,-1],"small_first_below":"-3"}'), { small_first_below: null, pinned: [1], custom_order: [] });
  // The client rewrites a hybrid cookie; hydration rewrites a hybrid slice; the slice for the rules syncs.
  assert.match(src('lib/strategy.ts'), /if \(v === 'hybrid'\) writeStrategyClient\('rules'\)/);
  const sync = src('lib/server-sync.ts');
  assert.match(sync, /payoff_rules:\s+\{ kind: 'cookie',\s+name: 'rightdue_payoff_rules' \}/);
  assert.match(sync, /slice === 'strategy' && value === 'hybrid'/);
  // No 'hybrid' strategy left in the web (currency "hybrid" users aside).
  for (const f of ['lib/payoff-order.ts', 'components/StrategySwitcher.tsx', 'components/personas/Persona.tsx', 'components/home/HomeDebtFree.tsx', 'components/plan/load-plan.ts', 'lib/api.ts']) {
    assert.doesNotMatch(src(f), /'hybrid'|hybrid:|\.hybrid\b/, f);
  }
});

test('the rules ride on the user to the engine (plan, windfall, masthead order)', () => {
  assert.match(src('components/plan/load-plan.ts'), /payoff_rules: rulesForLoans\(rulesOrDefault\(await loadRulesServer\(\)/);
  assert.match(src('app/tools/windfall/tool.tsx'), /payoff_rules: rulesForLoans\(rulesOrDefault\(readRulesClient\(\)/);
  assert.match(src('app/layout.tsx'), /payoff_rules: rulesOrDefault\(rules, profile\.user\.country\)/);
  const { payoffOrders } = lib('payoff-order.ts');
  const user = {
    country: 'IN', tax_regime: 'new',
    loans: [
      { loan_type: 'home_loan', bank: 'HDFC', outstanding: '4000000', nominal_rate: '0.085', rate_type: 'floating', tenure_months_remaining: 240, scheduled_emi: '34713' },
      { loan_type: 'credit_card', bank: 'ICICI', outstanding: '80000', nominal_rate: '0.36', rate_type: 'fixed', tenure_months_remaining: 0, scheduled_emi: '0' },
    ],
    payoff_rules: { small_first_below: null, pinned: [0], custom_order: [] },
  };
  const o = payoffOrders(user, '0.3');
  assert.deepEqual(o.avalanche, [1, 0]);
  assert.deepEqual(o.rules, [0, 1]);
});

test('rules editor shows under the switcher with the cost against Avalanche', () => {
  const { rulesCost, rulesCostWords } = require(path.join(root, 'components/plan/PayoffRulesEditor.tsx'));
  const money = (n) => `₹${n.toLocaleString('en-IN')}`;
  const cost = rulesCost({ debtFreeMonth: 40, totalInterest: '512000' }, { debtFreeMonth: 37, totalInterest: '500000' });
  assert.deepEqual(cost, { extraInterest: 12000, extraMonths: 3 });
  assert.match(rulesCostWords(cost, money, 37, 'IN'), /^Against Avalanche: ₹12,000 more interest, debt-free 3 months later than /);
  assert.equal(rulesCostWords(rulesCost({ debtFreeMonth: 37, totalInterest: '500000' }, { debtFreeMonth: 37, totalInterest: '500000' }), money, 37, 'IN'), 'Against Avalanche: no extra interest, the same debt-free month.');
  const { StrategySwitcher } = require(path.join(root, 'components/StrategySwitcher.tsx'));
  const user = { country: 'IN', loans: [{ loan_type: 'home_loan', bank: 'HDFC Bank', outstanding: '4000000' }, { loan_type: 'credit_card', bank: 'ICICI Bank', outstanding: '80000' }] };
  const compare = { avalanche: { debtFreeMonth: 37, totalInterest: '500000' }, rules: { debtFreeMonth: 40, totalInterest: '512000' }, snowball: { debtFreeMonth: 41, totalInterest: '520000' } };
  const html = renderToStaticMarkup(React.createElement(StrategySwitcher, { active: 'rules', variant: 'ledger', compare, country: 'IN', user, money }));
  assert.match(html, /\[YOUR RULES · YOUR OWN ORDER\]/);
  assert.match(html, /Your payoff rules/);
  assert.match(html, /Clear any loan under/);
  assert.match(html, /PIN FIRST/);
  assert.match(html, /Against Avalanche: ₹12,000 more interest/);
  const aval = renderToStaticMarkup(React.createElement(StrategySwitcher, { active: 'avalanche', variant: 'ledger', compare, country: 'IN', user, money }));
  assert.doesNotMatch(aval, /Your payoff rules/);
});
