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
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText;
    module._compile(output, file);
  };
const fresh = (name) => {
  delete require.cache[path.join(root, 'lib', name)];
  return require(path.join(root, 'lib', name));
};
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/** A back/forward-cache restore: pageshow with persisted true (R12-1 fix 2:
 *  the first load's pageshow, persisted false, no longer ends a leave). */
const bfcacheShow = () => Object.defineProperty(new Event('pageshow'), 'persisted', { value: true });
const walk = (dir, ext) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return walk(p, ext);
    return ext.some((e) => d.name.endsWith(e)) ? [p] : [];
  });

// Live re-test 12 fix round (R12-1, R12-2, O-1 in api/tests, O-4).

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
const hangs = (signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(abortError()), { once: true }));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// ─── R12-1: a request started during the leave waits before its first try ──
test('R12-1: after an unprevented beforeunload, a new page-scoped request does not run until pageshow', async () => {
  const win = new EventTarget();
  global.window = win;
  try {
    const { pageScoped } = fresh('page-abort.ts');
    win.dispatchEvent(new Event('beforeunload', { cancelable: true })); // nobody prevents it: the page is going
    await tick();
    const signals = [];
    const p = pageScoped(async (signal) => { signals.push(signal); return 'me'; }, undefined, 10);
    await tick(150);
    assert.equal(signals.length, 0, 'not started while the page is leaving (WebKit would cut it off and log it)');
    win.dispatchEvent(bfcacheShow()); // back from the back/forward cache
    assert.equal(await p, 'me');
    assert.equal(signals.length, 1);
    assert.equal(signals[0].aborted, false, 'runs with a live signal');
  } finally {
    delete global.window;
  }
});

