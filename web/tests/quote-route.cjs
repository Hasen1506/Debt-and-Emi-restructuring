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
