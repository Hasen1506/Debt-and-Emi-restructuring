// Round 3 part D (17 Oct 2026): UX walkthrough 2 #20 (lump sum: lower EMI or finish sooner;
// Profile balance drops logged) and #23 (dark mode, offline, slow network, two tabs).
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
  if (request === 'next/navigation') return { useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() };
  if (request === 'server-only') return {};
  return load.call(this, request, ...rest);
};
for (const ext of ['.ts', '.tsx'])
  require.extensions[ext] = (m, f) =>
    m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText, f);
const lib = (n) => require(path.join(root, 'lib', n));
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ── #20 lump sum: "lower your EMI or finish sooner?" ──────────────────────────
test('#20: the lower EMI is the same loan re-worked over the months left (hand check)', () => {
  const { lowerEmiAfter, asksPrepayChoice } = lib('prepay-choice.ts');
  const home = { loan_type: 'home_loan', outstanding: '4000000', nominal_rate: '0.085', tenure_months_remaining: 240, scheduled_emi: '34713' };
  // pmt(35,00,000, 8.5%/12, 240) = 30,373.81 (engine/tests/test_prepay_choice.py golden)
  assert.ok(Math.abs(lowerEmiAfter(home, 500000) - 30373.81) < 0.01);
  // Never above today's EMI, none when the payment clears the loan, none for a card.
  for (const paid of [1, 1000, 100000, 3999999]) assert.ok(lowerEmiAfter(home, paid) <= 34713);
  assert.equal(lowerEmiAfter(home, 4000000), null);
  assert.equal(asksPrepayChoice({ ...home, loan_type: 'credit_card', scheduled_emi: '0' }), false);
});

test('#20: the question says what each country\'s lender does (India asks; US recast)', () => {
  const { prepayChoiceNote, prepayLabel } = lib('prepay-choice.ts');
  assert.match(prepayChoiceNote('IN'), /bank asks which one/i);
  assert.match(prepayChoiceNote('IN'), /no instruction/);
  assert.match(prepayChoiceNote('US'), /recast/);
  assert.match(prepayChoiceNote('US'), /FHA, VA and USDA/);
  assert.match(prepayLabel('reduce_emi', 'US'), /payment/);
  assert.match(prepayLabel('reduce_emi', 'IN'), /EMI/);
});

