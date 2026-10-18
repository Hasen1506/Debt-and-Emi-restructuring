// Audit 80 E17 (W9): money and percentages on screen go through one formatter.
//
// Raw `.toFixed(` / `.toLocaleString(` / `new Intl.NumberFormat` in a
// component is how a screen ends up with "₹1234567.00" next to "₹12,34,567",
// a US page grouped the Indian way, or a percent with 4 decimals. The shared
// formatters (formatCurrency, formatCurrencyWhole, formatPct in lib/api.ts;
// formatLoanAmount in lib/currency.ts) pick the locale, grouping and digits.
//
// This is a RATCHET, not a ban: the counts per file on 14 Oct 2026 are in
// tests/formatter-baseline.json. A file may only go down. A new component file
// starts at zero. Lowering is welcome: rerun with
//   UPDATE_FORMATTER_BASELINE=1 node --test tests/formatter-guard.cjs
// and commit the smaller numbers. Raising a number needs a reason in the PR
// (for example `.toFixed(0)` inside a value that is then passed to
// formatCurrencyWhole is a rounding step, not a display; prefer
// Decimal.toDecimalPlaces / Math.round so the guard stays quiet).
//
// Scope: src/components/** and src/app/** (what renders). lib/ is excluded:
// it holds the formatters themselves and serialisers that need toFixed.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.resolve(__dirname, '..');
const BASELINE = path.join(__dirname, 'formatter-baseline.json');
const ROOTS = ['src/components', 'src/app'];
const RAW = /\.toFixed\(|\.toLocaleString\(|new\s+Intl\.NumberFormat\b/g;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Line and block comments removed, so prose that names toFixed is not counted. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function measure() {
  const counts = {};
  for (const root of ROOTS) {
    for (const f of walk(path.join(WEB, root))) {
      const n = (stripComments(fs.readFileSync(f, 'utf8')).match(RAW) || []).length;
      if (n) counts[path.relative(WEB, f).split(path.sep).join('/')] = n;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

const now = measure();

if (process.env.UPDATE_FORMATTER_BASELINE) {
  fs.writeFileSync(BASELINE, JSON.stringify({
    _comment: 'Audit 80 E17 ratchet: raw toFixed/toLocaleString/Intl.NumberFormat per UI file. May only go down. See tests/formatter-guard.cjs.',
    files: now,
  }, null, 2) + '\n');
}

const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).files;

test('no UI file adds a raw number format (use formatCurrency / formatCurrencyWhole / formatPct)', () => {
  const grew = [];
  for (const [file, n] of Object.entries(now)) {
    const cap = base[file] ?? 0;
    if (n > cap) grew.push(`${file}: ${n} raw formats (baseline ${cap})`);
  }
  assert.deepEqual(grew, [], `Use the shared formatters instead of raw toFixed/toLocaleString:\n${grew.join('\n')}`);
});

test('the ratchet counts something (the scan still finds the UI files)', () => {
  const total = Object.values(now).reduce((s, n) => s + n, 0);
  assert.ok(Object.keys(now).length > 10 && total > 50, `scan found only ${total} in ${Object.keys(now).length} files`);
});

test('the guard catches a raw format and ignores one in a comment', () => {
  const code = 'const a = x.toFixed(2); // y.toFixed(1)\n/* z.toLocaleString() */ const b = new Intl.NumberFormat("en-IN");';
  assert.equal((stripComments(code).match(RAW) || []).length, 2);
});
