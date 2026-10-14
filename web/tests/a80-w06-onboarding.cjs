// Audit 80 W6 (onboarding, landing, copy): guards for the CLASS of each
// defect, not just the one repro. Pure, no network, no clock.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript'), test = require('node:test');
const web = path.resolve(__dirname, '..'), root = path.join(web, 'src'), resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) { return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...rest); };
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, f);
const lib = (p) => require(path.join(root, 'lib', p));
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const WELCOME = fs.readFileSync(path.join(web, 'public/welcome.html'), 'utf8');
function walk(dir, out = []) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else if (/\.(tsx?)$/.test(e.name)) out.push(p); } return out; }
const ALL = walk(root).map((f) => [path.relative(root, f), fs.readFileSync(f, 'utf8')]);
// Deterministic PRNG for the property tests.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

test('B1: every way into Setup frames sign-in as "Start your free plan"; plain sign-in stays "Sign in"', () => {
  const { loginFrame, LOGIN_COPY, START_STEPS } = lib('login-frame.ts');
  for (const next of ['/onboarding', '/onboarding?step=loans', '/onboarding/x', '/onboarding#a']) assert.equal(loginFrame(next, null), 'start', next);
  for (const next of [null, '', '/', '/plan', '/onboardingx', '/cant-pay', 'https://evil.example/onboarding']) assert.equal(loginFrame(next, null), 'signin', String(next));
  assert.equal(loginFrame('/plan', '1'), 'start');
  assert.match(LOGIN_COPY.start.title, /^Start your free plan$/);
  assert.match(LOGIN_COPY.start.sub, /Step 1 of 4/);
  assert.match(LOGIN_COPY.signin.sub, /creates your free account/);
  assert.deepEqual([...START_STEPS], ['Email', 'Your money', 'Your loans', 'Your plan']);
  const page = src('app/login/page.tsx');
  assert.match(page, /loginFrame\(next, params\.get\('start'\)\)/);
  assert.doesNotMatch(page, /<h1 style=\{title\}>Sign in<\/h1>/);
  assert.match(page, /href="\/cant-pay"/);
  // Every landing CTA to the plan carries the start frame.
  const ctas = WELCOME.match(/<a class="btn dark" href="[^"]*">\[ START[^<]*<\/a>/g);
  assert.ok(ctas && ctas.length >= 2);
  for (const c of ctas) assert.match(c, /href="\/login\?start=1"/);
});

test('A17/B3: /cant-pay is public, never shows the demo profile, and is linked from landing and login', () => {
  const { isGatedAppPath } = lib('app-routes.ts');
  assert.equal(isGatedAppPath('/cant-pay'), false);
  const mw = src('middleware.ts');
  assert.match(mw, /isCantPay\(pathname\)/);
  const cp = src('components/distress/CantPay.tsx');
  // Signed out (no saved profile) the public page renders, before any loan line is shown.
  assert.match(cp, /if \(!profile\.isLive\) return <CantPayPublic \/>;/);
  assert.ok(cp.indexOf('if (!profile.isLive) return <CantPayPublic />;') < cp.indexOf('data-testid="cp-protect"'));
  const pub = src('components/distress/CantPayPublic.tsx');
  assert.doesNotMatch(pub, /useStoredProfile|useCurrentProfile/);
  assert.match(pub, /\/login\?next=%2Fcant-pay/);
  assert.match(WELCOME, /<a href="\/cant-pay">Start here, no sign-in →<\/a>/);
  const { PUBLIC_LETTER_KINDS, PUBLIC_PROTECT } = require(path.join(root, 'components/distress/CantPayPublic.tsx'));
  for (const c of ['IN', 'US']) { assert.ok(PUBLIC_LETTER_KINDS[c].length >= 4); assert.equal(PUBLIC_PROTECT[c].length, 3); }
  assert.doesNotMatch(PUBLIC_PROTECT.US.join(' '), /RBI|EMI|₹|NACH/);
});

