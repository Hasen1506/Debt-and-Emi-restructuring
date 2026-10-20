/**
 * Each setting on Home, Plan, Cash flow and Profile has one editable
 * control. The other pages show the saved figure and link to it.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../src');
const DIRS = [
  'components/home',
  'components/plan',
  'components/ledger',
  'components/chrome',
  'components/personas',
  'components/profile',
  'app/profile',
];
const FILES = [
  'components/StrategySwitcher.tsx',
  'components/EfSplitSlider.tsx',
  'components/HikeToggle.tsx',
  'components/InflationToggle.tsx',
  'components/TaxReinvestToggle.tsx',
  'components/FxDriftToggle.tsx',
];

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(p);
  }
}

const surface = [];
for (const d of DIRS) walk(path.join(root, d), surface);
for (const f of FILES) surface.push(path.join(root, f));

function rel(p) {
  return path.relative(root, p).split(path.sep).join('/');
}
function text(p) {
  return fs.readFileSync(p, 'utf8');
}
function matching(re) {
  return surface.filter((p) => re.test(text(p))).map(rel).sort();
}

test('each setting on Home, Plan, Cash flow and Profile has one editable control', () => {
  const one = (name, re, expected) => {
    const found = matching(re);
    assert.deepEqual(found, [...expected].sort(), name);
  };

  // The monthly total for debts. Home shows the figure; Plan's chip edits it.
  one('debt budget writer', /writeDebtBudgetClient\(/, ['components/plan/DebtBudgetControl.tsx']);
  one('debt budget control', /<DebtBudgetControl[\s/>]/, ['components/plan/PlanAssumptions.tsx']);
  one('debt budget summary', /<DebtBudgetSummary[\s/>]/, ['components/home/HomeDebtFree.tsx']);
  assert.deepEqual(matching(/DebtBudgetPrompt/), [], 'the old prompt is not mounted');
  assert.match(text(path.join(root, 'components/plan/DebtBudgetControl.tsx')), /href="\/plan\?set=budget#plan-assumption"/);

  // Payoff order. The masthead and Profile show it; Plan's switcher edits it.
  one('payoff order writer', /writeStrategyClient\(/, ['components/StrategySwitcher.tsx']);
  one('payoff order control', /<StrategySwitcher[\s/>]/, ['components/plan/PlanAssumptions.tsx']);
  one('payoff order radios', /aria-label="Payoff order"/, ['components/StrategySwitcher.tsx']);
  assert.doesNotMatch(text(path.join(root, 'components/chrome/PayoffOrderSwitch.tsx')), /writeStrategyClient|role="radio"/);
  assert.match(text(path.join(root, 'components/chrome/PayoffOrderSwitch.tsx')), /href="\/plan\?set=order#plan-assumption"/);
  assert.doesNotMatch(text(path.join(root, 'components/personas/StrategyTriptych.tsx')), /writeStrategyClient|onClick/);

  // How much spare cash fills the emergency fund: the Plan chip, not Assumptions.
  one('emergency-fund share writer', /writeEfSplitClient\(/, ['components/EfSplitSlider.tsx']);
  one('emergency-fund top-up control', /<EfSplitSlider[\s/>]/, ['components/plan/PlanAssumptions.tsx']);
  one('fixed monthly top-up writer', /ef_save_amount\s*=/, ['components/EfSplitSlider.tsx']);
  const assumptions = text(path.join(root, 'app/profile/assumptions/AssumptionsClient.tsx'));
  assert.doesNotMatch(assumptions, /efund_target\s*:/);
  assert.doesNotMatch(assumptions, /aria-label="Months of cover"|aria-label="Fixed monthly top-up"/);
  assert.match(assumptions, /\/profile\?step=savings&focus=efund/);
  assert.match(assumptions, /\/plan\?set=ef#plan-assumption/);
  one('emergency fund target field', /Emergency fund — target/, ['app/profile/ProfileClient.tsx']);

  // The rest of Plan's assumption chips are edited only there.
  for (const [name, tag] of [
    ['pay rises', 'HikeToggle'],
    ['rising costs', 'InflationToggle'],
    ['inflation rate', 'InflationRateControl'],
    ['borrowing limit', 'GapLimitControl'],
    ['return after tax', 'AssumedReturnControl'],
    ['rate rise', 'RateRiseControl'],
    ['seasonal income', 'SeasonalIncomeControl'],
    ['tax refunds', 'TaxReinvestToggle'],
    ['rupee drift', 'FxDriftToggle'],
  ]) {
    one(name, new RegExp(`<${tag}[\\s/>]`), ['components/plan/PlanAssumptions.tsx']);
  }

  // Cash flow states the month. It does not ask a question.
  const home = text(path.join(root, 'components/home/LedgerHome.tsx'));
  const cash = home.slice(home.indexOf('export function CashFlow'), home.indexOf('function LedgerHomeSoft'));
  assert.ok(cash.length > 100, 'cash flow source');
  assert.doesNotMatch(cash, /<(input|select|textarea)\b|write[A-Z]/);
});
