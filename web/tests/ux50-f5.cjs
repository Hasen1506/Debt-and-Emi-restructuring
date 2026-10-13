// UX50 F5 (critique E): security, ops, legal, launch readiness.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const test = require('node:test');
const root = path.resolve(__dirname, '../src');
const repo = path.resolve(__dirname, '../..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, ...rest);
};
for (const ext of ['.ts', '.tsx'])
  require.extensions[ext] = (module, file) => {
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    module._compile(output, file);
  };
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const { NextRequest } = require('next/server');

test('E-22: signed-out /api/session/auth/me answers 200 null without calling the API', async () => {
  const { GET } = require(path.join(root, 'app/api/session/[...path]/route.ts'));
  const original = global.fetch;
  let called = 0;
  global.fetch = async () => { called += 1; return new Response('{}', { status: 401 }); };
  try {
    const res = await GET(new NextRequest('https://rightdue.app/api/session/auth/me'), { params: Promise.resolve({ path: ['auth', 'me'] }) });
    assert.equal(res.status, 200);
    assert.equal(await res.json(), null);
    assert.equal(called, 0);
  } finally { global.fetch = original; }
});

test('E-22: api.me reads null as signed out and shares one request between callers', () => {
  const s = src('lib/api.ts');
  assert.match(s, /if \(!user\) throw new ApiStatusError\('\/api\/auth\/me → 401', 401/);
  assert.match(s, /meInFlight/);
});

test('E-01: the session proxy copies the edge client-IP header to the API', () => {
  const s = src('app/api/session/[...path]/route.ts');
  assert.match(s, /process\.env\.RENDER \? 'cf-connecting-ip'/);
  assert.match(s, /headers\.set\(clientIpHeader, value\)/);
});

test('E-06/E-07: every page has a footer with the disclaimer, privacy, terms and a figure-free report link', () => {
  const layout = src('app/layout.tsx');
  assert.match(layout, /<SiteFooter /);
  const footer = src('components/site/SiteFooter.tsx');
  assert.match(footer, /estimates from the numbers you enter, not financial, tax or legal advice/);
  assert.match(footer, /href="\/privacy"/);
  assert.match(footer, /href="\/terms"/);
  assert.match(footer, /Report a problem/);
  assert.match(footer, /@media print\{\.rd-site-footer\{display:none/);
  const { reportProblemHref } = require(path.join(root, 'lib/report-problem.ts'));
  const href = reportProblemHref('/tools/loan-check?amount=500000&rate=9.5', 'abcdef1234567');
  assert.ok(href.startsWith('mailto:vijeya@rightdue.app?subject='));
  const decoded = decodeURIComponent(href);
  assert.match(decoded, /RightDue problem on \/tools\/loan-check/);
  assert.match(decoded, /version: abcdef1/);
  assert.doesNotMatch(decoded, /500000|9\.5|amount/, 'never carries figures from the query string');
});

test('E-03: browser errors are reported only with a DSN, via our own route, filtered', async () => {
  const { shouldReport } = require(path.join(root, 'lib/client-error.ts'));
  assert.equal(shouldReport('Error', 'GET /api/auth/me 401'), false);
  assert.equal(shouldReport('AbortError', 'aborted'), false);
  assert.equal(shouldReport('TypeError', 'x is undefined'), true);
  const route = require(path.join(root, 'app/api/client-error/route.ts'));
  const saved = process.env.SENTRY_DSN;
  const original = global.fetch;
  const sent = [];
  global.fetch = async (url, init) => { sent.push({ url, body: init.body }); return new Response(null, { status: 200 }); };
  try {
    delete process.env.SENTRY_DSN;
    const body = JSON.stringify({ name: 'TypeError', message: 'bad 123456 thing', path: '/plan?x=1' });
    assert.equal((await route.POST(new NextRequest('https://rightdue.app/api/client-error', { method: 'POST', body }))).status, 204);
    assert.equal(sent.length, 0, 'no DSN: no-op');
    process.env.SENTRY_DSN = 'https://pub@o1.ingest.sentry.io/42';
    assert.equal((await route.POST(new NextRequest('https://rightdue.app/api/client-error', { method: 'POST', body }))).status, 204);
    assert.equal(sent.length, 1);
    assert.match(sent[0].url, /\/api\/42\/envelope\/$/);
    assert.doesNotMatch(sent[0].body, /123456|x=1/, 'digits masked, no query');
    const layout = src('app/layout.tsx');
    assert.match(layout, /<BrowserErrorReporter enabled=\{Boolean\(process\.env\.SENTRY_DSN\)\} \/>/);
  } finally {
    global.fetch = original;
    if (saved === undefined) delete process.env.SENTRY_DSN; else process.env.SENTRY_DSN = saved;
  }
});
