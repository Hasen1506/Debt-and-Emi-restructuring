// The summary keeps the server-rendered profile when the browser has no
// saved cookie. A measurement that only sends the Cookie header would
// otherwise swap in an empty form after the scripts run.
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
require.extensions['.ts'] = (module, file) => {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  module._compile(output, file);
};
const { summaryProfile } = require(path.join(root, 'lib/user-store.ts'));

const live = { user: { country: 'IN', loans: [{ outstanding: '3500000' }] }, marginalRate: '0.30', creditScore: null, isLive: true };
const guest = { user: { country: 'IN', loans: [] }, marginalRate: '0', creditScore: null, isLive: false };

test('a header-only cookie keeps the server profile', () => {
  global.document = { cookie: '' };
  try {
    assert.equal(summaryProfile(live), live);
    const guestPaint = summaryProfile(guest);
    assert.equal(guestPaint.isLive, false);
    assert.notEqual(guestPaint, guest);
  } finally {
    delete global.document;
  }
});

test('without a document, the server profile is the one painted', () => {
  assert.equal(summaryProfile(live), live);
  assert.equal(summaryProfile(guest), guest);
});
