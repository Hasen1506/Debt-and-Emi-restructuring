const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const test = require('node:test');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, f);
const { NextRequest } = require('next/server');
const { GET } = require('../src/app/api/holdings/quote/route.ts');

test('malformed upstream prices and missing currencies cannot become portfolio valuations', async () => {
  const original = global.fetch;
  try {
    for (const meta of [
      { regularMarketPrice: -1, currency: 'INR' },
      { regularMarketPrice: '100', currency: 'INR' },
      { regularMarketPrice: 100 },
    ]) {
      global.fetch = async () => Response.json({ chart: { result: [{ meta }] } });
      assert.equal((await GET(new NextRequest('https://web.example/api/holdings/quote?ticker=TEST.NS'))).status, 502);
    }
    global.fetch = async () => new Response('{"chart":{"result":[{"meta":{"regularMarketPrice":1e10000,"currency":"INR"}}]}}');
    assert.equal((await GET(new NextRequest('https://web.example/api/holdings/quote?ticker=TEST.NS'))).status, 502);
  } finally { global.fetch = original; }
});

test('quotes use a bounded upstream timeout and preserve pence currency identifiers', async () => {
  const original = global.fetch;
  try {
    global.fetch = async (url, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json({ chart: { result: [{ meta: { regularMarketPrice: 100, currency: 'GBp' } }] } });
    };
    const response = await GET(new NextRequest('https://web.example/api/holdings/quote?ticker=TEST.L'));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).currency, 'GBp');
  } finally { global.fetch = original; }
});

// UX50 E-20: the quote route keeps its own per-visitor limit.
test('quotes are rate-limited per visitor (30 a minute) and keyed on the edge header on Render', async () => {
  const route = require('../src/app/api/holdings/quote/route.ts');
  const original = global.fetch;
  const env = { ...process.env };
  try {
    process.env.RENDER = 'true';
    route.quoteLimiter.reset();
    global.fetch = async () => Response.json({ chart: { result: [{ meta: { regularMarketPrice: 1, currency: 'INR' } }] } });
    const ask = (ip, xff) => route.GET(new NextRequest('https://web.example/api/holdings/quote?ticker=TEST.NS', {
      headers: { 'cf-connecting-ip': ip, 'x-forwarded-for': `${xff}, ${ip}, 172.71.1.${Math.floor(Math.random() * 250)}, 10.0.0.1` },
    }));
    const codes = [];
    for (let i = 0; i < 31; i++) codes.push((await ask('203.0.113.9', `9.9.9.${i}`)).status);
    assert.equal(codes.filter((c) => c === 200).length, 30);
    const last = await ask('203.0.113.9', '1.1.1.1');
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get('retry-after')) >= 1);
    assert.equal((await ask('203.0.113.10', '1.1.1.1')).status, 200, 'another visitor is not blocked');
  } finally {
    global.fetch = original;
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
    route.quoteLimiter.reset();
  }
});

test('client-ip helper matches api/client_ip.py', () => {
  const { clientIp, normaliseIp, trustedHeader } = require('../src/lib/client-ip.ts');
  const h = (o) => new Headers(o);
  const chain = '203.0.113.5, 172.71.4.4, 10.226.1.65';
  assert.equal(clientIp(h({ 'x-forwarded-for': chain }), { TRUSTED_PROXY_HOPS: '3' }), '203.0.113.5');
  assert.equal(clientIp(h({ 'x-forwarded-for': chain }), { TRUSTED_PROXY_HOPS: '2' }), '172.71.4.4');
  assert.equal(clientIp(h({ 'x-forwarded-for': chain, 'cf-connecting-ip': '198.51.100.1' }), { RENDER: 'true', TRUSTED_PROXY_HOPS: '2' }), '198.51.100.1');
  assert.equal(clientIp(h({ 'cf-connecting-ip': '1.1.1.1, 2.2.2.2', 'x-forwarded-for': chain }), { RENDER: 'true', TRUSTED_PROXY_HOPS: '3' }), '203.0.113.5');
  assert.equal(clientIp(h({}), {}), 'local');
  assert.equal(normaliseIp('2001:db8:1:2::7'), '2001:db8:1:2::/64');
  assert.equal(normaliseIp('::ffff:203.0.113.5'), '203.0.113.5');
  assert.equal(normaliseIp('nope'), null);
  assert.equal(trustedHeader({ RENDER: '1', CLIENT_IP_HEADER: 'none' }), null);
});
