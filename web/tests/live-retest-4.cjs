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

// Live re-test 3, 13 Oct 2026 (LIVE-RETEST-3-2026-10-13.md).

// Live re-test 4, 13 Oct 2026 (LIVE-RETEST-4-2026-10-13.md).

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setImmediate(r));

test('NEW-19: identical in-flight requests are sent once and shared', async () => {
  const { createSharedRequests } = lib('engine-requests.ts');
  const shared = createSharedRequests();
  const sent = [];
  const d = deferred();
  const fetcher = (signal) => { sent.push(signal); return d.promise; };
  const a = shared.run('simulate', { user: { a: 1, b: 2 }, strategy: 'avalanche' }, fetcher);
  // Same body, keys in another order: joins.
  const b = shared.run('simulate', { strategy: 'avalanche', user: { b: 2, a: 1 } }, fetcher);
  await tick();
  assert.equal(sent.length, 1);
  d.resolve({ ok: 1 });
  assert.deepEqual(await a, { ok: 1 });
  assert.deepEqual(await b, { ok: 1 });
  assert.equal(shared.stats.sent, 1);
  assert.equal(shared.stats.joined, 1);
});

test('NEW-19: an unchanged baseline is answered from memory, not re-sent', async () => {
  const { createSharedRequests } = lib('engine-requests.ts');
  let t = 0;
  const shared = createSharedRequests({ ttlMs: 60_000, now: () => t });
  let calls = 0;
  const fetcher = async () => ({ n: ++calls });
  const body = { user: { loans: [1] }, horizon_months: 1200 };
  assert.deepEqual(await shared.run('baseline', body, fetcher), { n: 1 });
  // Three strategy clicks later: the same baseline body.
  for (let i = 0; i < 3; i++) assert.deepEqual(await shared.run('baseline', { ...body }, fetcher), { n: 1 });
  assert.equal(calls, 1);
  // Another operation or body is a different request.
  await shared.run('simulate', body, fetcher);
  await shared.run('baseline', { ...body, horizon_months: 600 }, fetcher);
  assert.equal(calls, 3);
  // Memory expires.
  t = 61_000;
  await shared.run('baseline', body, fetcher);
  assert.equal(calls, 4);
});

test('NEW-19: memory is bounded, newest kept', async () => {
  const { createSharedRequests } = lib('engine-requests.ts');
  const shared = createSharedRequests({ limit: 3 });
  let calls = 0;
  const fetcher = async () => ++calls;
  for (let i = 0; i < 5; i++) await shared.run('simulate', { i }, fetcher);
  assert.equal(calls, 5);
  await shared.run('simulate', { i: 4 }, fetcher);
  assert.equal(calls, 5);
  await shared.run('simulate', { i: 0 }, fetcher);
  assert.equal(calls, 6);
});

test('NEW-19: a stale response never overwrites a newer one, and its fetch is aborted', async () => {
  const { createSharedRequests, isAbortError } = lib('engine-requests.ts');
  const shared = createSharedRequests();
  const fetches = {};
  const fetcherFor = (k) => (signal) => { fetches[k] = { signal, ...deferred() }; return fetches[k].promise; };
  let shown = null;
  const first = new AbortController();
  const p1 = shared.run('simulate', { strategy: 'snowball' }, fetcherFor('snowball'), first.signal)
    .then((v) => { shown = v; }, (e) => { if (!isAbortError(e)) throw e; return 'aborted'; });
  await tick();
  // A newer choice replaces it (the effect's cleanup aborts the old controller).
  first.abort();
  const second = new AbortController();
  const p2 = shared.run('simulate', { strategy: 'avalanche' }, fetcherFor('avalanche'), second.signal).then((v) => { shown = v; });
  await tick();
  assert.equal(fetches.snowball.signal.aborted, true, 'the replaced fetch is cancelled');
  fetches.avalanche.resolve('avalanche plan');
  await p2;
  // The old answer lands late: it must not replace the shown one.
  fetches.snowball.resolve('snowball plan');
  assert.equal(await p1, 'aborted');
  assert.equal(shown, 'avalanche plan');
  // An aborted run is not remembered.
  let again = 0;
  await shared.run('simulate', { strategy: 'snowball' }, async () => { again++; return 'x'; });
  assert.equal(again, 1);
});

test('NEW-19: a shared fetch is aborted only when every caller has gone', async () => {
  const { createSharedRequests, isAbortError } = lib('engine-requests.ts');
  const shared = createSharedRequests();
  let sig;
  const d = deferred();
  const fetcher = (s) => { sig = s; return d.promise; };
  const a = new AbortController();
  const b = new AbortController();
  const pa = shared.run('compare', { x: 1 }, fetcher, a.signal).catch((e) => (isAbortError(e) ? 'aborted' : Promise.reject(e)));
  const pb = shared.run('compare', { x: 1 }, fetcher, b.signal);
  await tick();
  a.abort();
  assert.equal(sig.aborted, false, 'b still waits');
  d.resolve('answer');
  assert.equal(await pa, 'aborted');
  assert.equal(await pb, 'answer');
  // Already-aborted signal: rejected at once, nothing sent.
  const c = new AbortController(); c.abort();
  let sent = 0;
  await assert.rejects(shared.run('compare', { y: 1 }, async () => { sent++; }, c.signal), (e) => isAbortError(e));
  assert.equal(sent, 0);
});