test('#20: no answer is picked silently in What-if or Activity', () => {
  const what = src('components/WhatIfPanel.tsx');
  assert.match(what, /useState<PrepayMode \| null>\(null\)/);
  assert.match(what, /if \(lumpAsks && !lumpMode\) \{\s*setLumpModeTried\(true\);\s*return;/);
  assert.match(what, /\.\.\.\(lumpMode \? \{ lump_sum_mode: lumpMode \} : \{\}\)/);
  const dlg = src('components/activity/LogDialog.tsx');
  assert.match(dlg, /prepay: asksPrepay && !prepayMode \?/);
  assert.match(dlg, /useState<PrepayMode \| null>\(edit\?\.prepayMode \?\? null\)/);
});

const home = (extra = {}) => ({ id: 'L1', loan_type: 'home_loan', bank: 'SBI', outstanding: '3500000', nominal_rate: '0.085', tenure_months_remaining: 240, scheduled_emi: '34713', ...extra });

test('#20: a balance lowered in Profile is logged as the prepayment or correction it was, and never taken off twice', () => {
  const { balanceEditEntries, overdueAmount } = lib('activity.ts');
  const { activityDeltas } = lib('activity-cookie.ts');
  const { paymentState } = lib('payment-state.ts');
  const recordedAt = '2026-10-17T07:30:00.000Z';
  const today = '2026-10-17';
  const before = [home({ outstanding: '4000000' })];
  const after = [home({ balance_as_of: today, balance_recorded_at: recordedAt })];
  for (const reason of ['prepayment', 'correction']) {
    const [e, ...rest] = balanceEditEntries(before, after, { L1: reason }, today, recordedAt);
    assert.equal(rest.length, 0);
    assert.equal(e.amount, '500000.00');
    assert.equal(e.kind, reason === 'prepayment' ? 'paid_extra' : 'balance_correction');
    assert.deepEqual(e.fromProfileEdit, { from: '4000000', to: '3500000' });
    assert.ok(Date.parse(e.loggedAt) < Date.parse(recordedAt));
    // The new balance already includes it: no delta moves the plan.
    const deltas = activityDeltas([{ ...e, id: 'x' }], after, 'IN', new Date('2026-10-17T09:00:00Z'));
    assert.equal(deltas.filter((d) => Number(d.principalReduction || 0) > 0 || Number(d.overdue) > 0).length, 0, reason);
    // Neither marks this month's EMI as paid; a correction is no money at all.
    assert.equal(paymentState([{ ...e, id: 'x' }], 34713, 34713), reason === 'prepayment' ? 'due' : 'due');
    if (reason === 'correction') assert.equal(overdueAmount({ ...e, id: 'x' }), '0');
  }
  // No reason given, a rise, a card, or a new loan: nothing logged.
  assert.equal(balanceEditEntries(before, after, {}, today, recordedAt).length, 0);
  assert.equal(balanceEditEntries(after, before, { L1: 'prepayment' }, today, recordedAt).length, 0);
  assert.equal(balanceEditEntries([], after, { L1: 'prepayment' }, today, recordedAt).length, 0);
});

test('#20: Profile asks why an EMI loan balance went down and will not save without an answer', () => {
  const p = src('app/profile/ProfileClient.tsx');
  assert.match(p, /dropErrors\.every\(\(e\) => !e\) &&/);
  assert.match(p, /l\.loan_type === 'credit_card'/);
  assert.match(p, /logBalanceDrops\(savedBefore, stampedUser, dropReasons/);
  // The entries are logged before the new balance's stamp (same recordedAt).
  assert.match(p, /stampBalanceDates\(userWithFx\.loans, savedBefore, localIsoDate\(getCountryToday\(country\)\), recordedAt\)/);
});

// ── #23 dark mode ─────────────────────────────────────────────────────────────
function palette(css, selector) {
  const at = css.indexOf(selector);
  assert.ok(at >= 0, selector);
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
}
function contrast(a, b) {
  const lum = (h) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test('#23: every text colour on every surface is WCAG AA (4.5:1) in light and dark', () => {
  const css = src('styles/globals.css');
  const light = palette(css, ':root {');
  const darkA = palette(css, ":root[data-theme='dark'] {");
  // UI revert 18 Oct 2026: dark is opt-in only, so there is no system-dark
  // palette any more (it was required to equal the chosen-dark one).
  assert.doesNotMatch(css, /prefers-color-scheme: dark/, 'the system dark setting is not followed');
  const texts = ['ink', 'muted', 'accent', 'negative', 'positive', 'warning', 'accent-ink'];
  const surfaces = ['canvas', 'card', 'soft-bg', 'highlight', 'highlight-soft'];
  for (const [name, p] of [['light', light], ['dark', darkA]]) {
    for (const t of texts) for (const s of surfaces) {
      if (t === 'warning' && s.startsWith('highlight')) continue; // never drawn there
      const r = contrast(p[t], p[s]);
      assert.ok(r >= 4.5, `${name}: --${t} on --${s} is ${r.toFixed(2)}:1`);
    }
    // Solid buttons: card-coloured text on accent and ink, page colour on ink.
    assert.ok(contrast(p.card, p.accent) >= 3, `${name}: text on an accent button`);
    assert.ok(contrast(p.canvas, p.ink) >= 4.5, `${name}: text on an ink button`);
  }
});

test('#23: components read the tokens, so dark mode reaches them; no raw white text on colour', () => {
  const prim = src('components/ledger/primitives.tsx');
  const block = prim.slice(prim.indexOf('export const L_T = {'), prim.indexOf('} as const;'));
  for (const [, v] of block.matchAll(/^\s+\w+: '([^']+)'/gm)) assert.match(v, /^var\(--[a-z-]+\)$/);
  const files = ['app/profile/ProfileClient.tsx', 'components/ledger/LToolSteps.tsx', 'components/lifecycle/LifecycleArrivalPrompts.tsx',
    'components/legal/DraftLegalMarker.tsx', 'components/ledger/primitives.tsx', 'app/profile/parts/savings-fields.tsx'];
  for (const f of files) assert.doesNotMatch(src(f), /color: [^,\n]*'(#fff|white|#8b3a1f)'/, f);
});

test('#23: the theme is set before the first paint (no flash) and the Profile toggle exists', () => {
  const layout = src('app/layout.tsx');
  assert.ok(layout.indexOf('THEME_SCRIPT') < layout.indexOf('<body>'), 'the script is in <head>');
  assert.match(layout, /<html lang="en" suppressHydrationWarning>/);
  const { THEME_SCRIPT, THEME_KEY } = lib('theme.ts');
  // Run the script against a fake document: only a stored Dark sets the
  // attribute; anything else leaves the page light (UI revert 18 Oct 2026:
  // light by default, the system setting is not followed).
  for (const [stored, want] of [['dark', 'dark'], ['light', undefined], [null, undefined], ['blue', undefined]]) {
    const attrs = {};
    const ctx = { localStorage: { getItem: (k) => (k === THEME_KEY ? stored : null) }, document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } } };
    new Function('localStorage', 'document', THEME_SCRIPT)(ctx.localStorage, ctx.document);
    assert.equal(attrs['data-theme'], want, String(stored));
  }
  assert.match(src('components/profile/ProfileSummary.tsx'), /<ThemeToggle \/>/);
  // Print stays light: the dark tokens are screen-only.
  const css = src('styles/globals.css');
  assert.match(css, /@media screen \{\s*:root\[data-theme='dark'\]/);
  assert.doesNotMatch(css, /prefers-color-scheme/);
  // Appearance offers Light and Dark only; no "as my device".
  const toggle = src('components/site/ThemeToggle.tsx');
  assert.match(toggle, /'LIGHT'/);
  assert.match(toggle, /'DARK'/);
  assert.doesNotMatch(toggle, /system|AS MY DEVICE/);
});

// ── #23 offline ───────────────────────────────────────────────────────────────
// A tiny DOM: enough of Element for snapshotMain (querySelector by tag or
// attribute, clone, remove, innerText as the text of what is left).
function el(tag, attrs = {}, kids = []) {
  const node = { tag, attrs: { ...attrs }, kids: [], parent: null, style: {},
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { c.parent = this; this.kids.push(c); return c; },
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; },
    cloneNode() { const c = el(tag, this.attrs, this.kids.map((k) => (typeof k === 'string' ? k : k.cloneNode()))); return c; },
    all() { return this.kids.filter((k) => typeof k !== 'string').flatMap((k) => [k, ...k.all()]); },
    matches(sel) { return sel.split(',').map((s) => s.trim()).some((s) => {
      const a = s.match(/^\[([\w-]+)="([^"]+)"\]$/); if (a) return this.attrs[a[1]] === a[2];
      if (s.startsWith('.')) return (this.attrs.class || '').split(' ').includes(s.slice(1));
      return this.tag === s; }); },
    querySelector(sel) { return this.all().find((n) => n.matches(sel)) || null; },
    querySelectorAll(sel) { return this.all().filter((n) => n.matches(sel)); },
    get textContent() { return this.kids.map((k) => (typeof k === 'string' ? k : k.textContent)).join(''); },
    get innerText() { return this.kids.map((k) => (typeof k === 'string' ? k : (k.tag === 'p' || k.tag === 'h2' ? k.innerText + '\n' : k.innerText))).join(''); },
  };
  for (const k of kids) if (typeof k === 'string') node.kids.push(k); else node.appendChild(k);
  return node;
}
function fakeDoc(main) { const body = el('body', {}, main ? [main] : []); return { body, querySelector: (s) => body.querySelector(s) }; }
function memStore() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; }

