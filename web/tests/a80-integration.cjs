// Audit 80+ integration (phase 1): glue between workstreams.
// - W1b/C11: a plan the gap credit limit can't carry (engine
//   infeasible_from_month) never shows a debt-free date in the Plan/Home/Setup
//   headline words; it leads with the monthly gap.
// - W3 A1 x W4: Loan Check results are remembered on the device for the
//   "where we disagree" card.
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
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    module._compile(output, file);
  };
const gap = require(path.join(root, 'lib', 'plan-gap.ts'));
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const label = (m) => `${MONTHS[(9 + m) % 12]} ${2026 + Math.floor((9 + m) / 12)}`;
const money = (v) => `₹${Math.round(v).toLocaleString('en-IN')}`;

// Class guard: over every combination of (this month short / a later month
// short) x (as-is date present / absent) x (closed date present / absent),
// a capped plan's words never contain the as-is debt-free date and always
// name the month it stops being fundable.
test('C11: capped plans never headline a debt-free date', () => {
  const asIs = 100; // label(100) is a month that must never appear
  for (const shortfall of [0, 5500])
    for (const asIsMonth of [asIs, null])
      for (const closedMonth of [null, undefined])
        for (const infeasibleFrom of [3, 30]) {
          const laterGap = shortfall > 0 ? undefined : { month: 7, amount: 4200 };
          const args = { shortfall, asIsMonth, closedMonth, label, money, infeasibleFrom, laterGap };
          const h = gap.shortHeadline(args);
          const all = `${h.value} ${h.sub}`;
          assert.ok(!all.includes(label(asIs)), all);
          assert.match(h.value, /\/MO SHORT$/, all);
          assert.ok(all.includes(`NOT FUNDABLE AS IT STANDS FROM ${label(infeasibleFrom)}`), all);
          const line = gap.shortGapLine(args);
          if (shortfall > 0) {
            assert.ok(!line.includes(label(asIs)), line);
            assert.ok(line.includes(`not fundable as it stands from ${label(infeasibleFrom)}`), line);
          } else assert.equal(line, null);
        }
});

test('C11: fundable plans keep their words (no regression)', () => {
  const h = gap.shortHeadline({ shortfall: 0, asIsMonth: 40, closedMonth: null, label, money, laterGap: { month: 7, amount: 4200 } });
  assert.equal(h.value, label(40));
  assert.equal(h.sub, 'A LATER MONTH IS SHORT · GAP BORROWED');
  const line = gap.shortGapLine({ shortfall: 5500, asIsMonth: 40, closedMonth: 30, label, money });
  assert.equal(line, `if the ₹5,500/mo gap closes: ${label(30)} · as things stand: ${label(40)}`);
});

test('C11: Plan, Home and Setup pass infeasible_from_month to the gap words', () => {
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  assert.match(read('components/plan/load-plan.ts'), /infeasibleFrom: scenario\.infeasible_from_month/);
  assert.match(read('components/plan/LedgerPlan.tsx'), /infeasibleFrom: plan\.infeasibleFrom/);
  assert.match(read('components/home/HomeDebtFree.tsx'), /infeasibleFrom: plan\.infeasibleFrom/);
  assert.match(read('components/setup/QuickSetup.tsx'), /infeasibleFrom: plan\.infeasible_from_month/);
  assert.match(read('lib/api.ts'), /infeasible_from_month\?: number \| null/);
});

test('A1 x W4: Loan Check remembers its findings for the disagree card', () => {
  const src = fs.readFileSync(path.join(root, 'app/tools/loan-check/tool.tsx'), 'utf8');
  assert.match(src, /import \{ rememberLoanCheck \} from '@\/lib\/loan-check-memory'/);
  assert.match(src, /setResult\(res\);\s*(\/\/[^\n]*\n\s*)*rememberLoanCheck\(res\);/);
});
