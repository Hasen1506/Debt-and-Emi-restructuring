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
const fresh = (name) => {
  delete require.cache[path.join(root, 'lib', name)];
  return require(path.join(root, 'lib', name));
};
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/** A back/forward-cache restore: pageshow with persisted true (R12-1 fix 2:
 *  the first load's pageshow, persisted false, no longer ends a leave). */
const bfcacheShow = () => Object.defineProperty(new Event('pageshow'), 'persisted', { value: true });

// Live re-test 11 fix round (R11-1, R11-2).

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
/** A fetch-like request that hangs until its signal is aborted. */
const hangs = (signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(abortError()), { once: true }));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// ─── R11-1: abort at once on beforeunload ─────────────────────────────────
test('R11-1: beforeunload aborts the page signal synchronously, before any task runs', () => {
  const win = new EventTarget();
  global.window = win;
  try {
    // Delete page-abort only: api.ts keeps its own reference.
    const { pageSignal } = fresh('page-abort.ts');
    const a = pageSignal();
    let seenInListener = null;
    // A listener added after ours sees the signal already aborted: nothing
    // waits for a later task (WebKit cancels and logs fetches before it).
    win.addEventListener('beforeunload', () => { seenInListener = a.aborted; });
    win.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    assert.equal(a.aborted, true, 'aborted during dispatch');
    assert.equal(seenInListener, true);
    const b = pageSignal();
    assert.notEqual(b, a);
    assert.equal(b.aborted, false, 'later requests get a live signal');
    win.dispatchEvent(new Event('pagehide'));
    assert.equal(b.aborted, true);
  } finally {
    delete global.window;
  }
  // No deferred abort left in the source.
  const s = src('lib/page-abort.ts');
  assert.match(s, /window\.addEventListener\('beforeunload', \(e\) => \{\n\s+abortNow\(\);/);
  assert.doesNotMatch(s, /setTimeout\(\(\) => \{\s*if \(!e\.defaultPrevented\) abortNow\(\);/);
});

test('R11-1: a "leave this page?" prompt that keeps the person here re-issues the cut-off requests', async () => {
  const win = new EventTarget();
  global.window = win;
  try {
    const { pageScoped } = fresh('page-abort.ts');
    // Profile's unsaved-imports guard (ProfileClient.tsx): preventDefault + returnValue ''.
    const warn = (e) => { e.preventDefault(); };
    win.addEventListener('beforeunload', warn);
    const signals = [];
    const p = pageScoped(async (signal) => {
      signals.push(signal);
      if (signals.length === 1) return hangs(signal);
      return 'me';
    }, undefined, 20);
    await tick();
    assert.equal(signals.length, 1);
    const ask = new Event('beforeunload', { cancelable: true });
    win.dispatchEvent(ask); // the prompt shows; the person clicks "Stay"
    assert.equal(ask.defaultPrevented, true);
    assert.equal(signals[0].aborted, true, 'cut off at once');
    assert.equal(await p, 'me', 'asked again after the person stayed');
    assert.equal(signals.length, 2);
    assert.equal(signals[1].aborted, false);
    // The same with a returnValue-only prompt (a string returnValue, as in browsers).
    win.removeEventListener('beforeunload', warn);
    let n = 0;
    const q = pageScoped(async (signal) => (++n === 1 ? hangs(signal) : 'again'), undefined, 20);
    await tick();
    const ev = new Event('beforeunload', { cancelable: true });
    Object.defineProperty(ev, 'returnValue', { value: 'unsaved', writable: true });
    win.dispatchEvent(ev);
    assert.equal(await q, 'again');
    assert.equal(n, 2);
    // auth/me and the rates going through pageScoped: r10-fixes.
  } finally {
    delete global.window;
  }
});

test('R11-1: while an uncancelled leave is under way the re-ask waits (no new cut-off); bfcache restore or the grace ends it', async () => {
  const win = new EventTarget();
  global.window = win;
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const { pageScoped, LEAVE_GRACE_MS } = fresh('page-abort.ts');
    assert.equal(LEAVE_GRACE_MS, 5000);
    let n = 0;
    const p = pageScoped(async (signal) => (++n === 1 ? hangs(signal) : 'later'), undefined, 10);
    await tick();
    win.dispatchEvent(new Event('beforeunload', { cancelable: true })); // nobody prevents it
    await tick(80);
    assert.equal(n, 1, 'not asked again while the next page is loading');
    now += LEAVE_GRACE_MS; // the leave never happened (a download, Stop)
    assert.equal(await p, 'later');
    assert.equal(n, 2);
    // Back from the back/forward cache: asked again after the usual wait.
    let m = 0;
    const q = pageScoped(async (signal) => (++m === 1 ? hangs(signal) : 'back'), undefined, 10);
    await tick();
    win.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    await tick(40);
    assert.equal(m, 1);
    win.dispatchEvent(bfcacheShow());
    assert.equal(await q, 'back');
    assert.equal(m, 2);
    // The caller's own cancel during the wait ends it with an error.
    const own = new AbortController();
    const r = pageScoped(async (signal) => hangs(signal), own.signal, 10);
    await tick();
    win.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    await tick(30);
    own.abort();
    await assert.rejects(r, (e) => e.name === 'AbortError');
  } finally {
    Date.now = realNow;
    delete global.window;
  }
});

// ─── R11-2: one more try for GETs on an edge 502/503/504 or network drop ──
test('R11-2: auth/me and user/state GETs retry once on 502/503/504 and network errors; POST never does', async () => {
  const realFetch = global.fetch;
  const realWindow = global.window;
  const realTimeout = global.setTimeout;
  global.window = new EventTarget();
  const waits = [];
  global.setTimeout = (fn, ms, ...rest) => { waits.push(ms); return realTimeout(fn, 0, ...rest); };
  try {
    fresh('page-abort.ts');
    const { api, GET_RETRY_MS } = fresh('api.ts');
    assert.ok(GET_RETRY_MS > 0 && GET_RETRY_MS <= 1000, 'short backoff');
    const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const urls = [];
    let script = [];
    global.fetch = async (url, init) => {
      urls.push([String(url), init?.method ?? 'GET']);
      const step = script.shift();
      if (step instanceof Error) throw step;
      return step;
    };
    for (const status of [502, 503, 504]) {
      urls.length = 0; waits.length = 0;
      script = [new Response('<html>bad gateway</html>', { status, headers: { 'Content-Type': 'text/html', server: 'cloudflare' } }), ok({ email: 'a@example.com' })];
      assert.deepEqual(await api.me(), { email: 'a@example.com' }, `retried after ${status}`);
      assert.deepEqual(urls.map((u) => u[0]), ['/api/session/auth/me', '/api/session/auth/me']);
      assert.ok(waits.includes(GET_RETRY_MS), 'waited the short backoff');
    }
    // Network drop ("Load failed" / "Failed to fetch").
    urls.length = 0;
    script = [new TypeError('Load failed'), ok({ data: {}, version: 3 })];
    assert.deepEqual(await api.getUserState(), { data: {}, version: 3 });
    assert.equal(urls.length, 2);
    // Only once: a second 502 is the answer (an ApiStatusError the caller handles).
    urls.length = 0;
    script = [new Response('', { status: 502 }), new Response('', { status: 502 })];
    await assert.rejects(api.getUserState(), (e) => e.status === 502);
    assert.equal(urls.length, 2);
    // A 401 or 500 is an answer, not a blip: no retry.
    for (const status of [401, 500]) {
      urls.length = 0;
      script = [new Response('', { status }), ok({})];
      await assert.rejects(api.getUserState(), (e) => e.status === status);
      assert.equal(urls.length, 1, `no retry on ${status}`);
    }
    // A request cut off by its caller isn't retried.
    urls.length = 0;
    const c = new AbortController();
    c.abort();
    script = [abortError(), ok({})];
    await assert.rejects(api.centralRates ? api.centralRates(c.signal) : Promise.reject(abortError()), (e) => e.name === 'AbortError');
    assert.ok(urls.length <= 1);
    // POST (sign-in) never: one call even on a 502.
    urls.length = 0;
    script = [new Response('', { status: 502 }), ok({})];
    await assert.rejects(api.requestOtp('a@example.com'));
    assert.equal(urls.length, 1);
    assert.equal(urls[0][1], 'POST');
    // GETs apiFetch already rides out (4 retries) get no extra tries on top.
    urls.length = 0;
    script = Array.from({ length: 7 }, () => new Response('', { status: 503 }));
    await assert.rejects(api.health());
    assert.equal(urls.length, 5, 'apiFetch’s 5 tries, not 6 or 10');
  } finally {
    global.fetch = realFetch;
    global.window = realWindow;
    global.setTimeout = realTimeout;
  }
  // Server-side (no window): no extra try.
  const realFetch2 = global.fetch;
  try {
    const { api } = fresh('api.ts');
    let calls = 0;
    global.fetch = async () => { calls++; return new Response('', { status: 502 }); };
    await assert.rejects(api.health());
    assert.equal(calls, 1);
  } finally {
    global.fetch = realFetch2;
  }
});

test('R11-2: /_next/static keeps Next’s immutable caching; the Cloudflare cache rule is documented for the founder', () => {
  const cfg = fs.readFileSync(path.join(__dirname, '../next.config.mjs'), 'utf8');
  // Nothing overrides Cache-Control for build files (Next sends
  // "public, max-age=31536000, immutable" for /_next/static by default).
  assert.doesNotMatch(cfg, /_next\/static[^\n]*Cache-Control|Cache-Control[^\n]*_next\/static/i);
  const runbook = fs.readFileSync(path.join(__dirname, '../../docs/RUNBOOK.md'), 'utf8');
  assert.match(runbook, /Cache Rule/);
  assert.match(runbook, /\/_next\/static\//);
  assert.match(runbook, /immutable/);
});
