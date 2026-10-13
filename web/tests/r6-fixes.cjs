// Live re-test 6 (13 Oct 2026) fixes: R6-1 … R6-6.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const test = require('node:test');
const root = path.resolve(__dirname, '../src');
const web = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, ...rest);
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'next/navigation') return { useRouter: () => ({ refresh() {} }), usePathname: () => '/' };
  return originalLoad.call(this, request, ...rest);
};
for (const ext of ['.ts', '.tsx'])
  require.extensions[ext] = (module, file) => {
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText;
    module._compile(output, file);
  };
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const { NextRequest } = require('next/server');

test('R6-1: security.txt Expires is an RFC 3339 UTC date-time in the future (RFC 9116 §2.5.5)', () => {
  const txt = fs.readFileSync(path.join(web, 'public/.well-known/security.txt'), 'utf8');
  const lines = txt.split(/\r?\n/).filter((l) => /^Expires:/i.test(l));
  assert.equal(lines.length, 1, 'exactly one Expires field');
  const value = lines[0].replace(/^Expires:\s*/i, '');
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  const when = Date.parse(value);
  assert.ok(Number.isFinite(when));
  assert.equal(new Date(when).toISOString().slice(0, 19), value.slice(0, 19), 'round-trips');
  // RFC 9116 recommends less than a year ahead of publication; never in the past.
  assert.ok(when > Date.parse('2026-10-13T00:00:00Z'));
  assert.ok(when < Date.parse('2027-10-14T00:00:00Z'));
  assert.match(txt, /^Contact: mailto:/m);
});

const route = () => require(path.join(root, 'app/api/session/[...path]/route.ts'));
const ctx = (p) => ({ params: Promise.resolve({ path: p.split('/') }) });
const noStore = (res) => {
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.match(res.headers.get('vary') || '', /Cookie/);
};

