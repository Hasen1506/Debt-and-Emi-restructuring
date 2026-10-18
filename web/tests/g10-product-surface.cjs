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
const Decimal = require('decimal.js');

// Sprint G10 (product surface): landing, glossary, setup choices, estimates.

const WELCOME = fs.readFileSync(path.resolve(__dirname, '../public/welcome.html'), 'utf8');
const EX = require(path.join(root, 'lib/landing-example.json'));

function inr(v) {
  return '₹' + Math.round(Number(v)).toLocaleString('en-IN');
}
function usd(v) {
  return '$' + Math.round(Number(v)).toLocaleString('en-US');
}
const block = (key, c) => {
  const m = WELCOME.match(new RegExp(`<!-- gen:${key}-${c} -->([\\s\\S]*?)<!-- /gen:${key}-${c} -->`));
  assert.ok(m, `welcome.html is missing the ${key}-${c} block`);
  return m[1];
};

test('glossary: every explanation is 30 words or fewer, and not just the term again', () => {
  const { GLOSSARY, wordCount, glossaryFor } = lib('glossary.ts');
  const entries = Object.entries(GLOSSARY);
  assert.ok(entries.length >= 30, `only ${entries.length} entries`);
  for (const [k, e] of entries) {
    assert.ok(wordCount(e.plain) <= 30, `${k}: ${wordCount(e.plain)} words`);
    assert.ok(wordCount(e.plain) >= 6, `${k}: too short to explain anything`);
    assert.notEqual(e.plain.trim().toLowerCase(), e.term.trim().toLowerCase(), k);
  }
  for (const k of ['avalanche', 'snowball', 'rules', 'emi', 'apr']) assert.ok(GLOSSARY[k], `missing ${k}`);
  // Country-only entries stay in their country.
  for (const c of ['IN', 'US']) for (const [, e] of glossaryFor(c)) assert.ok(!e.country || e.country === c);
});

test('welcome.html carries the figures in landing-example.json, for both countries', () => {
  for (const c of ['IN', 'US']) {
    const x = EX[c];
    const money = c === 'IN' ? inr : usd;
    const kpis = block('kpis', c);
    assert.ok(kpis.includes(money(x.outstanding)), `${c} outstanding`);
    assert.ok(kpis.includes(x.plan.debt_free), `${c} debt-free month`);
    assert.ok(kpis.includes(money(x.vs_smallest_first.interest_saved)), `${c} interest saved`);
    assert.ok(kpis.includes(`${money(x.budget)}/MO`), `${c} budget`);
    assert.match(kpis, /VS SMALLEST FIRST/);
    const reg = block('register', c);
    for (const r of x.plan.first_month) assert.ok(reg.includes(money(r.payment)), `${c} ${r.loan} payment`);
    const total = x.plan.first_month.reduce((s, r) => s + Number(r.payment), 0);
    assert.equal(total, Number(x.budget), `${c}: month 1 pays the budget`);
    assert.ok(reg.includes(money(total)));
    const chart = block('chart', c);
    // UX50 A-02: the chart is the plan only (the dashed minimums line went:
    // a second baseline beside the KPI strip's). Its title, the phone list
    // and the debt-free month all come from the JSON.
    assert.ok(chart.includes(`Debt-free in <b>${x.plan.debt_free}</b>`), `${c} chart title`);
    assert.ok(chart.includes(`<b>${x.plan.debt_free}</b></li>`), `${c} debt-free list row`);
    assert.doesNotMatch(chart, /ONLY WHAT/);
    const note = block('due-note', c);
    if (x.vs_only_whats_due.debt_free) assert.ok(note.includes(x.vs_only_whats_due.debt_free));
    else assert.match(note, /more than 40 years/);
  }
  // Each country's content is marked so the toggle can hide the other.
  assert.match(WELCOME, /data-set-country="IN"/);
  assert.match(WELCOME, /data-set-country="US"/);
  assert.match(WELCOME, /rd_country=\(IN\|US\)/);
});

