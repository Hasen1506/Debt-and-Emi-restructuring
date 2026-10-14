// CI FIREFOX (run 38488716548, account-persistence :61): signing in from
// "Sign in again" ended back on /login?next=%2Fprofile in Firefox. The login
// page leaves with window.location.assign; a router.refresh() of /login still
// in flight (session-changed hydrate, or the remote-applied refresh after the
// queued change was sent) was cancelled by that load, Next fell back to a
// browser navigation of /login, and that replaced the load.
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
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('onSignInPage is true only on /login', () => {
  const { onSignInPage } = require(path.join(root, 'lib/session-events.ts'));
  const saved = global.window;
  try {
    delete global.window;
    assert.equal(onSignInPage(), false);
    for (const [pathname, want] of [['/login', true], ['/profile', false], ['/login/x', false], ['/', false]]) {
      global.window = { location: { pathname } };
      assert.equal(onSignInPage(), want, pathname);
    }
  } finally {
    if (saved === undefined) delete global.window; else global.window = saved;
  }
});

test('the sign-in page leaves with one full load and no session-changed event first', () => {
  const login = src('app/login/page.tsx');
  const finish = login
    .slice(login.indexOf('async function finishSignIn'), login.indexOf('async function requestOtpWhenReady'))
    .replace(/\/\/.*$/gm, '');
  assert.match(finish, /window\.location\.assign\(redirectTo\)/);
  assert.doesNotMatch(finish, /notifySessionChanged\(\)/);
  assert.doesNotMatch(finish, /router\.(push|refresh)/);
});

test('every router.refresh that can run on /login is skipped there', () => {
  const notice = src('components/AccountSyncNotice.tsx');
  assert.match(notice, /const remote = \(\) => \{ if \(!onSignInPage\(\)\) router\.refresh\(\); \};/);
  const sync = src('lib/server-sync.ts');
  const hydrator = sync.slice(sync.indexOf('export function SessionHydrator'));
  const refreshes = hydrator.match(/router\.refresh\(\)/g) ?? [];
  const guarded = hydrator.match(/!onSignInPage\(\)\) router\.refresh\(\)/g) ?? [];
  assert.ok(refreshes.length >= 2);
  assert.equal(guarded.length, refreshes.length);
});
