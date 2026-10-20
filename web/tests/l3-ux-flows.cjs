const { profileSource } = require('./lib/profile-source.cjs'); // Audit 80 E15: Profile is split into parts/
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
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const Decimal = require('decimal.js');

// Sprint L3 (ux-flows): live-test findings #1, #4, #5, #6, #11, #13/#32,
// #19, #20 (rightdue-live-test.md). #23 is engine/tests/test_card_new_spend_interest.py.

// ─── #19: after logging, the recomputed split reads as the next round ──────
test('#19 after LOG IT the heading says "Got another ₹X? Here\'s where it would go next"', () => {
  const { whereItGoesHeading, nextRoundNote, kpiPrefix } = lib('windfall-log.ts');
  assert.equal(whereItGoesHeading(null, '₹50,000'), 'Where it goes');
  assert.equal(kpiPrefix(null), '');
  assert.equal(nextRoundNote(null), null);
  const logged = { lines: ['₹50,000 → HDFC credit card'], amount: '₹50,000', date: '2026-10-05' };
  assert.equal(whereItGoesHeading(logged, '₹50,000'), "Got another ₹50,000? Here's where it would go next");
  const note = nextRoundNote(logged);
  assert.match(note, /Already logged on 2026-10-05: ₹50,000 → HDFC credit card/);
  assert.match(note, /what-if for the next ₹50,000, not what you logged/);
  assert.match(kpiPrefix(logged), /IF YOU PAY IT AGAIN/);
  const tool = src('app/tools/windfall/tool.tsx');
  assert.match(tool, /whereItGoesHeading\(logged, fmt\(total\)\)/);
  assert.match(tool, /setLogged\(\{ lines, amount: fmt\(total\), date \}\)/);
  // A new amount starts a new round.
  assert.match(tool, /setAmount\(v\); setManual\(\{\}\); setMode\('engine'\); setApplied\(null\); setLogged\(null\);/);
});

// ─── #20: the date the money came in ──────────────────────────────────────
test('#20 the received date is checked: required, not in the future, flagged before a statement', () => {
  const { checkReceivedDate } = lib('windfall-log.ts');
  assert.deepEqual(checkReceivedDate('2026-10-05', '2026-10-12'), { ok: true });
  assert.deepEqual(checkReceivedDate('2026-10-12', '2026-10-12'), { ok: true });
  assert.equal(checkReceivedDate('2026-10-13', '2026-10-12').ok, false);
  assert.match(checkReceivedDate('2026-10-13', '2026-10-12').error, /future/);
  assert.equal(checkReceivedDate('', '2026-10-12').ok, false);
  assert.equal(checkReceivedDate('2026-02-31x', '2026-10-12').ok, false);
  const before = checkReceivedDate('2026-09-01', '2026-10-12', ['2026-09-20T00:00:00', undefined, '2026-08-01']);
  assert.equal(before.ok, true);
  assert.match(before.warning, /before the balance you entered on 2026-09-20/);
});

test('#20 the Activity entry and cash transfer are dated to the received date, not today', () => {
  const tool = src('app/tools/windfall/tool.tsx');
  assert.match(tool, /const date = received;/);
  assert.doesNotMatch(tool, /const date = localIsoDate\(new Date\(\)\);/);
  assert.match(tool, /type="date"[\s\S]{0,80}max=\{todayIso\}/);
  assert.match(tool, /Date it came in/);
});

test('#20 an entry dated before a loan\'s entered balance does not move that loan twice', () => {
  // The rule the warning describes is the activity layer's own (activity-cookie).
  const { activityDeltas } = lib('activity-cookie.ts');
  const loans = [{ id: 'L1', loan_type: 'personal_loan', bank: 'X', outstanding: '100000', nominal_rate: '0.14', rate_type: 'fixed', tenure_months_remaining: 24, scheduled_emi: '4800', balance_as_of: '2026-09-20' }];
  const entry = (date) => ({ id: date, loggedAt: `${date}T10:00:00.000Z`, loanIndex: 0, loanId: 'L1', kind: 'paid_extra', date, amount: '10000', scheduledEmi: '0' });
  const now = new Date('2026-10-12T05:00:00Z');
  assert.equal(activityDeltas([entry('2026-09-01')], loans, 'IN', now).length, 0);
  const after = activityDeltas([entry('2026-10-05')], loans, 'IN', now);
  assert.equal(after.length, 1);
  assert.equal(Number(after[0].principalReduction), 10000);
});

