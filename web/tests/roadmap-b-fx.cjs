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

// PR B (roadmap 2026-10-07): exchange rates stay current, dated, and never 1:1.
const NOW = Date.parse('2026-10-07T04:30:00Z');
const H = 3600 * 1000;
const user = (extra = {}) => ({ country: 'US', loans: [{ id: 'h', loan_type: 'home_loan', outstanding: '2000000', currency: 'INR' }, { id: 'p', loan_type: 'personal_loan', outstanding: '25000' }], fx_to_user_currency: { INR: '0.0104' }, ...extra });

test('a rate older than 24 h (or undated, or missing) is due; a fresh or typed one is not', () => {
  const { fxDueForRefresh } = lib('fx-refresh.ts');
  assert.deepEqual(fxDueForRefresh(user(), NOW), ['INR']);
  assert.deepEqual(fxDueForRefresh(user({ fx_meta: { INR: { as_of: '2026-10-06', fetched_at: new Date(NOW - 2 * H).toISOString(), source: 'frankfurter' } } }), NOW), []);
  assert.deepEqual(fxDueForRefresh(user({ fx_meta: { INR: { as_of: '2026-10-05', fetched_at: new Date(NOW - 25 * H).toISOString(), source: 'frankfurter' } } }), NOW), ['INR']);
  assert.deepEqual(fxDueForRefresh(user({ fx_meta: { INR: { as_of: '2026-09-01', fetched_at: '2026-09-01T00:00:00Z', source: 'manual', manual: true } } }), NOW), []);
  assert.deepEqual(fxDueForRefresh(user({ fx_to_user_currency: {} }), NOW), ['INR']);
});

test('refresh stores the rate with its as-of date; a failed or parity answer keeps the last rate', async () => {
  const { refreshFxRates, ensureFxRates } = lib('fx-refresh.ts');
  const ok = await ensureFxRates(user(), async () => ({ rate: '0.01037', source: 'frankfurter', as_of: '2026-10-06' }), NOW);
  assert.equal(ok.user.fx_to_user_currency.INR, '0.01037');
  assert.deepEqual(ok.user.fx_meta.INR, { as_of: '2026-10-06', fetched_at: new Date(NOW).toISOString(), source: 'frankfurter' });
  for (const bad of [async () => { throw Error('502'); }, async () => ({ rate: '1', source: 'fallback' }), async () => ({ rate: '1', source: 'parity' }), async () => ({ rate: '0', source: 'open-er-api' }), async () => ({ rate: '1', source: 'frankfurter' })]) {
    const r = await refreshFxRates(user(), bad, NOW, ['INR']);
    assert.equal(r.user.fx_to_user_currency.INR, '0.0104');
    assert.deepEqual(r.failed, ['INR']);
  }
  // No rate at all and the provider is down: still no rate (the plan asks for one), never 1.
  const none = await refreshFxRates(user({ fx_to_user_currency: {} }), async () => { throw Error('down'); }, NOW);
  assert.equal(none.user.fx_to_user_currency.INR, undefined);
});

test('Profile dates each rate: kept, fetched, or typed (typed rates are not auto-refreshed)', () => {
  const { dateProfileRates, fxAsOfLabel, fxIsStale } = lib('fx-refresh.ts');
  const prevMeta = { as_of: '2026-10-01', fetched_at: '2026-10-01T05:00:00Z', source: 'frankfurter' };
  const prev = user({ fx_meta: { INR: prevMeta } });
  assert.deepEqual(dateProfileRates(user(), prev, {}, NOW).fx_meta.INR, prevMeta);
  assert.equal(dateProfileRates(user({ fx_to_user_currency: { INR: '0.0105' } }), prev, { INR: { rate: '0.0105', source: 'frankfurter', as_of: '2026-10-06' } }, NOW).fx_meta.INR.as_of, '2026-10-06');
  const typed = dateProfileRates(user({ fx_to_user_currency: { INR: '0.0110' } }), prev, {}, NOW).fx_meta.INR;
  assert.equal(typed.manual, true); assert.equal(typed.source, 'manual');
  assert.equal(fxAsOfLabel(prevMeta), 'as of 1 Oct 2026 · ECB via Frankfurter');
  assert.match(fxAsOfLabel(undefined), /date unknown/);
  assert.ok(fxIsStale(prevMeta, NOW + 8 * 24 * H)); assert.ok(!fxIsStale(prevMeta, Date.parse('2026-10-02T00:00:00Z')));
});

test('wired: app open refreshes, Home shows the dated rate with a Refresh button', () => {
  assert.match(src('app/layout.tsx'), /<FxAutoRefresh \/>/);
  assert.doesNotMatch(src('lib/currency.ts'), /export async function ensureFxRates/);
  const { FxRateLine } = require(path.join(root, 'components/fx/FxRateLine.tsx'));
  const html = renderToStaticMarkup(React.createElement(FxRateLine, { user: user({ fx_meta: { INR: { as_of: '2026-10-06', fetched_at: new Date(NOW - H).toISOString(), source: 'frankfurter' } } }), nowMs: NOW }));
  assert.match(html, /1 INR = 0\.01040 USD · as of 6 Oct 2026 · ECB via Frankfurter/);
  assert.match(html, /REFRESH RATE/);
  assert.match(renderToStaticMarkup(React.createElement(FxRateLine, { user: user(), nowMs: NOW })), /may be out of date/);
});

test('Profile save dates its rates, so a typed rate is not overwritten by the next app-open refresh', () => {
  // Before: Profile saved the new rate under the old fx_meta (or none), so a
  // rate typed in Profile looked >24 h old and FxAutoRefresh replaced it.
  const profile = profileSource();
  assert.match(profile, /import \{ dateProfileRates \} from '@\/lib\/fx-refresh'/);
  assert.match(profile, /const userWithFx = dateProfileRates\(/);
  const { dateProfileRates, fxDueForRefresh } = lib('fx-refresh.ts');
  const old = { as_of: '2026-09-01', fetched_at: 'Tue 2026-09-01 5:30 AM IST (UTC+05:30)', source: 'frankfurter' };
  const saved = dateProfileRates(user({ fx_to_user_currency: { INR: '0.0111' } }), user({ fx_meta: { INR: old } }), {}, NOW);
  assert.deepEqual(fxDueForRefresh(saved, NOW + 48 * H), []);
});
