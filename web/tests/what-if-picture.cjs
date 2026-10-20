// Plan what-if picture. 20 Oct 2026: two full-width bars for a ₹108 gap.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const test = require('node:test');

const root = path.resolve(__dirname, '../src');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...rest);
};
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'next/navigation') return { useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => '/plan', useSearchParams: () => new URLSearchParams() };
  if (request === 'server-only') return {};
  return load.call(this, request, ...rest);
};
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (m, f) =>
    m._compile(
      ts.transpileModule(fs.readFileSync(f, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      }).outputText,
      f,
    );
}

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { WhatIfPicture } = require(path.join(root, 'components/plan/WhatIfPicture.tsx'));
const { formatCurrency } = require(path.join(root, 'lib/api.ts'));
const pic = require(path.join(root, 'lib/what-if-picture.ts'));
const today = require(path.join(root, 'lib/today.ts'));

const money = (n) => formatCurrency(n, 'INR');
const textOf = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

function result(planMonth, nextMonth, planInterest, nextInterest) {
  return {
    baseline_debt_free_month: planMonth,
    scenario_debt_free_month: nextMonth,
    baseline_total_interest: String(planInterest),
    scenario_total_interest: String(nextInterest),
  };
}

test('spend less on the screenshot: the ₹108 gap is a sentence, not two full bars', () => {
  // Unreduced statement: ₹8,814.98 vs ₹8,706.96, both month 3. Whole rupees
  // ₹8,815 and ₹8,707. The headline is ₹108 less (108.02), the same month.
  const model = pic.buildWhatIfPicture({ planMonth: 3, nextMonth: 3, planInterest: 8814.98, nextInterest: 8706.96 });
  assert.equal(model.date.mode, 'same');
  assert.equal(model.interest.mode, 'close');
  assert.equal(model.monthsSooner, 0);
  assert.equal(pic.whatIfSentence(0, 108.02, money), '₹108 less interest, same debt-free month.');

  const html = renderToStaticMarkup(React.createElement(WhatIfPicture, {
    result: result(3, 3, 8814.98, 8706.96), country: 'IN', formatInterest: money,
  }));
  const text = textOf(html);
  assert.match(text, /₹108 less interest, same debt-free month/);
  assert.match(text, /₹8,815 on your plan, ₹8,707 with this/);
  const when = today.monthIndexToCountryLabel(3, 'IN');
  assert.match(text, new RegExp(`Debt-free ${when}, on your plan and with this`));
  assert.doesNotMatch(html, /DEBT-FREE/);
  assert.doesNotMatch(html, /INTEREST/);
});

test('the same cut from today’s balance is ₹24, still the same month', () => {
  const model = pic.buildWhatIfPicture({ planMonth: 2, nextMonth: 2, planInterest: 2375.11, nextInterest: 2351.51 });
  assert.equal(model.interest.mode, 'close');
  assert.equal(pic.whatIfSentence(0, 23.6, money), '₹24 less interest, same debt-free month.');
  const html = renderToStaticMarkup(React.createElement(WhatIfPicture, {
    result: result(2, 2, 2375.11, 2351.51), country: 'IN', formatInterest: money,
  }));
  const text = textOf(html);
  assert.match(text, /₹24 less interest, same debt-free month/);
  assert.match(text, /₹2,375 on your plan, ₹2,352 with this/);
});

test('a change you can see uses one scale from zero', () => {
  const model = pic.buildWhatIfPicture({ planMonth: 24, nextMonth: 12, planInterest: 40000, nextInterest: 20000 });
  assert.equal(model.date.mode, 'axis');
  assert.equal(model.date.planShare, 1);
  assert.equal(model.date.nextShare, 0.5);
  assert.equal(model.interest.mode, 'scale');
  assert.equal(model.interest.planShare, 1);
  assert.equal(model.interest.nextShare, 0.5);
  assert.equal(pic.whatIfSentence(12, 20000, money), '₹20,000 less interest, debt-free 12 months sooner.');
  const html = renderToStaticMarkup(React.createElement(WhatIfPicture, {
    result: result(24, 12, 40000, 20000), country: 'IN', formatInterest: money,
  }));
  assert.match(html, /DEBT-FREE/);
  assert.match(html, /INTEREST/);
  assert.match(html, />NOW</);
  assert.match(html, new RegExp(money(0).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /width:100%/);
  assert.match(html, /width:50%/);
  const text = textOf(html);
  assert.match(text, /₹20,000 less interest, debt-free 12 months sooner/);
});

test('zero change, a later date, and the slider stops', () => {
  assert.equal(pic.whatIfSentence(0, 0, money), 'Same interest, same debt-free month.');
  assert.equal(pic.whatIfSentence(-2, -4000, money), '₹4,000 more interest, debt-free 2 months later.');
  assert.equal(pic.whatIfSentence(null, 500, money), '₹500 less interest.');
  assert.equal(pic.clampWhatIf(1300 + 100, 0, 1349), 1349);
  assert.equal(pic.clampWhatIf(50 - 100, 0, 1349), 0);
  assert.equal(pic.clampWhatIf(1349, 0, 1349), 1349);
  assert.equal(pic.clampWhatIf(0, 0, 1349), 0);
  assert.deepEqual([...pic.SPEND_START_MONTHS], [1, 4, 7, 13]);
  assert.equal(pic.clampWhatIf(pic.RATE_BPS.max + pic.RATE_BPS.step, pic.RATE_BPS.min, pic.RATE_BPS.max), 300);
  assert.equal(pic.clampWhatIf(pic.RATE_BPS.min - pic.RATE_BPS.step, pic.RATE_BPS.min, pic.RATE_BPS.max), -200);
  const src = fs.readFileSync(path.join(root, 'components/WhatIfPanel.tsx'), 'utf8');
  assert.match(src, /clampWhatIf\(value - nudge/);
  assert.match(src, /clampWhatIf\(value \+ nudge/);
  assert.match(src, /WhatIfPicture/);
  assert.match(src, /RATE_BPS/);
  assert.match(src, /SPEND_START_MONTHS/);
  assert.match(src, /Just this month/);
  assert.match(src, /lump_sum_amount: String\(surplusDelta\)/);
});

test('a capped plan and a plan that never clears do not show a paper date', () => {
  const capped = textOf(renderToStaticMarkup(React.createElement(WhatIfPicture, {
    result: { ...result(24, 18, 40000, 20000), scenario_infeasible_from_month: 6 },
    country: 'IN', formatInterest: money,
  })));
  assert.match(capped, /Sep 2028/);
  assert.doesNotMatch(capped, /Mar 2028/);
  assert.match(capped, /no date/);

  const stuck = textOf(renderToStaticMarkup(React.createElement(WhatIfPicture, {
    result: { ...result(30, 12, 900000, 100000), baseline_never_clears: true, scenario_never_clears: true },
    country: 'IN', formatInterest: money,
  })));
  assert.match(stuck, /no interest total to compare/);
  assert.match(stuck, /No debt-free date/);
  assert.doesNotMatch(stuck, /₹/);
});