// ─── #4: loan nickname ────────────────────────────────────────────────────
test('#4 a loan nickname shows with the lender and type, and without one nothing changes', () => {
  const { loanLabel, loanName, loanNickname, NICKNAME_MAX } = lib('loan-types.ts');
  const car = { bank: 'HDFC Bank', loan_type: 'auto_loan' };
  assert.equal(loanLabel(car), 'HDFC car loan');
  assert.equal(loanName(car), 'HDFC car loan');
  assert.equal(loanLabel({ loan_type: 'home_loan' }), 'Home loan');
  assert.equal(loanName({ loan_type: 'home_loan' }), 'home loan');
  const dads = { ...car, nickname: "  Dad's   car loan " };
  assert.equal(loanNickname(dads), "Dad's car loan");
  assert.equal(loanLabel(dads), "Dad's car loan (HDFC car loan)");
  assert.equal(loanName(dads), "Dad's car loan");
  assert.equal(loanNickname({ nickname: 'x'.repeat(100) }).length, NICKNAME_MAX);
  assert.match(profileSource(), /label="Nickname \(optional\)"/);
  assert.match(src('lib/api.ts'), /nickname\?: string;/);
  // Spare cash, Activity and Home use it.
  assert.match(src('app/tools/windfall/tool.tsx'), /loanLabel\(l\)/);
  assert.match(src('components/activity/history.ts'), /loanLabel\(loan\)/);
  assert.match(src('components/home/OpenPositions.tsx'), /loanNickname\(loan\)/);
});

// ─── #5: city and state ───────────────────────────────────────────────────
test('#5 state lists are complete and a country switch drops the other country\'s state', () => {
  const { IN_STATES, US_STATES, stateFor, cleanCity, placeLabel, STATE_HELP } = lib('locations.ts');
  assert.equal(IN_STATES.length, 36); // 28 states + 8 union territories
  assert.equal(US_STATES.length, 51); // 50 states + DC
  assert.equal(new Set(IN_STATES).size, 36);
  assert.equal(new Set(US_STATES).size, 51);
  assert.ok(IN_STATES.includes('Tamil Nadu'));
  assert.equal(stateFor('IN', 'Tamil Nadu'), 'Tamil Nadu');
  assert.equal(stateFor('US', 'Tamil Nadu'), '');
  assert.equal(stateFor('IN', 'Atlantis'), '');
  assert.equal(cleanCity('  Chennai  '), 'Chennai');
  assert.equal(placeLabel({ city: 'Chennai', state: 'Tamil Nadu', country: 'IN' }), 'Chennai, Tamil Nadu');
  assert.equal(placeLabel({ country: 'IN' }), '');
  // Honest about what it changes: no number moves by state yet.
  for (const c of ['IN', 'US']) assert.match(STATE_HELP[c], /not|Nothing/);
  const profile = profileSource();
  assert.match(profile, /label="State \(optional\)"/);
  assert.match(profile, /label="City \(optional\)"/);
  // Integration L3 x G3: one `state`; the US keeps G3's two-letter field.
  assert.match(profile, /state: \(country === 'US' \? usState : stateFor\(country, homeState\)\) \|\| undefined/);
  assert.match(src('components/profile/ProfileSummary.tsx'), /'Lives in', placeLabel\(user\)/);
});

