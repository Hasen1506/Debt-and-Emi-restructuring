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
const lib = (name) => require(path.join(root, 'lib', name));
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// Live re-test 2, 13 Oct 2026 (LIVE-RETEST-2-2026-10-13.md).

test('NEW-2: a never-clearing schedule stops at the horizon and never prints a runaway figure', () => {
  const { scheduleStop, boundedMoney, saneCap, scheduleStopLine, NEVER_CLEARS_HORIZON } = lib('plan-gap.ts');
  const owed = 3_050_000;
  // Persona B: loans clear at year 30 but gap borrowing compounds forever.
  const rows = Array.from({ length: 1200 }, (_, i) => ({
    mo: i + 1,
    balance: Math.max(0, owed - i * 9000),
    gapDebt: 12_500 * Math.pow(1.04, i),
  }));
  const s = scheduleStop({ rows, owedToday: owed, cut: { month: 360, growsWithoutLimit: false } });
  assert.ok(s.lastMonth !== null && s.lastMonth <= NEVER_CLEARS_HORIZON);
  const cap = saneCap(owed);
  for (const r of rows.filter((r) => r.mo <= s.lastMonth)) assert.ok(r.balance + r.gapDebt <= cap);
  // It grows past 100x before month 360 here, so it says "without limit".
  assert.equal(s.growsWithoutLimit, true);
  assert.match(scheduleStopLine(true, 'MAR 2031'), /GROWS WITHOUT LIMIT.*STOPS AT MAR 2031/);
  assert.match(scheduleStopLine(false, 'SEP 2056'), /DOESN’T CLEAR IN 30 YEARS/);
  // A plan that clears is shown whole.
  const ok = rows.slice(0, 80).map((r) => ({ ...r, gapDebt: 0 }));
  assert.deepEqual(scheduleStop({ rows: ok, owedToday: owed, cut: null }), { lastMonth: null, growsWithoutLimit: false });
  // An older API with no cut still can't print a 30-digit figure.
  assert.ok(scheduleStop({ rows, owedToday: owed, cut: null }).lastMonth < 1200);
  assert.equal(boundedMoney(1.5e25, cap, String), 'KEEPS GROWING');
  assert.equal(boundedMoney(1000, cap, (v) => `₹${v}`), '₹1000');
});