test('R12-1 (main CI 38517942574): the first load\'s own pageshow, fired after the leave began, does not let requests out', async () => {
  const win = new EventTarget();
  global.window = win;
  try {
    const { pageScoped, isLeaving } = fresh('page-abort.ts');
    // goto('/plan', commit) → leave 0–99 ms later → /plan's load + pageshow
    // (persisted false) still fire while the next page loads.
    win.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    await tick();
    win.dispatchEvent(new Event('pageshow')); // persisted: undefined/false
    const loadShow = Object.defineProperty(new Event('pageshow'), 'persisted', { value: false });
    win.dispatchEvent(loadShow);
    assert.equal(isLeaving(), true, 'still leaving');
    let n = 0;
    const p = pageScoped(async () => { n++; return 'me'; }, undefined, 10);
    await tick(150);
    assert.equal(n, 0, 'the masthead auth/me is held, not cut off');
    win.dispatchEvent(bfcacheShow()); // a real restore does end it
    assert.equal(await p, 'me');
    assert.match(src('lib/page-abort.ts'), /addEventListener\('pageshow', \(e\) => \{\s*if \(\(e as PageTransitionEvent\)\.persisted\) leavingSince = 0;/);
  } finally {
    delete global.window;
  }
});

test('R12-1: a leave that began before the app\'s scripts loaded (inline head listener) holds the first requests too', async () => {
  const vm = require('node:vm');
  const win = new EventTarget();
  global.window = win;
  try {
    // The inline head script, run in a window-like context before the module.
    const { EARLY_LEAVE_SCRIPT } = fresh('page-abort.ts');
    const early = new EventTarget();
    // Fire the leave on a fresh window that only has the inline listener.
    const ctx2 = { window: early, addEventListener: early.addEventListener.bind(early), Date };
    vm.runInNewContext(EARLY_LEAVE_SCRIPT, ctx2);
    early.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    assert.ok(early.__rdLeavingSince > 0, 'the inline listener noted the leave');
    early.dispatchEvent(new Event('pageshow')); // first load finishing: not a restore
    assert.ok(early.__rdLeavingSince > 0);
    // Now the app's module loads on that window, mid-leave.
    global.window = early;
    const { pageScoped, isLeaving } = fresh('page-abort.ts');
    assert.equal(isLeaving(), true);
    let n = 0;
    const p = pageScoped(async () => { n++; return 'rates'; }, undefined, 10);
    await tick(150);
    assert.equal(n, 0, 'held');
    early.dispatchEvent(bfcacheShow());
    assert.equal(await p, 'rates');
    // It is in the document head, ahead of the app's scripts.
    assert.match(src('app/layout.tsx'), /<head>[\s\S]*<script dangerouslySetInnerHTML=\{\{ __html: EARLY_LEAVE_SCRIPT \}\} \/>[\s\S]*<\/head>/);
  } finally {
    delete global.window;
  }
});

test('R12-1: …or until LEAVE_GRACE_MS has passed (a leave that never happened: a download, Stop)', async () => {
  const win = new EventTarget();
  global.window = win;
  const realNow = Date.now;
  let now = 2_000_000;
  Date.now = () => now;
  try {
    const { pageScoped, LEAVE_GRACE_MS, isLeaving } = fresh('page-abort.ts');
    assert.equal(isLeaving(), false);
    win.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    await tick();
    assert.equal(isLeaving(), true);
    let n = 0;
    const p = pageScoped(async () => { n++; return 'rates'; }, undefined, 10);
    await tick(150);
    assert.equal(n, 0);
    now += LEAVE_GRACE_MS;
    assert.equal(await p, 'rates');
    assert.equal(n, 1);
    assert.equal(isLeaving(), false);
  } finally {
    Date.now = realNow;
    delete global.window;
  }
});

test('R12-1: a "leave this page?" prompt that kept the person here lets new requests through within a task or two', async () => {
  const win = new EventTarget();
  global.window = win;
  try {
    const { pageScoped } = fresh('page-abort.ts');
    win.addEventListener('beforeunload', (e) => e.preventDefault()); // Profile's unsaved-imports guard → Stay
    win.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    const t0 = Date.now();
    let ranAt = 0;
    const v = await pageScoped(async () => { ranAt = Date.now(); return 'ok'; }, undefined, 1000);
    assert.equal(v, 'ok');
    assert.ok(ranAt - t0 < 500, `ran after ${ranAt - t0} ms`);
  } finally {
    delete global.window;
  }
});

test('R12-1: the caller cancelling while the request is held ends it with an AbortError and it never runs', async () => {
  const win = new EventTarget();
  global.window = win;
  try {
    const { pageScoped } = fresh('page-abort.ts');
    win.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    const own = new AbortController();
    let n = 0;
    const p = pageScoped(async () => { n++; return 'x'; }, own.signal, 10);
    await tick(50);
    own.abort();
    await assert.rejects(p, (e) => e.name === 'AbortError');
    assert.equal(n, 0);
  } finally {
    delete global.window;
  }
});

test('R12-1: with no leave under way the request runs at once; a cut-off retry still waits out the leave', async () => {
  const win = new EventTarget();
  global.window = win;
  try {
    const { pageScoped } = fresh('page-abort.ts');
    let ran = false;
    const p = pageScoped(async () => { ran = true; return 1; });
    await tick();
    assert.equal(ran, true);
    assert.equal(await p, 1);
    // In flight at beforeunload: aborted quietly (R11-1), not re-asked until pageshow.
    let n = 0;
    const q = pageScoped(async (s) => (++n === 1 ? hangs(s) : 'again'), undefined, 10);
    await tick();
    win.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    await tick(120);
    assert.equal(n, 1);
    win.dispatchEvent(bfcacheShow());
    assert.equal(await q, 'again');
    // The source holds the first try too, not only the retry.
    const s = src('lib/page-abort.ts');
    assert.match(s, /for \(;;\) \{[\s\S]*?await whileLeaving\(own[\s\S]*?const page = pageSignal\(\);[\s\S]*?return await run\(/);
  } finally {
    delete global.window;
  }
});

// ─── R12-2: every class a component uses is defined ────────────────────────
const cssFiles = walk(root, ['.css']);
const css = cssFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const tsxFiles = walk(root, ['.tsx']);
const allTs = walk(root, ['.ts', '.tsx']).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const definedInCss = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));

/** Every static class token in className="…", className={'…'} and className={`…`} (template holes dropped). */
function classTokens() {
  const used = new Map();
  for (const f of tsxFiles) {
    const t = fs.readFileSync(f, 'utf8');
    const add = (s) => {
      for (const tok of s.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
        if (!/^[a-z][\w-]*$/.test(tok)) continue;
        if (!used.has(tok)) used.set(tok, new Set());
        used.get(tok).add(path.relative(root, f));
      }
    };
    for (const m of t.matchAll(/className="([^"]*)"/g)) add(m[1]);
    for (const m of t.matchAll(/className=\{/g)) {
      let i = m.index + m[0].length, d = 1, j = i;
      while (d && j < t.length) { if (t[j] === '{') d++; else if (t[j] === '}') d--; j++; }
      for (const q of t.slice(i, j - 1).matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) add(q[1] ?? q[2] ?? q[3] ?? '');
    }
  }
  return used;
}

test('R12-2: every btn-* class used in a component is defined in the stylesheets', () => {
  const used = classTokens();
  const btn = [...used.keys()].filter((k) => /^btn(-|$)/.test(k));
  assert.ok(btn.includes('btn-ghost') && btn.includes('btn') && btn.includes('btn-primary'), `found ${btn.join(', ')}`);
  const missing = btn.filter((k) => !definedInCss.has(k)).map((k) => `${k} (${[...used.get(k)].join(', ')})`);
  assert.deepEqual(missing, [], 'btn-* classes used but never defined in src/**/*.css');
  // The sanity check itself: a made-up btn class would be caught.
  assert.equal(definedInCss.has('btn-imaginary'), false);
});

test('R12-2: no class used in a component is undefined (CSS, or CSS a component injects itself)', () => {
  const used = classTokens();
  const undefinedClasses = [...used.keys()]
    .filter((k) => !definedInCss.has(k) && !new RegExp(`\\.${k.replace(/[-]/g, '\\-')}\\b`).test(allTs))
    .map((k) => `${k} (${[...used.get(k)].join(', ')})`);
  assert.deepEqual(undefinedClasses, []);
});

test('R12-2: .btn-ghost is the ledger mono/uppercase ghost button; primaries carry .btn too', () => {
  const g = src('styles/globals.css');
  const rule = g.match(/\n\.btn-ghost \{([^}]*)\}/);
  assert.ok(rule, '.btn-ghost is defined');
  for (const decl of ['font-family: var(--font-mono)', 'text-transform: uppercase', 'background: transparent', 'border: 1px solid var(--border)', 'color: var(--ink)', 'white-space: normal'])
    assert.ok(rule[1].includes(decl), decl);
  // Touch: every button is ≥44px on a coarse pointer (R6-2), which covers it.
  assert.match(g, /@media \(pointer: coarse\) \{[\s\S]*?button,\s*select,\s*summary,\s*\[role='button'\] \{\s*min-height: 44px !important;/);
  // Focus: the global ring is never hidden.
  assert.match(g, /:focus-visible \{\s*outline: 2px solid var\(--accent\);/);
  assert.doesNotMatch(g, /\.btn-ghost[^{]*\{[^}]*outline:\s*(none|0)/);
  // A lone btn-primary missed .btn's padding, border and type.
  for (const f of tsxFiles) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /className="btn-primary"/, path.relative(root, f));
});

// ─── O-4: a goal amount of 0 is flagged when the person leaves the box ─────
test('O-4: goal amount 0 gets its inline message on blur, not only at ADD', () => {
  const { goalAmountBlurError, goalAmountError, GOAL_AMOUNT_ERROR } = fresh('goals.ts');
  assert.equal(goalAmountBlurError('0', true), GOAL_AMOUNT_ERROR);
  assert.equal(goalAmountBlurError('0', false), null, 'not while still typing');
  assert.equal(goalAmountBlurError('', true), null, 'a box tabbed past is not an error yet');
  assert.equal(goalAmountBlurError('300000', true), null);
  assert.equal(goalAmountError(''), GOAL_AMOUNT_ERROR, 'ADD still refuses a blank');
  assert.equal(goalAmountError('0'), GOAL_AMOUNT_ERROR);
  const form = src('components/goals/GoalForm.tsx');
  assert.match(form, /onBlur=\{\(\) => setAmountLeft\(true\)\}\s*error=\{show\('amount'\) \?\? goalAmountBlurError\(goal\.amount, amountLeft\)\}/);
  assert.match(form, /amount: goalAmountError\(goal\.amount\)/);
  const field = src('components/ToolPrimitives.tsx');
  assert.match(field, /const handleBlur = \(\) => \{[\s\S]*?onBlur\?\.\(\);\s*\};/);
});
