const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, f);
const root = path.resolve(__dirname, '../src'), resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) + '.ts' : request, parent, ...rest);
};
const { NextRequest } = require('next/server');
const { POST } = require('../src/app/api/session/[...path]/route.ts');
const { authErrorMessage } = require('../src/lib/auth-error.ts');
const context = { params: Promise.resolve({ path: ['auth', 'request-otp'] }) };
const request = () => new NextRequest('https://rightdue.app/api/session/auth/request-otp', {
  method: 'POST', headers: { origin: 'https://rightdue.app', 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'delivered@resend.dev' }),
});

test('a hosting wake-up 429 retries only health reads, then sends one OTP request', async () => {
  const previous = global.fetch, calls = [];
  global.fetch = async (url, options) => {
    calls.push({url, options});
    if (url.endsWith('/api/health')) {
      return calls.length === 1 ? new Response('Too Many Requests\\n', { status: 429 }) : Response.json({ status: 'ok' });
    }
    return new Response(null, { status: 204 });
  };
  try {
    assert.equal((await POST(request(), context)).status, 204);
    assert.equal(calls.length, 3);
    assert.equal(calls.filter(c => c.options.method === 'POST').length, 1);
    assert.equal(calls[2].options.body, JSON.stringify({email: 'delivered@resend.dev'}));
    assert.ok(calls.every(c => c.options.signal instanceof AbortSignal));
    assert.ok(calls.every(c => !c.options.headers?.get('X-Internal-Token')));
  } finally { global.fetch = previous; }
});

test('a startup HTML page never triggers an email mutation; failure explains the delay', async () => {
  const previous = global.fetch; let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    assert.ok(url.endsWith('/api/health'));
    assert.notEqual(options.method, 'POST');
    return new Response('<html>Starting</html>', { headers: {'content-type': 'text/html'} });
  };
  try {
    const response = await POST(request(), context);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '30');
    assert.equal(calls, 5);
    assert.match(authErrorMessage(response.status, await response.text(), '30'), /waking up/);
  } finally { global.fetch = previous; }
});

test('genuine application rate limits pass through without retrying the OTP', async () => {
  const previous = global.fetch; let mutations = 0;
  global.fetch = async (url, options) => {
    if (url.endsWith('/api/health')) return Response.json({status: 'ok'});
    mutations++;
    return Response.json({detail: 'Too many codes requested.'}, {status: 429, headers: {'Retry-After':'600'}});
  };
  try {
    const response = await POST(request(), context);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '600');
    assert.equal(mutations, 1);
  } finally { global.fetch = previous; }
});