test('#23 offline-snapshot: keeps the finished page text with its time, without controls', () => {
  const { snapshotMain, SNAPSHOT_KEY } = lib('offline-snapshot.ts');
  const main = el('main', { id: 'main' }, [
    el('h2', {}, ['DEBT-FREE BY']), el('p', {}, ['March 2031']),
    el('button', {}, ['LOG A PAYMENT']), el('input', { value: '5000' }), el('nav', {}, ['Home Plan']),
    el('span', { class: 'sr-only' }, ['opens a dialog']), el('span', { 'aria-hidden': 'true' }, ['→']),
    el('p', {}, ['Next due ₹34,713 on 5 Nov']),
  ]);
  const doc = fakeDoc(main); const store = memStore();
  const now = new Date('2026-10-07T04:30:00Z');
  assert.equal(snapshotMain('/', doc, store, now), true);
  const saved = JSON.parse(store.getItem(SNAPSHOT_KEY));
  assert.equal(saved['/'].at, '2026-10-07T04:30:00.000Z');
  assert.match(saved['/'].text, /DEBT-FREE BY\nMarch 2031/);
  assert.match(saved['/'].text, /Next due ₹34,713 on 5 Nov/);
  for (const gone of ['LOG A PAYMENT', 'Home Plan', 'opens a dialog', '→']) assert.ok(!saved['/'].text.includes(gone), gone);
  // The live page is untouched and the off-screen copy is gone.
  assert.ok(main.querySelector('button'));
  assert.equal(doc.body.kids.length, 1);
  // A second page is kept beside the first, not over it.
  assert.equal(snapshotMain('/plan', fakeDoc(el('main', {}, [el('p', {}, ['Avalanche order'])])), store, now), true);
  assert.deepEqual(Object.keys(JSON.parse(store.getItem(SNAPSHOT_KEY))).sort(), ['/', '/plan']);
});