test('NEW-19: rapid choice clicks settle into one request pair (debounced effect)', async () => {
  // The Setup step 3 effect, run as React would on four quick choice
  // changes: each change cleans up the previous effect.
  const { createSharedRequests, PREVIEW_DEBOUNCE_MS, isAbortError } = lib('engine-requests.ts');
  assert.ok(PREVIEW_DEBOUNCE_MS >= 300 && PREVIEW_DEBOUNCE_MS <= 400);
  const shared = createSharedRequests();
  const sent = [];
  let shown = null;
  const effect = (strategy) => {
    let live = true;
    const controller = new AbortController();
    const user = { loans: [{ outstanding: '100000' }] };
    const sim = { user, strategy };
    const base = { user, horizon_months: 1200 };
    const timer = setTimeout(() => {
      Promise.all([
        shared.run('simulate', sim, async (s) => { sent.push(['simulate', strategy]); await new Promise((r) => setTimeout(r, 20)); if (s.aborted) throw Object.assign(new Error('a'), { name: 'AbortError' }); return strategy; }, controller.signal),
        shared.run('baseline', base, async () => { sent.push(['baseline']); return 'minimums'; }, controller.signal),
      ]).then(([plan]) => live && (shown = plan)).catch((e) => { if (!isAbortError(e)) throw e; });
    }, PREVIEW_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  };
  let cleanup = effect('avalanche');
  for (const s of ['snowball', 'hybrid', 'avalanche']) {
    await new Promise((r) => setTimeout(r, 60));
    cleanup(); cleanup = effect(s);
  }
  await new Promise((r) => setTimeout(r, PREVIEW_DEBOUNCE_MS + 80));
  assert.deepEqual(sent, [['simulate', 'avalanche'], ['baseline']]);
  assert.equal(shown, 'avalanche');
  // A later strategy change re-runs the plan only; the baseline is remembered.
  cleanup(); cleanup = effect('snowball');
  await new Promise((r) => setTimeout(r, PREVIEW_DEBOUNCE_MS + 80));
  assert.deepEqual(sent.slice(2), [['simulate', 'snowball']]);
  assert.equal(shown, 'snowball');
  cleanup();
});

test('NEW-19: Setup, the Plan what-ifs and the tenure what-if debounce, cancel and share their runs', () => {
  const setup = src('components/setup/QuickSetup.tsx');
  assert.match(setup, /setTimeout\([\s\S]*PREVIEW_DEBOUNCE_MS\)/);
  assert.match(setup, /controller\.abort\(\)/);
  assert.match(setup, /engineRequests\.run\('simulate'/);
  assert.match(setup, /engineRequests\.run\('baseline'/);
  const whatif = src('components/WhatIfPanel.tsx');
  assert.match(whatif, /controller\.abort\(\)/);
  assert.match(whatif, /engineRequests\.run\('compare'/);
  assert.doesNotMatch(whatif, /await api\.sensitivity\(/);
  const tenure = src('components/plan/TenureWhatIf.tsx');
  assert.match(tenure, /controller\.abort\(\)/);
  assert.match(tenure, /engineRequests\.run\('compare'/);
  // The API client passes the signal and never retries an abort.
  const api = src('lib/api.ts');
  assert.match(api, /simulate: \(req: SimulateArgs, opts\?: RequestOptions\)/);
  assert.match(api, /name === 'AbortError' \|\| init\.signal\?\.aborted\) throw e/);
});

test('R4-1: Invest or prepay names the field that stops the answer', () => {
  const { ivpAnswerNote } = lib('ivp-answer-note.ts');
  const f = (over = {}) => [
    { name: 'the loan’s rate', text: '14', error: null },
    { name: 'your tax rate', text: '15.6', error: null },
    { name: 'today’s rate', text: '7', error: null, ...(over.ret ?? {}) },
    { name: 'how much it swings', text: '16', error: null, shown: true, ...(over.vol ?? {}) },
  ];
  const ret = ivpAnswerNote(f({ ret: { text: 'abc', error: '“abc” isn’t a valid rate.' } }));
  assert.equal(ret, 'Fix today’s rate to see the answer.');
  assert.doesNotMatch(ret, /loan|tax/);
  assert.equal(ivpAnswerNote(f({ vol: { text: '600', error: 'A swing above 500%…' } })), 'Fix how much it swings to see the answer.');
  assert.equal(
    ivpAnswerNote(f({ ret: { text: '500', error: 'x' }, vol: { text: 'abc', error: 'y' } })),
    'Fix today’s rate and how much it swings to see the answer.',
  );
  // A hidden swing field is never named.
  assert.equal(ivpAnswerNote(f({ vol: { text: 'abc', error: 'y', shown: false }, ret: { text: '' } })), 'Enter today’s rate to see the answer.');
  const blank = f();
  blank[0].text = ''; blank[1].text = ' ';
  assert.equal(ivpAnswerNote(blank), 'Enter the loan’s rate and your tax rate to see the answer.');
  const tool = src('app/tools/invest-vs-prepay/tool.tsx');
  assert.doesNotMatch(tool, /Enter the loan&apos;s rate and your tax rate to see the answer/);
  assert.match(tool, /\{answerNote\}/);
});
