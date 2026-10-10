// Where to find each figure: KFS, statement, disclosures (X5).
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
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, file) => {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  module._compile(output, file);
};
const w = require(path.join(root, 'lib', 'where-to-find.ts'));

const LOAN_KEYS = ['balance', 'rate', 'rateType', 'emi', 'monthsLeft', 'prepayFee', 'processingFee', 'insurance'];
const CARD_KEYS = ['balance', 'rate', 'statementDay', 'dueDay', 'cardMinimum'];

test('every loan figure the forms ask for names a paper in both countries', () => {
  for (const country of ['IN', 'US']) {
    for (const loanType of ['home_loan', 'personal_loan', 'auto_loan']) {
      for (const key of LOAN_KEYS) assert.ok(w.whereToFind(key, { country, loanType }), `${country} ${loanType} ${key}`);
    }
    for (const key of CARD_KEYS) assert.ok(w.whereToFind(key, { country, loanType: 'credit_card' }), `${country} card ${key}`);
    for (const key of ['creditScore', 'takeHome', 'taxRate', 'offerFee', 'offerRate', 'taxableIncome', 'purchasePrice']) {
      assert.ok(w.whereToFind(key, { country }), `${country} ${key}`);
    }
  }
});

test('Indian loans point at the KFS, US loans at US disclosures, never the other way', () => {
  assert.match(w.whereToFind('prepayFee', { country: 'IN', loanType: 'home_loan' }), /KFS/);
  assert.match(w.whereToFind('rateBasis', { country: 'IN', loanType: 'home_loan' }), /KFS/);
  assert.match(w.whereToFind('prepayFee', { country: 'US', loanType: 'home_loan' }), /Closing Disclosure/);
  for (const key of LOAN_KEYS) {
    assert.doesNotMatch(w.whereToFind(key, { country: 'US', loanType: 'home_loan' }), /KFS|Form 16|ITR/);
    assert.doesNotMatch(w.whereToFind(key, { country: 'IN', loanType: 'home_loan' }), /Closing Disclosure|Truth in Lending|1040/);
  }
});

test('a card is read off the card statement, not a KFS', () => {
  for (const country of ['IN', 'US']) {
    for (const key of CARD_KEYS) assert.match(w.whereToFind(key, { country, loanType: 'credit_card' }), /card statement|MITC/);
  }
  // A monthly card rate has to be turned into a yearly one.
  assert.match(w.whereToFind('rate', { country: 'IN', loanType: 'credit_card' }), /× 12/);
});

test('loan forms show where to find each figure', () => {
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const profile = read('app/profile/ProfileClient.tsx');
  for (const key of ['balance', 'rate', 'rateType', 'emi', 'prepayFee', 'lockIn', 'dueDay']) {
    assert.ok(profile.includes(`findFor(l, country, '${key}')`), `Profile ${key}`);
  }
  const setup = read('components/setup/QuickSetup.tsx');
  for (const key of ['balance', 'rate', 'emi', 'monthsLeft']) assert.ok(setup.includes(`find('${key}')`), `Setup ${key}`);
  // A rupee loan held from the US still reads off Indian papers.
  assert.match(profile, /loanMarket\(l, country\)/);
  assert.match(read('components/ToolPrimitives.tsx'), /Find it: \{text\}/);
});
