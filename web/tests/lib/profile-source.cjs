// The Profile form's source as one string: ProfileClient.tsx plus the parts
// split out of it (app/profile/parts/*.tsx, Audit 80 E15). Source-text tests
// that used to read ProfileClient.tsx alone read this, so moving a component
// between those files is not a test failure. New tests should render or
// call the code instead of matching its text (E17).
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.resolve(__dirname, '../../src/app/profile');

function profileSource() {
  const parts = path.join(DIR, 'parts');
  const files = [path.join(DIR, 'ProfileClient.tsx')];
  if (fs.existsSync(parts)) for (const f of fs.readdirSync(parts).sort()) if (f.endsWith('.tsx')) files.push(path.join(parts, f));
  return files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
}

module.exports = { profileSource };
