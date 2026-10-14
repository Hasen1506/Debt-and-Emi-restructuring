// Live re-test 13 R13-1: import panels must not overflow on phones.
// The browser check is e2e/r13-fixes.spec.ts; this guards the two CSS parts
// so a later edit can't silently drop one (both are needed: the column fix
// alone still leaves the file picker sticking out).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '../src');
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('R13-1: every file picker is capped at its container width', () => {
  const css = src('styles/globals.css');
  assert.match(css, /input\[type='file'\]\s*\{\s*max-width:\s*100%;\s*\}/);
});

test('R13-1: the bordered import panels use a shrinkable grid column', () => {
  const panels = [
    ['components/profile/CreditReportImport.tsx', 'cr-import'],
    ['components/profile/KfsImport.tsx', 'kfs-import'],
    ['components/profile/SmsImport.tsx', 'sms-import'],
    ['components/setup/SetupImportCard.tsx', 'setup-import-card'],
  ];
  for (const [file, id] of panels) {
    const s = src(file);
    const at = s.indexOf(`data-testid="${id}"`);
    assert.ok(at >= 0, `${file}: ${id} not found`);
    const style = s.slice(at, s.indexOf('>', s.indexOf('style={{', at)));
    assert.match(style, /display: 'grid'/, `${file}: ${id} is no longer a grid`);
    assert.match(style, /gridTemplateColumns: 'minmax\(0, 1fr\)'/, `${file}: ${id} needs gridTemplateColumns minmax(0, 1fr)`);
  }
});

test('R13-1: no bordered grid panel in components/ or app/ relies on an implicit auto column', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const bad = [];
  for (const f of walk(root).filter((f) => f.endsWith('.tsx'))) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (/style=\{\{[^}]*border: '1px solid[^}]*display: 'grid'/.test(line) && !/gridTemplateColumns/.test(line)) bad.push(`${path.relative(root, f)}: ${line.trim()}`);
    }
  }
  assert.deepEqual(bad, []);
});