// ─── #11: business purpose on floating loans ──────────────────────────────
test('#11 an Indian floating loan asks "for a business?" and a yes drops the RBI 0% assumption', () => {
  const { asksBusinessPurpose, feeShownWithPurpose, BUSINESS_REASON, PURPOSE_HELP } = lib('loan-purpose.ts');
  const home = { loan_type: 'home_loan', rate_type: 'floating', prepayment_penalty_pct: '' };
  assert.equal(asksBusinessPurpose(home, 'IN'), true);
  assert.equal(asksBusinessPurpose({ ...home, rate_type: 'fixed' }, 'IN'), false);
  assert.equal(asksBusinessPurpose({ ...home, loan_type: 'credit_card' }, 'IN'), false);
  assert.equal(asksBusinessPurpose(home, 'US'), false);
  assert.equal(asksBusinessPurpose({ ...home, currency: 'INR' }, 'US'), true);
  // Not answered: still the RBI default, but the hint says what it assumes.
  const unasked = feeShownWithPurpose(home, 'IN');
  assert.equal(unasked.status, 'assumed');
  assert.match(unasked.hint, /Assumes the loan is not for a business/);
  // Personal: the plain RBI default.
  const personal = feeShownWithPurpose({ ...home, business_purpose: false }, 'IN');
  assert.equal(personal.status, 'assumed');
  assert.equal(personal.placeholder, '0 (assumed)');
  assert.doesNotMatch(personal.hint, /Assumes the loan/);
  // Business: not known, check the agreement.
  const biz = feeShownWithPurpose({ ...home, business_purpose: true }, 'IN');
  assert.deepEqual(biz, { status: 'unknown', placeholder: 'Not known', hint: BUSINESS_REASON });
  // Integration: defers to G1's feeShown (a bank business loan from 2026 is 0% again).
  const { feeShown } = lib('prepayment-fee.ts');
  const bank26 = { ...home, business_purpose: true, lender_type: 'bank', sanction_year: 2026 };
  assert.deepEqual(feeShownWithPurpose(bank26, 'IN'), feeShown(bank26, 'IN'));
  assert.equal(feeShownWithPurpose(bank26, 'IN').status, 'assumed');
  // An entered fee wins whatever the answer.
  assert.equal(feeShownWithPurpose({ ...home, business_purpose: true, prepayment_penalty_pct: '0.02' }, 'IN').status, 'entered');
  assert.match(PURPOSE_HELP, /yourself or your family/);
  assert.match(PURPOSE_HELP, /2 July 2025/);
  const profile = profileSource();
  assert.match(profile, /PrepaymentFeeFields/);
  assert.match(profile, /asksBusinessPurpose\(l, country\)/);
});

