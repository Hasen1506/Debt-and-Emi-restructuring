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

test('the defaults shown are the engine\'s (asset returns, selling costs, prepay margin)', () => {
  const a = lib('assumptions.ts');
  const cd = py('engine/country_data.py');
  for (const [country, table] of [['IN', 'ASSET_DEFAULT_RETURNS_IN'], ['US', 'ASSET_DEFAULT_RETURNS_US']]) {
    const block = cd.slice(cd.indexOf(`${table}`), cd.indexOf('}', cd.indexOf(`${table}`)));
    for (const m of block.matchAll(/"(\w+)":\s*D\("([\d.]+)"\)/g)) {
      assert.equal(a.DEFAULT_ASSET_RETURNS[country][m[1]], Number(m[2]), `${country} ${m[1]}`);
    }
  }
  const liq = py('engine/asset_liquidation.py');
  const c = (name) => Number(liq.match(new RegExp(`${name} = D\\("([\\d.]+)"\\)`))[1]);
  assert.equal(a.DEFAULT_LIQUIDATION_COSTS.IN.equity_mf, c('EQUITY_STT_RATE') + c('EQUITY_BROKERAGE'));
  assert.equal(a.DEFAULT_LIQUIDATION_COSTS.IN.gold_physical, c('GOLD_TRANSACTION_COST'));
  assert.equal(a.DEFAULT_LIQUIDATION_COSTS.IN.sgb, c('SGB_EXCHANGE_COST'));
  assert.equal(a.DEFAULT_LIQUIDATION_COSTS.IN.debt_mf, c('DEBT_MF_EXIT_LOAD'));
  assert.equal(a.DEFAULT_PREPAY_HURDLE, Number(py('engine/formulas.py').match(/PREPAY_RISK_PREMIUM = D\("([\d.]+)"\)/)[1]));
});

test('each value takes the user\'s own figure, else the default', () => {
  const a = lib('assumptions.ts');
  const u = { country: 'IN' };
  assert.equal(a.prepayHurdle(u), 0.005);
  assert.equal(a.prepayHurdle({ ...u, prepay_hurdle: '0.02' }), 0.02);
  assert.equal(a.assetReturn(u, 'equity_mf'), 0.11);
  assert.equal(a.assetReturn({ ...u, asset_returns: { equity_mf: '0.08' } }, 'equity_mf'), 0.08);
  assert.equal(a.liquidationCost({ ...u, liquidation_costs: { gold_physical: '0.05' } }, 'gold_physical'), 0.05);
  assert.equal(a.efMonths(u), 6);
  assert.equal(a.efMonths({ ...u, assumptions: { ef_months: 4 } }), 4);
  assert.equal(a.efMonths({ ...u, assumptions: { ef_months: 40 } }), 6);
  assert.equal(a.goalBuffer(u, '0.05'), '0.05');
  assert.equal(a.goalBuffer({ ...u, assumptions: { goal_buffer_pct: '0.1' } }, '0.05'), '0.1');
  // A fixed monthly top-up becomes its share of spare cash, capped at all of it.
  assert.equal(a.efTopUpShare(u, '0.30', 50000), '0.30');
  assert.equal(a.efTopUpShare({ ...u, assumptions: { ef_save_amount: '10000' } }, '0.30', 50000), '0.2000');
  assert.equal(a.efTopUpShare({ ...u, assumptions: { ef_save_amount: '90000' } }, '0.30', 50000), '1.0000');
  assert.deepEqual(a.parseRateInput('', 0, 0.2), { ok: true, value: null });
  assert.deepEqual(a.parseRateInput('1.5', 0, 0.2), { ok: true, value: '0.015' });
  assert.equal(a.parseRateInput('30', 0, 0.2).ok, false);
  const { defaultAssetCagr, projectAssetValue } = lib('asset-returns.ts');
  // Regression: the web's own table had an Indian FD at 7% (engine 6.25%).
  assert.equal(defaultAssetCagr('fixed_deposit', 'IN'), 0.0625);
  assert.equal(defaultAssetCagr('equity_mf', 'IN', { equity_mf: '0.08' }), 0.08);
  const asset = { asset_type: 'equity_mf', current_market_value: '100000' };
  assert.ok(projectAssetValue(asset, 'IN', 12, { equity_mf: '0' }) === 100000);
  assert.ok(projectAssetValue(asset, 'IN', 12) > 111000);
});

test('wired: Plan\'s top-up, a new goal\'s buffer, the EF tier, goal projections, and an Assumptions page off Profile', () => {
  // Before PR D: EF tiers were fixed at 3/6/9 months, the top-up was only a %,
  // the buffer came from the preset, and returns/costs/margin were constants.
  assert.match(src('components/plan/load-plan.ts'), /efTopUpShare\(adjustedUser, efSplit, surplus\)/);
  assert.match(src('components/goals/GoalForm.tsx'), /bufferPct: goalBuffer\(loadProfileClient\(\)\.user, p\.bufferPct\)/);
  const profile = src('app/profile/ProfileClient.tsx');
  assert.match(profile, /ownMonths=\{ownEfMonths\}/);
  assert.match(profile, /id: 'own' as const, label: 'Yours', months: ownMonths/);
  assert.match(profile, /href="\/profile\/assumptions"/);
  assert.match(src('lib/goal-line.ts'), /monthsUntil\(g, today\), user\.asset_returns\)/);
  const page = src('app/profile/assumptions/AssumptionsClient.tsx');
  for (const s of ['Months of cover', 'Fixed monthly top-up', 'Prepay margin', 'Buffer on a new goal', 'EXPECTED RETURNS', 'SELLING COSTS', 'default ']) assert.ok(page.includes(s), s);
  assert.match(page, /efund_target: String\(Math\.round\(months \* spend\)\)/);
});