test('#23 offline-snapshot: a page still loading, empty, or missing is never kept', () => {
  const { snapshotMain, SNAPSHOT_KEY } = lib('offline-snapshot.ts');
  const store = memStore();
  assert.equal(snapshotMain('/', fakeDoc(el('main', {}, [el('div', { 'aria-busy': 'true' }, ['Working out your plan…'])])), store), false);
  assert.equal(snapshotMain('/', fakeDoc(el('main', {}, [el('button', {}, ['ONLY A BUTTON'])])), store), false);
  assert.equal(snapshotMain('/', fakeDoc(null), store), false);
  assert.equal(store.getItem(SNAPSHOT_KEY), null);
  // Corrupt storage or a full quota is not an error: just not kept.
  const bad = { getItem: () => '{', setItem() {} };
  assert.equal(snapshotMain('/', fakeDoc(el('main', {}, [el('p', {}, ['x'])])), bad), false);
  const full = { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } };
  assert.equal(snapshotMain('/', fakeDoc(el('main', {}, [el('p', {}, ['x'])])), full), false);
  // Very long pages are capped.
  const big = memStore();
  snapshotMain('/plan', fakeDoc(el('main', {}, [el('p', {}, ['9'.repeat(20000)])])), big);
  assert.equal(JSON.parse(big.getItem(SNAPSHOT_KEY))['/plan'].text.length, 12000);
});

test('#23 offline: the service worker never serves an app page from cache, only offline.html when the network fails', async () => {
  const code = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
  const handlers = {}; const cached = new Map([['/offline.html', 'OFFLINE PAGE']]);
  const self = { addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting() {}, clients: { claim() {} } };
  const caches = { match: async (u) => cached.get(u), open: async () => ({ add: async () => {} }), keys: async () => [], delete: async () => true };
  let net = 'up';
  const fetch = async (req) => { if (net === 'down') throw new TypeError('Failed to fetch'); return `LIVE ${req.url}`; };
  new Function('self', 'caches', 'fetch', 'Request', 'Response', code)(self, caches, fetch, class { constructor(u) { this.url = u; } }, { error: () => 'ERR' });
  const run = async (req) => { let r = null; handlers.fetch({ request: req, respondWith: (p) => { r = p; } }); return r && (await r); };
  const nav = { method: 'GET', mode: 'navigate', url: '/plan' };
  assert.equal(await run(nav), 'LIVE /plan', 'online: always the network');
  net = 'down';
  assert.equal(await run(nav), 'OFFLINE PAGE', 'offline: the offline page, never a cached /plan');
  assert.equal(await run({ method: 'GET', mode: 'cors', url: '/api/plan' }), null, 'data requests are left to the browser');
  assert.equal(await run({ method: 'POST', mode: 'navigate', url: '/login' }), null, 'posts are left alone');
  // offline.html says its figures are not live and shows their time.
  const off = fs.readFileSync(path.join(__dirname, '../public/offline.html'), 'utf8');
  assert.match(off, /These figures are not live/);
  assert.match(off, /'As of '/);
  // The pages are reachable without a session (middleware skips them).
  // The kept text is this person's: sign-out clears it; the theme is the device's.
  const sync = src('lib/server-sync.ts');
  assert.ok(sync.slice(sync.indexOf('LOCAL_PER_USER_KEYS = ['), sync.indexOf('] as const;', sync.indexOf('LOCAL_PER_USER_KEYS = ['))).includes("'rightdue_offline_snapshot'"));
  assert.match(sync, /LOCAL_DEVICE_KEYS = \[[^\]]*'rightdue_theme'/);
  assert.match(src('middleware.ts'), /offline\\\\\.html\$\|sw\\\\\.js\$/);
});