test('honest copy: no straw-man baseline, no "restructuring", six tools', () => {
  const text = WELCOME.replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(text, /26 YRS/i);
  assert.doesNotMatch(text, /saved vs paying only minimums/i);
  assert.doesNotMatch(text, /restructur/i);
  assert.doesNotMatch(text, /reviewed by|approved by (a |an )?(professional|expert|CA|advisor)/i);
  assert.doesNotMatch(text, /\b(nine|9) tools\b/i);
  assert.match(text, /SIX TABS/);
  // Audit 80 B11: the heading carries no count (the US view shows five cards).
  assert.match(text, /TOOLS · ONE QUESTION EACH/);
  assert.doesNotMatch(text, /TOOLS · SIX/);
  // The "only what's due" figure is a labelled ceiling, never the headline.
  assert.match(text, /that is the most a plan can save, not what it saves most people/);
  const { TOOLS } = lib('tools.ts');
  assert.equal(TOOLS.length, 6);
  const layout = fs.readFileSync(path.join(root, 'app/layout.tsx'), 'utf8');
  assert.doesNotMatch(layout, /restructur/i);
  // Sell to repay is a calculator, never a ranking or a verdict.
  const { ADVICE_WORDS } = lib('sale-calculator.ts');
  const tool = fs.readFileSync(path.join(root, 'app/tools/liquidate/tool.tsx'), 'utf8');
  assert.ok(!fs.existsSync(path.join(root, 'app/tools/liquidate/PortfolioRanker.tsx')));
  for (const rx of ADVICE_WORDS) assert.doesNotMatch(tool.replace(/ADVICE_WORDS[^\n]*/g, ''), rx);
});

test('senseCountry: CDN header first, then Accept-Language, else India', () => {
  const { senseCountry } = lib('landing-country.ts');
  const h = (o) => ({ get: (k) => (k in o ? o[k] : null) });
  assert.equal(senseCountry(h({})), 'IN');
  assert.equal(senseCountry(h({ 'cf-ipcountry': 'US' })), 'US');
  assert.equal(senseCountry(h({ 'cf-ipcountry': 'in' })), 'IN');
  assert.equal(senseCountry(h({ 'cf-ipcountry': 'GB', 'accept-language': 'en-US' })), 'IN');
  assert.equal(senseCountry(h({ 'x-vercel-ip-country': 'US' })), 'US');
  // Cloudflare's "unknown" and Tor codes fall through to the language.
  assert.equal(senseCountry(h({ 'cf-ipcountry': 'XX', 'accept-language': 'en-US,en;q=0.9' })), 'US');
  assert.equal(senseCountry(h({ 'cf-ipcountry': 'T1', 'accept-language': 'en-US' })), 'US');
  assert.equal(senseCountry(h({ 'accept-language': 'en-US,en;q=0.9' })), 'US');
  assert.equal(senseCountry(h({ 'accept-language': 'hi-IN,en;q=0.8' })), 'IN');
  assert.equal(senseCountry(h({ 'accept-language': 'en,en-US;q=0.5' })), 'US');
  assert.equal(senseCountry(h({ 'accept-language': 'en-GB' })), 'IN');
  assert.equal(senseCountry(h({ 'accept-language': 'en' })), 'IN');
});

test('setup choices: nothing is assumed, and the profile records what was picked', () => {
  const { missingChoices, applyChoices, choicesFrom, EF_MONTH_CHOICES } = lib('setup-choices.ts');
  const none = { efMonths: null, efSplit: null, strategy: null };
  assert.deepEqual(missingChoices(none), ['ef_months', 'strategy']);
  assert.deepEqual(missingChoices({ ...none, efMonths: 6 }), ['ef_split', 'strategy']);
  assert.deepEqual(missingChoices({ ...none, efMonths: 0 }), ['strategy']);
  assert.deepEqual(missingChoices({ efMonths: 3, efSplit: '0.30', strategy: 'snowball' }), []);
  assert.deepEqual(missingChoices(none, false), ['ef_months']);
  assert.ok(!EF_MONTH_CHOICES.includes(undefined));

  const user = { country: 'IN', loans: [], efund_target: '0', assumptions: {} };
  // Nothing picked: the profile is untouched (no silent default).
  assert.equal(applyChoices(user, none, 50000, '2026-10-12'), user);
  const six = applyChoices(user, { efMonths: 6, efSplit: '0.50', strategy: 'avalanche' }, 50000, '2026-10-12');
  assert.equal(six.efund_target, '300000');
  assert.equal(six.assumptions.ef_months, 6);
  assert.deepEqual(six.assumptions.confirmed, ['ef_months', 'ef_split', 'strategy']);
  assert.equal(six.assumptions.confirmed_at, '2026-10-12');
  const notNow = applyChoices(user, { efMonths: 0, efSplit: null, strategy: 'snowball' }, 50000, '2026-10-12');
  assert.equal(notNow.efund_target, '0');
  assert.equal(notNow.assumptions.ef_months, null);
  assert.deepEqual(notNow.assumptions.confirmed, ['ef_months', 'ef_split', 'strategy']);
  // Round trip: a saved profile reads back as the same choices.
  assert.deepEqual(choicesFrom(six, '0.50', 'avalanche'), { efMonths: 6, efSplit: '0.50', strategy: 'avalanche' });
  assert.deepEqual(choicesFrom(user, '0.30', 'avalanche'), none);
});