test('NEW-2: the schedule uses the stop and the bounded cells', () => {
  const s = src('components/plan/PlanSchedule.tsx');
  assert.match(s, /scheduleStop\(/);
  assert.match(s, /cell\(gapMonths\[r\.mo\]\.debt\)/);
  assert.doesNotMatch(s, /fc\(gapMonths\[r\.mo\]\.debt/);
});

test('R2-1: an unreadable rate is not 0% and gets an inline error', () => {
  const { deriveTenureMonths } = lib('derived.ts');
  assert.equal(deriveTenureMonths('2500000', '', '22000'), null);
  assert.equal(deriveTenureMonths('2500000', '8.5x', '22000'), null);
  const at85 = deriveTenureMonths('2500000', '0.085', '22000');
  assert.ok(at85 > 200, `8.5% should be ~236 months, got ${at85}`);
  // An explicit 0 (interest-free) is still pure division.
  assert.equal(deriveTenureMonths('2500000', '0', '22000'), 114);
  const { percentTextToFraction } = require(path.join(root, 'components', 'ToolPrimitives.tsx'));
  assert.equal(percentTextToFraction('8.5x'), null);
  assert.match(src('components/ToolPrimitives.tsx'), /isn’t a valid rate\. Type it like 8\.5/);
});

test('R2-3: the tenure what-if only talks about a gap when the plan is short', () => {
  const { tenureWhatIfCopy } = lib('tenure-whatif-copy.ts');
  const money = (v) => `₹${Math.round(v).toLocaleString('en-IN')}`;
  const noGap = tenureWhatIfCopy({ baselineShortfall: 0, scenarioShortfall: 0, freed: 1622, extraInterest: -25507, neverClears: false, scenarioNeverClears: false, money });
  assert.equal(noGap.gap, null);
  assert.doesNotMatch(noGap.interest, /gap/i);
  assert.match(noGap.interest, /₹1,622 a month the lower EMI frees/);
  const short = tenureWhatIfCopy({ baselineShortfall: 12500, scenarioShortfall: 0, freed: 1622, extraInterest: -25507, neverClears: false, scenarioNeverClears: false, money });
  assert.equal(short.gap, 'This month’s gap closes.');
  assert.match(short.interest, /gap borrowing/);
  const still = tenureWhatIfCopy({ baselineShortfall: 12500, scenarioShortfall: 10000, freed: 2500, extraInterest: 5000, neverClears: false, scenarioNeverClears: false, money });
  assert.match(still.gap, /still be short ₹10,000/);
  assert.doesNotMatch(src('components/plan/TenureWhatIf.tsx'), /gapAfter <= 0\.5 \?/);
});

test('NEW-6: Plan chart labels, leaders and the minimums note never collide (390 → 1920)', () => {
  const { layoutTrajectoryLabels } = require(path.join(root, 'components', 'ledger', 'LTrajectory.tsx'));
  // Persona A: ₹30.5L; card clears Jan '27 (m4), personal Aug '27 (m11), home Jul '30 (m46).
  const N = 46;
  const pts = Array.from({ length: N + 1 }, (_, m) => {
    const av = m <= 4 ? 1 - m * 0.03 : m <= 11 ? 0.88 - (m - 4) * 0.028 : Math.max(0, 0.68 * (1 - (m - 11) / 35));
    return { t: m / N, av, min: 1 - m * 0.0045 };
  });
  const ms = [
    { t: 4 / N, v: pts[4].av, label: "CARD · JAN '27" },
    { t: 11 / N, v: pts[11].av, label: "PERSONAL LOAN · AUG '27" },
    { t: 1, v: 0, label: "HOME LOAN · JUL '30" },
  ];
  const note = "MINIMUMS: CLEAR MAR '62 →";
  for (const w of [340, 358, 390, 480, 768, 1232, 1880]) {
    const narrow = w < 480;
    const h = narrow ? 220 : 260, left = narrow ? 58 : 76, right = 14, top = 34, bottom = 26;
    const toX = (t) => left + t * (w - left - right);
    const toY = (v) => h - bottom - v * (h - top - bottom);
    const { note: n, labels } = layoutTrajectoryLabels({ points: pts, milestones: ms, minimumsNote: note, w, left, right, top, toX, toY });
    const CW = 5.9;
    const box = (x0, x1, y) => ({ x0, x1, y0: y - 9, y1: y + 2 });
    const lineAt = (key, x) => {
      for (let i = 1; i < pts.length; i++) {
        const xa = toX(pts[i - 1].t), xb = toX(pts[i].t);
        if (x >= xa && x <= xb) return toY(pts[i - 1][key] + ((x - xa) / (xb - xa || 1)) * (pts[i][key] - pts[i - 1][key]));
      }
      return null;
    };
    const hitsLine = (b) => {
      for (let x = b.x0; x <= b.x1; x += 1) for (const k of ['av', 'min']) { const y = lineAt(k, x); if (y !== null && y >= b.y0 && y <= b.y1) return k; }
      return null;
    };
    const boxes = labels.map((l) => box(l.x0, l.x1, l.y));
    const nb = box(w - right - note.length * CW, w - right, n.y);
    assert.equal(hitsLine(nb), null, `w=${w}: minimums note on a line (y=${n.y})`);
    labels.forEach((l, i) => {
      assert.equal(hitsLine(boxes[i]), null, `w=${w}: "${l.label}" on a line`);
      const ov = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
      assert.ok(!ov(boxes[i], nb), `w=${w}: "${l.label}" on the note`);
      labels.forEach((o, j) => {
        if (j === i) return;
        assert.ok(!ov(boxes[i], boxes[j]), `w=${w}: "${l.label}" on "${o.label}"`);
        // Another label's raised leader and drop line must not cross this box.
        const segs = [[o.markY, h - bottom]];
        if (o.raised) segs.push(o.y < o.markY ? [o.y + 3, o.markY - 5] : [o.y - 10, o.markY + 5]);
        for (const [a, b] of segs) {
          const crosses = o.x >= boxes[i].x0 && o.x <= boxes[i].x1 && Math.max(a, b) >= boxes[i].y0 && Math.min(a, b) <= boxes[i].y1;
          assert.ok(!crosses, `w=${w}: "${o.label}" leader crosses "${l.label}"`);
        }
      });
    });
  }
});