test('#23 offline: the notice and snapshots only run on Home and Plan, once the page has settled and only while online', () => {
  const s = src('components/site/OfflineSupport.tsx');
  assert.match(s, /if \(path !== '\/' && path !== '\/plan'\) return;/);
  assert.match(s, /if \(navigator\.onLine && .*\) snapshotMain\(path, document, localStorage\)/);
  // Not written back after a sign-out cleared the browser (usa-journey: localStorage empty after SIGN OUT).
  assert.match(s, /localStorage\.getItem\(ACCOUNT_KEY\) === owner\) snapshotMain/);
  assert.match(src('app/layout.tsx'), /<OfflineSupport register=\{process\.env\.NODE_ENV === 'production'\} \/>/);
});

// ── #23 two tabs ──────────────────────────────────────────────────────────────
test('#23 two tabs: the Profile form compares the saved profile with what it opened with, and asks', () => {
  const { changedSince, CHANGED_ELSEWHERE, formWouldEraseSavedLoans } = lib('tab-guard.tsx');
  assert.equal(changedSince('a\u0000b', 'a\u0000b'), false);
  assert.equal(changedSince('a\u0000b', 'a2\u0000b'), true);
  assert.equal(CHANGED_ELSEWHERE, 'Changed in another tab — reload or overwrite?');
  const g = src('lib/tab-guard.tsx');
  // Snapshot once the account copy is in the form, not on the blank first paint.
  assert.match(g, /if \(!ready\) \{\s*openedWith\.current = null;\s*return;\s*\}\s*openedWith\.current = profileCookieKey\(\);\s*\}, \[ready\]\);/);
  assert.match(g, /if \(!ready\) return true;/);
  assert.equal(formWouldEraseSavedLoans([{ outstanding: '2500000' }], [{ outstanding: '' }], false), true);
  assert.equal(formWouldEraseSavedLoans([{ outstanding: '2500000' }], [{ outstanding: '' }], true), false);
  assert.equal(formWouldEraseSavedLoans([{ outstanding: '2500000' }], [{ outstanding: '2500000' }], false), false);
  assert.match(g, /overwrite\.current = true; setConflict\(false\); void latestSave\.current\(\);/);
  assert.match(g, /window\.location\.reload\(\)/);
  const p = src('app/profile/ProfileClient.tsx');
  const save = p.slice(p.indexOf('async function save() {'));
  // The check is the first thing save() does, before anything is written.
  assert.match(save.slice(0, 300), /if \(pendingCountry \|\| tabGuard\.blocks\(\)\) return;/);
  assert.ok(save.indexOf('tabGuard.blocks()') < save.indexOf('saveProfileWithPaidEmis('));
  assert.match(p, /\{tabGuard\.ui\}\n\s*\{saveBlocked && \(/);
});

test('#23 two tabs: every kept save stamps localStorage, other tabs show a banner, sign-out clears the stamp', () => {
  const us = src('lib/user-store.ts');
  const fn = us.slice(us.indexOf('export function saveProfileClient('), us.indexOf('async function syncProfileToServer('));
  const stamp = fn.indexOf('localStorage.setItem(PROFILE_SAVED_KEY');
  assert.ok(stamp > 0 && stamp > fn.indexOf('return false;'), 'stamped only after the save was kept');
  assert.match(us, /export const PROFILE_SAVED_KEY = 'rightdue_profile_saved_at';/);
  // A per-save tag, so two saves in one millisecond (or a stopped clock) still change the value.
  assert.match(fn, /toISOString\(\)\}#\$\{Math\.random\(\)/);
  assert.match(src('lib/tab-guard.tsx'), /new Date\(at\.split\('#'\)\[0\]\)/);
  const g = src('lib/tab-guard.tsx');
  assert.match(g, /e\.key === PROFILE_SAVED_KEY && e\.newValue/);
  // Fallback for a background tab that missed the event, never for this tab's own save.
  assert.match(g, /addEventListener\('visibilitychange', back\)/);
  assert.match(g, /addEventListener\('rightdue:profile-changed', own\)/);
  assert.match(g, /Your profile was changed in another tab/);
  assert.match(src('app/layout.tsx'), /<OtherTabSavedNotice \/>/);
  const sync = src('lib/server-sync.ts');
  const per = sync.slice(sync.indexOf('LOCAL_PER_USER_KEYS = ['), sync.indexOf('] as const;', sync.indexOf('LOCAL_PER_USER_KEYS = [')));
  assert.ok(per.includes("'rightdue_profile_saved_at'"));
});
