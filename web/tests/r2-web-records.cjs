// Round 2 (15 Oct 2026): founder records, draft-legal markers, contact
// addresses. Guards the CLASS "a legal text ships without its review row /
// marker" and "a personal address leaks back onto a public page".
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
const RECORDS = read('docs/FOUNDER-RECORDS.md');
const sectionA = RECORDS.split(/^## \(a\)/m)[1].split(/^## /m)[0];

test('every legal-review id in the app has a row in FOUNDER-RECORDS (a), and the statuses agree', () => {
  const { LEGAL_REVIEW } = require(path.join(src, 'lib/legal-review.ts'));
  const ids = Object.keys(LEGAL_REVIEW);
  assert.ok(ids.length >= 6);
  for (const id of ids) {
    const rows = sectionA.split('\n').filter((l) => l.includes('`' + id + '`'));
    assert.ok(rows.length > 0, `${id}: no row in docs/FOUNDER-RECORDS.md section (a)`);
    const signed = rows.every((r) => /\|\s*Signed off\s*\|/.test(r));
    assert.equal(LEGAL_REVIEW[id] === 'signed_off', signed, `${id}: app says ${LEGAL_REVIEW[id]}, records say ${signed ? 'Signed off' : 'not signed off'}`);
  }
  // And no review id in the records that the app doesn't know.
  for (const m of sectionA.matchAll(/`((?:letter|privacy|terms)-[a-z0-9-]+)`/g)) assert.ok(m[1] in LEGAL_REVIEW, `${m[1]} is in the records but not in lib/legal-review.ts`);
});

test('section (a) records the two approvals of 15 Oct 2026 and each sign-off item the founder listed', () => {
  for (const want of [/US student loans.*\*\*Approved\*\*.*15 Oct 2026/, /No lender pays us.*\*\*Approved\*\*.*15 Oct 2026/,
    /Chennai forum clause \+ US\$15/, /SEBI exposure/, /NOC/, /ICICI.*₹100/, /Rate-reset letter/, /12 CFR 1006\.6/,
    /Privacy notice changes/, /Terms changes/]) assert.match(sectionA, want);
  for (const row of sectionA.split('\n').filter((l) => /^\| A\d+ \|/.test(l))) {
    assert.match(row, /\| Vijay \|/, `owner missing: ${row.slice(0, 60)}`);
    assert.match(row, /\| (Pending counsel|Verify|\*\*Approved\*\*|Signed off) \|/, `status missing: ${row.slice(0, 60)}`);
    assert.match(row, /\d{1,2} \w{3} 20\d\d/, `date missing: ${row.slice(0, 60)}`);
  }
});

test('section (b) holds the standing decisions; README and RUNBOOK link the records', () => {
  const b = RECORDS.split(/^## \(b\)/m)[1].split(/^## /m)[0];
  for (const w of [/Tenure first/, /3 months of take-home.*editable/, /Cheapest auto-pick/, /Navigation and fonts/, /No prediction-market odds/,
    /Sell to repay stays a calculator/, /NRI tools gated/, /robots-disallowed/]) assert.match(b, w);
  assert.match(read('README.md'), /docs\/FOUNDER-RECORDS\.md/);
  assert.match(read('docs/RUNBOOK.md'), /FOUNDER-RECORDS\.md/);
  assert.match(read('.github/workflows/ci.yml'), /python3 scripts\/check_founder_records\.py/);
});

test('every letter surface and the changed legal sections render the draft marker', () => {
  const uses = {
    'letter-hardship': 'components/distress/CantPay.tsx',
    'letter-recovery-agent': 'components/distress/AgentComplaint.tsx',
    'letter-rate-reset': 'app/tools/loan-check/hike.tsx',
    'letter-us': 'components/distress/UsLetters.tsx',
    'privacy-notice-2026-10-15': 'app/privacy/page.tsx',
    'terms-2026-10-15': 'app/terms/page.tsx',
  };
  for (const [id, file] of Object.entries(uses)) {
    assert.match(fs.readFileSync(path.join(src, file), 'utf8'), new RegExp(`<DraftLegalMarker id="${id}"`), `${file} lacks the ${id} marker`);
  }
  const { DRAFT_MARKER_TEXT, isPendingReview } = require(path.join(src, 'lib/legal-review.ts'));
  assert.equal(DRAFT_MARKER_TEXT, 'Draft — pending legal review');
  assert.equal(isPendingReview('letter-us'), true);
  // The marker is informational: it renders a <p>, never disables anything.
  const marker = fs.readFileSync(path.join(src, 'components/legal/DraftLegalMarker.tsx'), 'utf8');
  assert.doesNotMatch(marker, /\bdisabled[=:{]|pointerEvents|aria-disabled/);
});

test('contact addresses: support@, privacy@ and security@ everywhere; no personal address on a public surface', () => {
  const facts = require(path.join(src, 'lib/privacy-facts.ts'));
  assert.deepEqual({ ...facts.CONTACT_EMAILS }, { support: 'support@rightdue.app', privacy: 'privacy@rightdue.app', security: 'security@rightdue.app' });
  assert.equal(facts.GRIEVANCE_CONTACT.email, 'privacy@rightdue.app');
  const { SUPPORT_EMAIL } = require(path.join(src, 'lib/report-problem.ts'));
  assert.equal(SUPPORT_EMAIL, facts.CONTACT_EMAILS.support);
  const sec = read('web/public/.well-known/security.txt');
  assert.match(sec, /^Contact: mailto:security@rightdue\.app$/m);
  assert.match(read('SECURITY.md'), /security@rightdue\.app/);
  const publicFiles = ['web/public/.well-known/security.txt', 'SECURITY.md', 'web/src/lib/privacy-facts.ts', 'web/src/app/privacy/page.tsx',
    'web/src/app/terms/page.tsx', 'web/public/welcome.html', 'api/privacy_facts.py'];
  for (const f of publicFiles) assert.doesNotMatch(read(f), /vijeya@/i, `${f} still names the personal address`);
  const privacy = fs.readFileSync(path.join(src, 'app/privacy/page.tsx'), 'utf8');
  for (const k of ['privacy', 'support', 'security']) assert.match(privacy, new RegExp(`CONTACT_EMAILS\\.${k}`));
});

test('privacy notice describes the emails, the counts-only funnel and the consent record', () => {
  const p = fs.readFileSync(path.join(src, 'app/privacy/page.tsx'), 'utf8');
  for (const w of [/Payday email/, /Deadline reminders/, /Rate-move email/, /Usage counts/, /no IP address, no user id/,
    /record of your agreement, in detail/, /deleted at once/, /sign-in codes always go first/]) assert.match(p, w);
  const t = fs.readFileSync(path.join(src, 'app/terms/page.tsx'), 'utf8');
  assert.match(t, /Emails you switch on/);
  assert.match(t, /CONTACT_EMAILS\.support/);
  // The processor list names every email kind, on both sides.
  const facts = require(path.join(src, 'lib/privacy-facts.ts'));
  const resend = facts.PROCESSORS.find((x) => x.who === 'Resend (emails you switch on)');
  assert.ok(resend && /deadline reminders/.test(resend.data) && /rate-move/.test(resend.data));
  assert.match(read('api/privacy_facts.py'), /"Resend \(emails you switch on\)"/);
});