test('R6-6: every /api/session answer is private, no-store with Vary: Cookie (signed out, signed in, 401, 404, 405, HEAD)', async () => {
  const { GET, POST, HEAD } = route();
  const original = global.fetch;
  const upstream = [];
  global.fetch = async (url) => {
    upstream.push(String(url));
    return String(url).endsWith('/api/auth/me')
      ? new Response(JSON.stringify({ detail: 'expired' }), { status: 401, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' } })
      : new Response(JSON.stringify({ email: 'a@example.com' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const signedOut = await GET(new NextRequest('https://rightdue.app/api/session/auth/me'), ctx('auth/me'));
    assert.equal(signedOut.status, 200);
    noStore(signedOut);
    const stale = await GET(new NextRequest('https://rightdue.app/api/session/auth/me', { headers: { cookie: 'rightdue_session=stale' } }), ctx('auth/me'));
    assert.equal(stale.status, 401);
    noStore(stale);
    const state = await GET(new NextRequest('https://rightdue.app/api/session/user/state', { headers: { cookie: 'rightdue_session=ok' } }), ctx('user/state'));
    assert.equal(state.status, 200);
    noStore(state);
    noStore(await GET(new NextRequest('https://rightdue.app/api/session/nope'), ctx('nope')));
    const wrongMethod = await POST(new NextRequest('https://rightdue.app/api/session/auth/me', { method: 'POST', body: '{}' }), ctx('auth/me'));
    assert.equal(wrongMethod.status, 405);
    noStore(wrongMethod);
    const head = await HEAD(new NextRequest('https://rightdue.app/api/session/auth/me', { method: 'HEAD' }), ctx('auth/me'));
    noStore(head);
    const forbidden = await POST(new NextRequest('https://rightdue.app/api/session/auth/logout', { method: 'POST', body: '{}', headers: { origin: 'https://evil.example' } }), ctx('auth/logout'));
    assert.equal(forbidden.status, 403);
    noStore(forbidden);
    assert.equal(upstream.length, 2, 'only the stale-cookie me and user/state reach the API');
  } finally { global.fetch = original; }
});

test('R6-2: the coarse-pointer 44px rule wins (base l-hit rule sits before it) and covers the missed targets', () => {
  const css = src('styles/globals.css');
  const base = css.indexOf('button.l-hit {\n  min-height: 24px;');
  const coarse = css.indexOf('@media (pointer: coarse) {\n  button.l-hit,');
  assert.ok(base >= 0 && coarse >= 0);
  assert.ok(base < coarse, 'the 24px base rule must come before the 44px coarse block, or it overrides it');
  assert.equal(css.split('button.l-hit {\n  min-height: 24px;').length, 2, 'one base rule');
  const block = css.slice(coarse, css.indexOf('\n}\n', coarse));
  assert.match(block, /min-height: 44px;/);
  assert.match(block, /min-width: 44px;/);
  assert.match(block, /\.rd-site-footer a \{[^}]*min-height: 44px;/);
  // Every button, select and button-like control, not only l-hit ones.
  assert.match(block, /button,\s*select,\s*summary,\s*\[role='button'\] \{\s*min-height: 44px !important;/);
  assert.match(block, /a\[href\] \{\s*min-height: 44px !important;/);
  // Stand-alone links on Home take the l-hit box too.
  assert.match(src('components/home/HomeDebtFree.tsx'), /<Link href="\/plan" className="l-hit">/);
  assert.match(css, /\.l-check-row > input\[type='checkbox'\][^{]*\{\s*flex-shrink: 0;/);
  // The Plan +N YRS buttons and Home's "Remind me next month" use the class.
  assert.match(src('components/plan/TenureWhatIf.tsx'), /onClick=\{\(\) => setMonths\(months === m \? 0 : m\)\}\s*className="l-hit"/);
  assert.match(src('components/home/HomeProgress.tsx'), /<button type="button" className="l-hit" onClick=\{\(\) => later\(p\)\}/);
  assert.match(src('components/site/SiteFooter.tsx'), /className="rd-site-footer"/);
});

test('R6-3: what-if inputs use a "0" placeholder that fits a 390px box, not the readout words', () => {
  const s = src('components/WhatIfPanel.tsx');
  assert.match(s, /placeholder="0"/);
  assert.doesNotMatch(s, /placeholder=\{[^}]*formatValue\(0\)/);
});

test('R6-4: 0 months unpaid says nothing is unpaid and no credit-report line', () => {
  const { missedCostClosing, NOTHING_UNPAID_LINE, readMonthsUnpaid } = require(path.join(root, 'lib/distress-triage.ts'));
  assert.deepEqual(readMonthsUnpaid('0'), { months: 0, error: null });
  const zero = missedCostClosing(0, '₹0');
  assert.equal(zero, NOTHING_UNPAID_LINE);
  assert.doesNotMatch(zero, /credit report|Adds about/);
  assert.equal(missedCostClosing(1, '₹2,000'), 'Adds about ₹2,000, plus a missed payment on your credit report.');
  assert.equal(missedCostClosing(3, '₹9,000'), 'Adds about ₹9,000, plus missed payments on your credit report. After 90 days unpaid the loan is classed a default (NPA).');
  const ui = src('components/distress/CantPay.tsx');
  assert.match(ui, /valid && n === 0 \?/);
  assert.match(ui, /missedCostClosing\(n, fc\(cost\.total\)\)/);
});

test("R6-5: a paid card's owed-after on Pay this month is the loans list's figure, in the same words", () => {
  const { owedAfterLabel } = require(path.join(root, 'lib/pay-this-month.ts'));
  const fmt = (v) => '₹' + Math.round(v).toLocaleString('en-IN');
  const card = { card: true, owedAfter: 159744 };
  // Before paying: the plan's month-end figure, said to include the interest.
  assert.equal(owedAfterLabel(card, { owed: 200000 }, fmt), "₹1,59,744 STILL OWED AFTER, WITH THIS MONTH'S INTEREST");
  // After MARK PAID: the B-12 figure (entered balance less the payment).
  assert.equal(owedAfterLabel(card, { owed: 152500, cardBefore: 200000 }, fmt), '≈ ₹1,52,500 OWED NOW, BEFORE INTEREST');
  // Loans keep the plan's figure.
  assert.equal(owedAfterLabel({ card: false, owedAfter: 45900 }, { owed: 50000 }, fmt), '₹45,900 STILL OWED AFTER');
  assert.equal(owedAfterLabel({ card: false }, undefined, fmt), '');
  // The owed-now row comes from the same lib the loans list uses.
  const ui = src('components/home/PayThisMonth.tsx');
  assert.match(ui, /import \{ owedNow \} from '@\/lib\/owed-now';/);
  assert.match(ui, /kindLine\(row, fmt, owedNowFor\(row\)\)/);
  assert.match(src('components/home/OpenPositions.tsx'), /LESS THIS MONTH&apos;S PAYMENT, BEFORE INTEREST/);
});

test("R6-5: Activity's planned amount for a plan extra is the plan's whole payment", () => {
  const { buildHistory } = require(path.join(root, 'components/activity/history.ts'));
  const cardLoan = { id: 'c', bank: 'DEMO', loan_type: 'credit_card', outstanding: '200000', nominal_rate: '.40', scheduled_emi: '0', currency: 'INR' };
  const u = { country: 'IN', income_type: 'salaried', monthly_income: '90000', annual_income: '1080000', annual_gross_salary: '1080000', fixed_expenses: '38000', savings_balance: '0', primary_bank: 'DEMO', loans: [cardLoan] };
  const entry = { id: 'x', loanIndex: 0, loanId: 'c', kind: 'paid_extra', amount: '47500', scheduledEmi: '10000', plannedExtra: '37500', date: '2026-10-07', loggedAt: '2026-10-07T04:30:00.000Z', via: 'home' };
  const row = (e) => buildHistory({ user: u, entries: [e], spend: [], life: [], today: '2026-10-07' })[0].rows.find((r) => r.key === 'x');
  const r = row(entry);
  assert.equal(r.planned, '₹47,500');
  assert.equal(r.actual, '₹47,500');
  assert.equal(r.effect.text, '−₹37,500 OFF THE BALANCE, AS PLANNED');
  // More than the plan asked: says how much more.
  const more = row({ ...entry, amount: '50000' });
  assert.equal(more.planned, '₹47,500');
  assert.equal(more.effect.text, '−₹40,000 OFF THE BALANCE · ₹2,500 MORE THAN THE PLAN');
  // An extra the plan didn't ask for is still called extra; planned is the minimum.
  const own = row({ ...entry, plannedExtra: undefined });
  assert.equal(own.planned, '₹10,000');
  assert.equal(own.effect.text, '−₹37,500 EXTRA OFF THE BALANCE');
});

test('UX50 A-12: IBM Plex Mono is self-hosted in three weights; no Google Fonts request on the app or the landing', () => {
  const layout = src('app/layout.tsx');
  assert.doesNotMatch(layout, /fonts\.googleapis|fonts\.gstatic/);
  assert.match(layout, /rel="preload" href="\/fonts\/ibm-plex-mono-400-latin\.woff2" as="font" type="font\/woff2" crossOrigin=""/);
  const css = src('styles/globals.css');
  const faces = css.match(/@font-face \{[^}]*\}/g) || [];
  const weights = new Set(faces.map((f) => f.match(/font-weight: (\d+)/)[1]));
  assert.deepEqual([...weights].sort(), ['400', '600', '700'], 'three weights, 500 dropped');
  for (const f of faces) {
    assert.match(f, /font-family: 'IBM Plex Mono';/);
    assert.match(f, /font-display: swap;/);
    const file = f.match(/url\('\/fonts\/([^']+)'\)/)[1];
    const bytes = fs.readFileSync(path.join(web, 'public/fonts', file));
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'wOF2', `${file} is a woff2`);
  }
  // ₹ (U+20B9) is covered by the latin-ext face.
  assert.ok(faces.some((f) => /U\+20AD-20C\d/.test(f)));
  const welcome = fs.readFileSync(path.join(web, 'public/welcome.html'), 'utf8');
  assert.doesNotMatch(welcome, /fonts\.googleapis|fonts\.gstatic/);
  assert.match(welcome, /url\('\/fonts\/ibm-plex-mono-700-latin\.woff2'\)/);
  // Signed-out visitors get the font files (not a redirect to /login).
  assert.match(src('middleware.ts'), /\|fonts\/\)\.\*\)'/);
});