test('A17/B12: letters, every ask combination: India cites RBI + the Ombudsman route; the US letter cites no Indian rule', () => {
  const { hardshipLetter, agentComplaintLetter, HARDSHIP_ASK_TEXT, OMBUDSMAN_LINE, US_COLLECTOR_RULE } = lib('distress-triage.ts');
  const asks = Object.keys(HARDSHIP_ASK_TEXT);
  for (let mask = 0; mask < 1 << asks.length; mask++) {
    const pick = asks.filter((_, i) => mask & (1 << i));
    for (const floating of [false, true]) {
      const base = { name: '', lender: '', loanLabel: 'Credit card', accountRef: '', reason: '', canPay: '', asks: pick, floating, dateText: '14 October 2026' };
      const inL = hardshipLetter(base);
      assert.ok(inL.includes(OMBUDSMAN_LINE));
      assert.match(inL, /RBI\/2022-23\/108/);
      assert.match(inL, /reference number/);
      assert.match(inL, /\[your name\]/);
      const us = hardshipLetter({ ...base, country: 'US' });
      assert.doesNotMatch(us, /RBI|Ombudsman|EMI|₹|moratorium|Board-approved/, `mask ${mask}`);
      assert.match(us, /8 a\.m\. or after 9 p\.m\./);
      for (const l of [inL, us]) assert.match(l, /^DRAFT/);
    }
  }
  const c = agentComplaintLetter({ name: 'A', lender: 'HDFC Bank', loanLabel: 'Personal loan', accountRef: '123', when: '12 Oct, 9:40 p.m.', what: 'called my brother', agent: '', dateText: '14 October 2026' });
  assert.match(c, /Grievance Redressal Officer, HDFC Bank/);
  assert.match(c, /before 8 a\.m\. or after 7 p\.m\./);
  assert.ok(c.includes(OMBUDSMAN_LINE));
  assert.match(US_COLLECTOR_RULE.url, /^https:\/\/www\.consumerfinance\.gov\//);
});

test('B4/A22/E4: one savings baseline; "vs paying only minimums" is never a headline', () => {
  const { likelySaving, likelySavingText, LIKELY_LABEL, WORST_CASE_LABEL } = lib('savings-baseline.ts');
  const r = rng(7);
  for (let i = 0; i < 500; i++) {
    const pi = Math.round(r() * 1e6), li = Math.round(r() * 1e6), pm = r() < 0.2 ? null : Math.floor(r() * 300), lm = r() < 0.2 ? null : Math.floor(r() * 300);
    const s = likelySaving({ debtFreeMonth: pm, totalInterest: String(pi) }, { debtFreeMonth: lm, totalInterest: String(li) });
    assert.ok(s.interest >= 0 && s.months >= 0);
    assert.equal(s.same, s.interest < 1 && s.months === 0);
    if (li <= pi && (pm == null || lm == null || lm <= pm)) assert.equal(s.same, true);
    assert.match(likelySavingText(s, (v) => `₹${v}`), s.same ? /^about the same$/ : /^₹\d+ less/);
  }
  assert.equal(likelySaving({ debtFreeMonth: 1, totalInterest: '1' }, null), null);
  // The old headline words appear nowhere in the app's source.
  const banned = [/VS PAYING ONLY MINIMUMS/, /LESS THAN MINIMUMS/, /'TIME SAVED'/, /'Vs paying only minimums'/, /SAME AS PAYING MINIMUMS/];
  for (const [f, s] of ALL) for (const re of banned) assert.doesNotMatch(s, re, f);
  for (const f of ['components/setup/QuickSetup.tsx', 'components/plan/LedgerPlan.tsx']) {
    const s = src(f);
    assert.match(s, /WORST_CASE_LABEL/, f);
    assert.match(s, /<details data-testid="(setup|plan)-worst-case"/, f);
  }
  assert.match(src('components/setup/QuickSetup.tsx'), /LIKELY_LABEL/);
  assert.match(LIKELY_LABEL, /likely do without RightDue/);
  assert.match(WORST_CASE_LABEL, /^Worst case/);
  // The landing's KPI is the same baseline (smallest first, same total).
  assert.match(WELCOME.replace(/<[^>]+>/g, ' '), /VS SMALLEST FIRST/i);
});

test('B13/E2: one card-rate wording: statement rate first, one all-in figure, no average, no arrow', () => {
  const { rateLine, whyFirstShort } = lib('card-rate.ts');
  const r = rng(11);
  for (let i = 0; i < 500; i++) {
    const n = Math.round(r() * 4800) / 10000, e = r() < 0.2 ? n : Math.round(r() * 7000) / 10000;
    const line = rateLine(n, e);
    const pcts = line.match(/\d+\.\d\d%/g);
    assert.equal(pcts[0], `${(n * 100).toFixed(2)}%`, line);
    assert.ok(pcts.length <= 2, line);
    if (pcts.length === 2) assert.match(line, /about \d+\.\d\d% (all-in|after the tax break)$/);
    assert.doesNotMatch(line, /→/);
    const w = whyFirstShort(e, n);
    assert.equal(w.match(/\d+\.\d\d%/g).length, 2, w);
  }
  for (const [f, s] of ALL) {
    assert.doesNotMatch(s, /COST OF DEBT/, f);
    assert.doesNotMatch(s, /\{fmtPct\(d\.nominal\)\} →/, f);
    assert.doesNotMatch(s, /earns \$\{gap\} a year more than/, f);
  }
  assert.match(src('components/home/HomeDebtFree.tsx'), /whyFirstShort\(/);
});

test('E3: duplicate loan labels get Card 1/2/3; anything the user typed is kept', () => {
  const { disambiguateLoans, loanLabel, loanNickname } = lib('loan-types.ts');
  const types = ['credit_card', 'personal_loan', 'home_loan', 'auto_loan', 'gold_loan'];
  const banks = ['', '', 'HDFC', 'SBI Bank'];
  const r = rng(3);
  for (let i = 0; i < 400; i++) {
    const n = 1 + Math.floor(r() * 6);
    const loans = Array.from({ length: n }, (_, k) => ({ id: String(k), loan_type: types[Math.floor(r() * types.length)], bank: banks[Math.floor(r() * banks.length)], nickname: r() < 0.15 ? `Mine ${k}` : null }));
    const out = disambiguateLoans(loans);
    assert.equal(out.length, loans.length);
    out.forEach((l, k) => {
      assert.equal(l.bank, loans[k].bank);
      if (loanNickname(loans[k])) assert.equal(l.nickname, loans[k].nickname);
    });
    // Loans the user didn't name all read differently now.
    const auto = out.filter((_, k) => !loanNickname(loans[k])).map(loanLabel);
    const named = new Set(out.filter((_, k) => loanNickname(loans[k])).map(loanLabel));
    const counts = new Map(); for (const l of auto) counts.set(l, (counts.get(l) ?? 0) + 1);
    for (const [l, c] of counts) assert.ok(c === 1 || named.has(l), `${l} ×${c}`);
    // A label that was already unique is untouched.
    loans.forEach((l, k) => { if (loans.filter((x) => loanLabel(x) === loanLabel(l)).length === 1) assert.equal(out[k], l); });
  }
  const three = disambiguateLoans([1, 2, 3].map((i) => ({ loan_type: 'credit_card', bank: '', nickname: null })));
  assert.deepEqual(three.map(loanLabel), ['Card 1 (credit card)', 'Card 2 (credit card)', 'Card 3 (credit card)']);
  assert.match(src('components/setup/QuickSetup.tsx'), /disambiguateLoans\(stampBalanceDates\(/);
});

test('B7/B21: placeholders fit the loan kind; no ₹1.5 lakh default; no "₹x thousand" echo', () => {
  const { balancePlaceholder, emiPlaceholder } = lib('placeholders.ts');
  const num = (s) => Number(String(s).replace(/^e\.g\. /, '').replace(/ or .*$/, '').replace(/,/g, ''));
  for (const ccy of ['INR', 'USD']) for (const t of ['home_loan', 'auto_loan', 'personal_loan', 'credit_card', 'education_loan', 'gold_loan', 'bnpl']) {
    const b = balancePlaceholder(t, ccy), e = emiPlaceholder(t, ccy);
    assert.match(b, /^e\.g\. [\d,]+/);
    if (t === 'credit_card') assert.equal(e, undefined);
    else assert.ok(num(e) * 3 < num(b), `${ccy} ${t}: EMI ${e} vs balance ${b}`);
  }
  assert.notEqual(balancePlaceholder('personal_loan', 'INR'), balancePlaceholder('home_loan', 'INR'));
  assert.doesNotMatch(src('components/ToolPrimitives.tsx'), /e\.g\. 1,50,000/);
  assert.doesNotMatch(src('components/setup/QuickSetup.tsx'), /e\.g\. 1,50,000/);
  const { amountInWords } = lib('amount.ts');
  for (let v = 1000; v < 100000; v += 997) assert.equal(amountInWords(String(v), 'INR'), null, String(v));
  assert.equal(amountInWords('180000', 'INR'), '₹1.8 lakh');
  assert.equal(amountInWords('25000000', 'INR'), '₹2.5 crore');
  assert.equal(amountInWords('2400', 'USD'), '$2.4 thousand');
});

test('B17/B8/B6/B22/B25: copy class guards', () => {
  const code = (s) => s.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  for (const [f, s] of ALL) {
    assert.doesNotMatch(code(s), /dear debt|· DEAREST/, f);
    if (/QuickSetup|ProfileSummary/.test(f)) assert.doesNotMatch(s, /stay in this browser/, f);
  }
  const { PRIVACY_PROMISE } = require(path.join(root, 'components/PrivacyPromise.tsx'));
  assert.match(PRIVACY_PROMISE, /Singapore/);
  assert.match(PRIVACY_PROMISE, /Never sold or shared/);
  for (const f of ['components/setup/QuickSetup.tsx', 'components/profile/ProfileSummary.tsx']) assert.match(src(f), /PRIVACY_PROMISE|<PrivacyPromise/, f);
  const { startingChoices, missingChoices } = lib('setup-choices.ts');
  for (const c of [{ efMonths: null, efSplit: null, strategy: null }, { efMonths: 0, efSplit: null, strategy: 'snowball' }]) {
    for (const hasLoans of [true, false]) assert.deepEqual(missingChoices(startingChoices(c), hasLoans), []);
  }
  assert.equal(startingChoices({ efMonths: null, efSplit: null, strategy: null }).strategy, 'avalanche');
  assert.equal(startingChoices({ efMonths: 6, efSplit: '0.30', strategy: 'rules' }).strategy, 'rules');
  for (const f of ['components/home/LedgerHome.tsx', 'components/plan/LedgerPlan.tsx', 'components/activity/ActivityPage.tsx', 'app/goals/page.tsx']) assert.match(src(f), /<FirstVisitIntro id="/, f);
  assert.match(src('components/activity/ActivityPage.tsx'), /count === 0 \? 'nothing logged yet'/);
  assert.match(src('components/setup/QuickSetup.tsx'), /country === 'US' \? 'Make every payment'/);
});

test('A3/A10/B9/B10/B11/B23: landing copy', () => {
  const text = WELCOME.replace(/<[^>]+>/g, ' ');
  assert.match(WELCOME, /data-c="IN">FOR SALARIED INDIANS PAYING 2–5 EMIS AND CARDS</);
  assert.match(WELCOME, /data-c="US">FOR MORTGAGES, AUTO LOANS AND CREDIT CARDS · USA</); // US stays
  assert.match(WELCOME, /data-set-country="US"/);
  assert.match(text, /No lender pays us\. Sometimes the best advice is don't switch\./);
  assert.doesNotMatch(WELCOME, /vijeya@/);
  // Tool and tab headings never state a count the country view could contradict.
  assert.doesNotMatch(text, /TOOLS · (SIX|FIVE|\d)/);
  assert.doesNotMatch(text, /\b(Six|Five) tools\b/);
  // India-only features in "What's inside" are marked data-c="IN".
  const tabs = WELCOME.slice(WELCOME.indexOf('<div class="tabs">'), WELCOME.indexOf('<section id="tools"'));
  for (const li of tabs.match(/<li[^>]*>[^<]*<\/li>/g)) if (/UPI|RBI|EMI|NRI/.test(li) && !/data-c="US"/.test(li)) assert.match(li, /data-c="IN"/, li);
  // Steps follow Setup's order, with the email first.
  const steps = [...WELCOME.matchAll(/<div class="step[^"]*"><h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(steps, ['Confirm your email', 'Say what comes in and goes out', 'Add a loan or card', 'Pay, mark it, repeat']);
  assert.match(WELCOME, /\.steps\{[^}]*counter-reset:s -1\}/);
  // Example stamps aren't styled as filled buttons.
  assert.doesNotMatch(WELCOME, /\.stamp\.paid\{background:var\(--pos\)/);
  assert.match(src('lib/report-problem.ts'), /SUPPORT_EMAIL = 'support@rightdue\.app'/);
});
