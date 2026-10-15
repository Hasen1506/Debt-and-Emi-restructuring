// Round 2 (15 Oct 2026): the US letters page behind welcome.html's
// "Federal, state and card rules for the USA" (/cant-pay/us-letters).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const test = require('node:test');

const web = path.resolve(__dirname, '..');
const src = path.join(web, 'src');
const repo = path.resolve(web, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  return resolve.call(this, request.startsWith('@/') ? path.join(src, request.slice(2)) : request, parent, ...rest);
};
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, f);
}
const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8');
const L = require(path.join(src, 'lib/us-letters.ts'));

test('every placeholder token matches engine/complaints_us.py exactly (no silent drift)', () => {
  const py = read('engine/complaints_us.py');
  const engine = {};
  for (const m of py.matchAll(/^([A-Z_]+) = (["'])(\[.*\])\2$/gm)) engine[m[1]] = m[3];
  const map = { name: 'NAME', account: 'ACCOUNT', address: 'ADDRESS', issuer: 'ISSUER', servicer: 'SERVICER', errorAddress: 'ERROR_ADDRESS',
    noeAddress: 'NOE_ADDRESS', statementDate: 'STATEMENT_DATE', txnDate: 'TXN_DATE', amount: 'AMOUNT', description: 'DESCRIPTION', why: 'WHY', loanError: 'LOAN_ERROR' };
  for (const [k, py] of Object.entries(map)) assert.equal(L.US_TOKENS[k], engine[py], `${k} ↔ ${py}`);
  // and every bracket constant in the engine is known here
  assert.deepEqual(Object.keys(engine).sort(), Object.values(map).sort());
});

test('fillUsLetter replaces every token it has a value for, keeps brackets for blanks, handles the nested [date]', () => {
  const text = Object.values(L.US_TOKENS).join('\n');
  const all = Object.fromEntries(Object.keys(L.US_TOKENS).map((k) => [k, `v-${k}`]));
  const filled = L.fillUsLetter(text, all);
  assert.doesNotMatch(filled, /\[/, filled);
  for (const k of Object.keys(L.US_TOKENS)) assert.match(filled, new RegExp(`v-${k}`));
  // Blank or whitespace: the bracket stays so the gap shows.
  assert.equal(L.fillUsLetter('Dear [Card issuer], I am [Full name].', { issuer: '  ', name: 'Asha Rao' }), 'Dear [Card issuer], I am Asha Rao.');
  // A value that itself contains a token is not filled again (one pass per token, longest first).
  assert.equal(L.fillUsLetter('[The error: e.g. payment not credited on [date], wrong escrow charge, late fee charged in error]', { loanError: 'Payment of 1 Oct not credited' }), 'Payment of 1 Oct not credited');
});

test('usMissing names the fields a letter cannot go without, per kind', () => {
  assert.deepEqual(L.usMissing('respa_notice_of_error', {}), ['your full name', 'mortgage loan number', 'mortgage servicer', 'the error']);
  assert.deepEqual(L.usMissing('fcba_billing_error', { name: 'A', account: '1', issuer: 'Chase', errorAddress: 'PO Box 1', amount: '40', why: 'not authorised' }), []);
  for (const kind of ['fcba_billing_error', 'respa_notice_of_error']) {
    const keys = L.US_FIELDS[kind].map((f) => f.key);
    assert.equal(new Set(keys).size, keys.length, `${kind}: duplicate field`);
    for (const k of keys) assert.ok(k in L.US_TOKENS, `${kind}: ${k} has no token`);
  }
});

test('reachable: More → Help for US users only, and from Can’t pay (USA); public and robots-disallowed', () => {
  const { moreGroups, sectionFromPath } = require(path.join(src, 'lib/app-nav.ts'));
  const help = (c) => moreGroups({ country: c }).find((g) => g.title === 'Help').links.map((l) => l.href);
  assert.ok(help('US').includes('/cant-pay/us-letters'));
  assert.ok(!help('IN').includes('/cant-pay/us-letters'));
  assert.equal(sectionFromPath('/cant-pay/us-letters'), 'more');
  for (const f of ['components/distress/CantPay.tsx', 'components/distress/CantPayPublic.tsx']) {
    assert.match(fs.readFileSync(path.join(src, f), 'utf8'), /<UsLettersLink \/>/, f);
  }
  assert.match(fs.readFileSync(path.join(src, 'middleware.ts'), 'utf8'), /pathname\.startsWith\('\/cant-pay\/'\)/);
  assert.match(fs.readFileSync(path.join(src, 'app/robots.ts'), 'utf8'), /'\/cant-pay'/);
  assert.ok(fs.existsSync(path.join(src, 'app/cant-pay/us-letters/page.tsx')));
});

test('the page offers all three letters, calls /api/complaints/us for FCBA + RESPA, and welcome.html keeps the US line', () => {
  const page = fs.readFileSync(path.join(src, 'components/distress/UsLetters.tsx'), 'utf8');
  for (const k of ['hardship', 'fcba_billing_error', 'respa_notice_of_error']) assert.match(page, new RegExp(`'${k}'`));
  assert.match(page, /api\.complaintUs\(/);
  assert.match(fs.readFileSync(path.join(src, 'lib/api.ts'), 'utf8'), /'\/api\/complaints\/us'/);
  assert.match(page, /US_COLLECTOR_RULE/);
  assert.match(read('web/public/welcome.html'), /Federal, state and card rules for the USA/);
});
