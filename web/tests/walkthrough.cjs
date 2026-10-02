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
for (const ext of ['.ts', '.tsx'])
  require.extensions[ext] = (module, file) => {
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    module._compile(output, file);
  };
const lib = (name) => require(path.join(root, 'lib', name));

function withSession(fn) {
  const store = new Map();
  global.window = { sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } };
  try { fn(); } finally { delete global.window; }
}

test('Profile offers a way back to the page it was opened from', () => {
  const { recordPage, previousPage, pageName } = lib('nav-trail.ts');
  withSession(() => {
    recordPage('/plan');
    recordPage('/profile?step=income&focus=hike');
    assert.deepEqual(previousPage('/profile'), { href: '/plan', name: 'Plan' });
    // Moving between parts of Profile is not a new page.
    recordPage('/profile');
    assert.deepEqual(previousPage('/profile'), { href: '/plan', name: 'Plan' });
  });
  withSession(() => {
    recordPage('/tools/windfall');
    recordPage('/profile');
    assert.equal(previousPage('/profile').name, 'Spare cash');
  });
  // Opened straight from a bookmark: no back link.
  withSession(() => {
    recordPage('/profile');
    assert.equal(previousPage('/profile'), null);
  });
  // Storage blocked: no crash, no link.
  global.window = { sessionStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } };
  try {
    recordPage('/plan');
    assert.equal(previousPage('/profile'), null);
  } finally { delete global.window; }
  assert.equal(pageName('/'), 'Home');
  assert.equal(pageName('/goals'), 'Goals and tools');
});