// ─── #13 / #32: every addend of "what this loan costs a year" ─────────────
test('#13 the 42% card: 9.11% compounding + 9.20% GST = 60.31%, each line named and worked out', () => {
  // Integration: sprint G1 made card GST flat (RBI MD 2022 para 9(b)(ii):
  // no interest on unpaid GST), so the 42% card costs 60.31%, not 62.52%.
  const { marginalCost } = lib('marginal-cost.ts');
  const { costLines, gstCompounds, GST_CARD_SOURCE } = lib('cost-lines.ts');
  const mc = marginalCost('0.42', true, 0, 0, 0);
  const lines = costLines('0.42', mc);
  assert.deepEqual(lines.map((l) => l.key), ['compounding', 'gst']);
  const [c, g] = lines;
  assert.equal(c.value.times(100).toFixed(2), '9.11');
  assert.equal(g.value.times(100).toFixed(2), '9.20');
  assert.equal(new Decimal('0.42').plus(c.value).plus(g.value).times(100).toFixed(2), '60.31');
  assert.match(c.label, /compounds/);
  assert.match(c.how, /42\.00% ÷ 12 = 3\.500% a month/);
  assert.match(c.how, /\(1 \+ 3\.500%\)\^12 − 1 = 51\.11% a year/);
  assert.match(g.label, /GST on the interest \(18%\)/);
  assert.match(g.how, /GST at 18% of the year's interest: 51\.11% × 18% = 9\.20%/);
  assert.equal(gstCompounds(mc), false);
  assert.equal(g.source, GST_CARD_SOURCE);
  assert.match(GST_CARD_SOURCE.url, /^https:\/\/www\.gstcouncil\.gov\.in\//);
  assert.match(GST_CARD_SOURCE.label, /11\/2017 and 12\/2017-Central Tax \(Rate\)/);
});

test('#13 if G1 makes GST flat (no compounding), the GST line follows the numbers', () => {
  const { compounded } = lib('marginal-cost.ts');
  const { costLines, gstCompounds } = lib('cost-lines.ts');
  const interest = compounded('0.42');
  const flat = { interest, gst: interest.times('0.18'), taxBenefit: new Decimal(0), fee: new Decimal(0) };
  assert.equal(gstCompounds(flat), false);
  const g = costLines('0.42', flat).find((l) => l.key === 'gst');
  assert.match(g.how, /GST at 18% of the year's interest: 51\.11% × 18% = 9\.20%/);
});

test('#32 the home loan\'s +0.34% is named: monthly compounding of 8.5%', () => {
  const { marginalCost } = lib('marginal-cost.ts');
  const { costLines } = lib('cost-lines.ts');
  const mc = marginalCost('0.085', false, 0, 0, 240);
  const lines = costLines('0.085', mc);
  assert.deepEqual(lines.map((l) => l.key), ['compounding']);
  assert.equal(lines[0].value.times(100).toFixed(2), '0.34');
  assert.equal(mc.interest.times(100).toFixed(2), '8.84');
  assert.match(lines[0].how, /8\.50% ÷ 12 = 0\.708% a month/);
});

test('#13 tax break and prepayment fee lines carry their reason and arithmetic', () => {
  const { marginalCost } = lib('marginal-cost.ts');
  const { costLines } = lib('cost-lines.ts');
  const mc = marginalCost('0.09', false, '0.3', '0.02', 60);
  const lines = costLines('0.09', mc, { taxNote: 'Old regime: 24b caps deduction at ₹200000/yr', monthsLeft: 60, feePct: '0.02' });
  const tax = lines.find((l) => l.key === 'tax');
  const fee = lines.find((l) => l.key === 'fee');
  assert.match(tax.how, /^Old regime: 24b caps/);
  assert.match(fee.how, /2\.00% × 12 ÷ 60 = 0\.40% a year/);
  const comp = src('components/EffectiveAprBreakdown.tsx');
  assert.match(comp, /costLines\(loan\.nominal_rate/);
  assert.match(comp, /data-testid=\{`cost-line-\$\{line\.key\}`\}/);
  assert.match(comp, /line\.source\.url/);
  // No unnamed "+X%" line is left.
  assert.doesNotMatch(comp, /label: 'GST on the interest \(18%\), compounding with it'/);
});

// ─── #1: first visit vs a guest's saved data ──────────────────────────────
test('#1 a signed-out visitor with a saved guest plan is asked: continue or start fresh', () => {
  const { shouldAskGuest, sinceLabel, RETURN_AFTER_MS, GUEST_COPY } = lib('guest-return.ts');
  const now = Date.parse('2026-10-12T08:00:00Z');
  const base = { signedIn: false, hasSavedProfile: true, lastSeenMs: null, nowMs: now, answeredThisTab: false };
  assert.equal(shouldAskGuest(base), true);
  assert.equal(shouldAskGuest({ ...base, signedIn: true }), false);
  assert.equal(shouldAskGuest({ ...base, hasSavedProfile: false }), false);
  assert.equal(shouldAskGuest({ ...base, answeredThisTab: true }), false);
  assert.equal(shouldAskGuest({ ...base, lastSeenMs: now - 60_000 }), false);
  assert.equal(shouldAskGuest({ ...base, lastSeenMs: now - RETURN_AFTER_MS }), true);
  assert.equal(sinceLabel(now - 3 * 86_400_000, now), '3 days ago');
  assert.equal(sinceLabel(now - 86_400_000, now), 'yesterday');
  assert.equal(sinceLabel(null, now), null);
  assert.match(GUEST_COPY.confirm, /cannot be undone/);
  const comp = src('components/home/GuestWelcomeBack.tsx');
  assert.match(comp, /clearAccountCache\(\);/);
  assert.match(comp, /window\.location\.assign\('\/onboarding'\)/);
  assert.match(src('app/page.tsx'), /<GuestWelcomeBack \/>/);
});

// ─── #6: Google sign-in behind a flag ─────────────────────────────────────
test('#6 Continue with Google shows only when the server turns it on, and keeps next same-site', () => {
  const { googleStartHref, GOOGLE_CONFIG_PATH } = lib('google-signin.ts');
  assert.equal(GOOGLE_CONFIG_PATH, '/api/auth/google/config');
  assert.equal(googleStartHref(null), '/api/auth/google/start');
  assert.equal(googleStartHref('/plan'), '/api/auth/google/start?next=%2Fplan');
  assert.equal(googleStartHref('//evil.example'), '/api/auth/google/start');
  assert.equal(googleStartHref('https://evil.example/x'), '/api/auth/google/start');
  const login = src('app/login/page.tsx');
  assert.match(login, /\{googleOn && \(/);
  assert.match(login, /setGoogleOn\(c\.enabled === true\)/);
  assert.match(login, /params\.get\('google'\) === '1'/);
  // One path after every sign-in (code or Google).
  assert.equal((login.match(/await finishSignIn\(/g) ?? []).length, 1);
  assert.match(login, /finishSignIn\(user\.id\)/);
  const deploy = fs.readFileSync(path.resolve(__dirname, '../../DEPLOY.md'), 'utf8');
  assert.match(deploy, /## Sign in with Google \(optional, off by default\)/);
  assert.match(deploy, /GOOGLE_OAUTH_CLIENT_SECRET/);
  assert.match(deploy, /\/api\/auth\/google\/callback/);
});