test('estimateBalance: the reducing-balance schedule, labelled as an estimate', () => {
  const { estimateBalance, monthsSince, withEstimate } = lib('setup-estimates.ts');
  assert.equal(estimateBalance(1000000, 0.09, 120, 0), '1000000');
  assert.equal(estimateBalance(1000000, 0.09, 120, 120), '0');
  assert.equal(estimateBalance(120000, 0, 12, 6), '60000');
  assert.equal(estimateBalance(0, 0.09, 120, 10), null);
  // Cross-check against an EMI schedule stepped month by month.
  const P = new Decimal(1000000), r = new Decimal(0.09).div(12), n = 120;
  const g = r.add(1);
  const emi = P.mul(r).mul(g.pow(n)).div(g.pow(n).sub(1));
  let b = P;
  for (let k = 0; k < 36; k++) b = b.mul(g).sub(emi);
  assert.ok(Math.abs(Number(estimateBalance(1000000, 0.09, 120, 36)) - b.toNumber()) <= 1);
  assert.equal(monthsSince('2024-01', '2026-10'), 33);
  assert.equal(monthsSince('2027-01', '2026-10'), null);
  const l = withEstimate({ bank: 'x' }, 'outstanding', true);
  assert.deepEqual(l.estimated_fields, ['outstanding']);
  assert.equal(withEstimate(l, 'outstanding', false).estimated_fields, undefined);
});

test('US landing: month 1 extra goes where loanMarginalCost is highest', () => {
  const { loanMarginalCost } = lib('marginal-cost.ts');
  // The loans in scripts/landing_example.py (_usa), at the 22% bracket.
  const loans = [
    { name: 'Credit card', loan_type: 'credit_card', outstanding: '12000', nominal_rate: '0.24', tenure_months_remaining: 0 },
    { name: 'Personal loan', loan_type: 'personal_loan', outstanding: '5000', nominal_rate: '0.11', tenure_months_remaining: 22 },
    { name: 'Auto loan', loan_type: 'auto_loan', outstanding: '22000', nominal_rate: '0.075', tenure_months_remaining: 52 },
    { name: 'Mortgage', loan_type: 'home_loan', outstanding: '240000', nominal_rate: '0.065', tenure_months_remaining: 301 },
  ];
  const us = EX.US;
  assert.equal(String(loans.reduce((s, l) => s + Number(l.outstanding), 0)), us.outstanding);
  const cost = loans.map((l) => [l.name, loanMarginalCost(l, 'US', '0.22', 'new', false).total]);
  cost.sort((a, b) => b[1].cmp(a[1]));
  const due = Object.fromEntries(us.plan.first_month_due.map((r) => [r.loan, Number(r.payment)]));
  const extra = us.plan.first_month.map((r) => [r.loan, Number(r.payment) - due[r.loan]]).filter(([, v]) => v > 0);
  assert.deepEqual(extra.map(([k]) => k), [cost[0][0]]);
  assert.equal(cost[0][0], 'Credit card');
  // Dearest first, then by rate: the order the payoffs land in.
  assert.deepEqual(cost.map(([k]) => k), ['Credit card', 'Personal loan', 'Auto loan', 'Mortgage']);
  const order = [...us.plan.payoffs].sort((a, b) => a.month - b.month).map((p) => p.loan);
  assert.equal(order[order.length - 1], 'Mortgage');
  assert.equal(us.plan.payoffs.find((p) => p.loan === 'Mortgage').label, us.plan.debt_free);
});
