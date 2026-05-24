// ═══════════════════════════════════════════════════════════════════════
// LEDGER SKIN — "The Statement"
// Mono everywhere, ASCII rules, dense tables, no rounded, brutalist.
// Reads like a printed bank statement crossed with a terminal session.
// ═══════════════════════════════════════════════════════════════════════
const L = window.APP;
const L_T = {
  bg: '#fbfaf3', paper: '#ffffff',
  ink: '#0a0a0a', inkSoft: '#2a2a26',
  muted: '#5e5e58', faint: '#a8a8a3',
  rule: '#0a0a0a', ruleSoft: '#d8d6cd',
  accent: '#c96442', accentInk: '#8b3a1f',
  positive: '#15803d', negative: '#b91c1c',
  highlight: '#fff3a3', highlightSoft: '#fff8d3',
};
const L_mono = "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace";

// ──── primitives ────────────────────────────────────────────────────────
const LRule = ({ char = '─', length = 200, weight = 700, color }) => (
  <div style={{ whiteSpace: 'pre', overflow: 'hidden', fontFamily: L_mono, color: color || L_T.ink, fontWeight: weight, fontSize: 11, lineHeight: 1 }}>
    {char.repeat(length)}
  </div>
);

const LBracket = ({ children, active, accent, style }) => (
  <span style={{
    fontFamily: L_mono, fontSize: 10, letterSpacing: '0.14em',
    color: accent ? L_T.accent : (active ? L_T.ink : L_T.muted),
    fontWeight: active ? 700 : 500,
    textDecoration: active ? 'underline' : 'none',
    textUnderlineOffset: 4,
    textDecorationColor: L_T.accent,
    textDecorationThickness: 2,
    cursor: 'pointer', ...style,
  }}>[{children}]</span>
);

const LShell = ({ children }) => (
  <div style={{
    width: '100%', height: '100%',
    background: L_T.bg, color: L_T.ink,
    fontFamily: L_mono, fontSize: 12, lineHeight: 1.55,
    fontFeatureSettings: '"tnum"',
    display: 'flex', flexDirection: 'column',
  }}>{children}</div>
);

const LMasthead = ({ section, mobile, stmt = '#1138' }) => (
  <div style={{ borderTop: `6px solid ${L_T.ink}`, padding: mobile ? '12px 18px 0' : '14px 32px 0', flex: '0 0 auto', background: L_T.bg }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ fontSize: mobile ? 13 : 14, fontWeight: 700, letterSpacing: '0.18em' }}>
        FINOPTIMA<span style={{ color: L_T.muted, fontWeight: 400 }}> / LEDGER</span>
      </div>
      <div style={{ fontSize: 10, color: L_T.muted, letterSpacing: '0.1em' }}>
        THU, 14 MAY 2026 · 14:32 IST · STMT {stmt}
      </div>
    </div>
    <div style={{ margin: '8px 0 0' }}><LRule length={300} /></div>
    <div style={{ display: 'flex', gap: mobile ? 12 : 22, padding: '8px 0', overflowX: 'auto', flexWrap: 'wrap' }}>
      {[
        ['LEDGER',  'home'],
        ['PLAN',    'plan'],
        ['DEBTS',   'debts'],
        ['TOOLS',   'tools'],
        ['NOTES',   'insights'],
        ['SETUP',   'setup'],
      ].map(([label, key]) => (
        <LBracket key={key} active={section === key}>{label}</LBracket>
      ))}
      <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'baseline' }}>
        <LBracket>IN · ₹</LBracket>
      </span>
    </div>
    <LRule length={300} />
  </div>
);

const LFooter = ({ mode = 'SIMPLE', tone = 'CALM', mobile }) => (
  <div style={{ borderTop: `1px solid ${L_T.ink}`, padding: mobile ? '8px 18px' : '10px 32px', display: 'flex', justifyContent: 'space-between', flex: '0 0 auto', fontSize: 10, letterSpacing: '0.14em', color: L_T.muted, flexWrap: 'wrap', gap: 8 }}>
    <span>
      <LBracket accent>{tone === 'OVERWHELMED' ? '← BACK TO CALM' : 'FEELING OVERWHELMED?'}</LBracket>
    </span>
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <LBracket active={mode === 'SIMPLE'}>SIMPLE</LBracket>
      <LBracket active={mode === 'DETAILED'}>DETAILED</LBracket>
    </span>
  </div>
);

const LSectionHeader = ({ children, right }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, fontSize: 11, letterSpacing: '0.18em', flexWrap: 'wrap', gap: 8 }}>
    <span style={{ color: L_T.muted, fontWeight: 600 }}>$ {children}</span>
    {right}
  </div>
);

const LKpi = ({ items, mobile, cols }) => (
  <div style={{
    display: 'grid', gridTemplateColumns: `repeat(${cols || (mobile ? 2 : items.length)}, 1fr)`,
    gap: 1, background: L_T.ink, padding: 1,
  }}>
    {items.map((m, i) => (
      <div key={i} style={{ background: L_T.bg, padding: '10px 14px' }}>
        <div style={{ fontSize: 10, color: L_T.muted, letterSpacing: '0.12em', marginBottom: 4 }}>{m.l}</div>
        <div style={{ fontSize: mobile ? 15 : 17, fontWeight: 700, color: m.tone || L_T.ink, letterSpacing: '-0.01em' }}>{m.v}</div>
        {m.s && <div style={{ fontSize: 10, color: L_T.muted, marginTop: 4 }}>{m.s}</div>}
      </div>
    ))}
  </div>
);

// ═══════════════════════════════════════════════════════════════════════
// HOME — Simple × Calm  (the daily statement)
// ═══════════════════════════════════════════════════════════════════════
const LHomeSimple = ({ mobile }) => (
  <LShell>
    <LMasthead section="home" mobile={mobile} />
    <div style={{ flex: 1, overflow: 'auto', padding: mobile ? '14px 18px 28px' : '18px 32px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>

      {/* STATUS — 5 KPIs */}
      <section>
        <LSectionHeader>STATUS</LSectionHeader>
        <LKpi mobile={mobile} cols={mobile ? 2 : 5} items={[
          { l: 'OUTSTANDING',  v: L.plan.totalOutstanding, s: `${L.plan.totalOutstandingMTD} MTD` },
          { l: 'DEBT-FREE',    v: 'AUG 2027',              s: `17 MO · −14 vs MIN`,    tone: L_T.positive },
          { l: 'EFFECTIVE APR', v: L.plan.weightedAPR,     s: 'WEIGHTED' },
          { l: 'SURPLUS',      v: '₹1.05L/MO',             s: 'NET ALLOC',             tone: L_T.positive },
          { l: 'NEXT ACTION',  v: 'PAY ₹18,500',           s: '→ KOTAK · DUE 1 JUN',   tone: L_T.accent },
        ]} />
      </section>

      {/* ACTION CARD — single line */}
      <section style={{ border: `2px solid ${L_T.ink}`, padding: mobile ? '14px 16px' : '18px 22px' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.accent, fontWeight: 700, marginBottom: 8 }}>$ THIS MONTH · DO THIS</div>
        <div style={{ fontSize: mobile ? 17 : 21, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.3, marginBottom: 6 }}>
          PAY {L.thisMonth.amount} EXTRA → KOTAK CARD
        </div>
        <div style={{ fontSize: 12, color: L_T.muted, marginBottom: 14 }}>
          HIGHEST EFFECTIVE APR · 42.48% (POST-GST) · SAVES {L.thisMonth.savesAnnual} INT/YR
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <LBracket active>I PAID THIS</LBracket>
          <LBracket>WHY?</LBracket>
          <LBracket>SHOW MATH ↓</LBracket>
        </div>
      </section>

      {/* DEBTS TABLE */}
      <section>
        <LSectionHeader right={<LBracket>+ ADD DEBT</LBracket>}>OPEN POSITIONS · {L.debts.length}</LSectionHeader>
        <LDebtsTable mobile={mobile} />
      </section>

      {/* TOOLS RAIL */}
      <section>
        <LSectionHeader>TOOLS · 7</LSectionHeader>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${mobile ? 2 : 7}, 1fr)`, gap: 1, background: L_T.ink, padding: 1 }}>
          {L.tools.map((t) => (
            <div key={t.id} style={{ background: L_T.bg, padding: '12px 10px' }}>
              <div style={{ fontSize: 10, color: L_T.accent, fontWeight: 700, letterSpacing: '0.1em' }}>§{t.tag.toUpperCase()}</div>
              <div style={{ fontSize: 11, fontWeight: 700, marginTop: 4 }}>{t.name.toUpperCase()}</div>
              <div style={{ fontSize: 10, color: L_T.muted, marginTop: 4, lineHeight: 1.4 }}>{t.q}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
    <LFooter mode="SIMPLE" mobile={mobile} />
  </LShell>
);

// ═══════════════════════════════════════════════════════════════════════
// HOME — Detailed × Calm (full diagnostics)
// ═══════════════════════════════════════════════════════════════════════
const LHomeDetailed = ({ mobile }) => (
  <LShell>
    <LMasthead section="home" mobile={mobile} />
    <div style={{ flex: 1, overflow: 'auto', padding: mobile ? '14px 18px 28px' : '18px 32px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>

      {/* STATUS with confidence band */}
      <section>
        <LSectionHeader right={<span style={{ color: L_T.muted, letterSpacing: '0.1em' }}>★★★★☆ · CONF {L.plan.debtFreeConfidence}%</span>}>
          STATUS · CONFIDENCE BAND
        </LSectionHeader>
        <LKpi mobile={mobile} cols={mobile ? 2 : 5} items={[
          { l: 'CLEAR · CENTRAL', v: L.plan.debtFreeCentral.toUpperCase(),  s: 'P50',                                       tone: L_T.ink },
          { l: 'CLEAR · BAND',    v: 'JUL–OCT \'27',                        s: `P10 → P90`,                                 tone: L_T.muted },
          { l: 'OUTSTANDING',     v: L.plan.totalOutstanding,               s: `${L.plan.totalOutstandingMTD} MTD`,        tone: L_T.ink },
          { l: 'EFFECTIVE APR',   v: L.plan.weightedAPR,                    s: 'WEIGHTED · POST-TAX',                       tone: L_T.ink },
          { l: 'NEXT',            v: 'KOTAK · ₹18,500',                     s: 'DUE 1 JUN',                                 tone: L_T.accent },
        ]} />
      </section>

      {/* TRAJECTORY ASCII */}
      <section>
        <LSectionHeader right={<><LBracket>CSV</LBracket> <LBracket>PRINT</LBracket></>}>TRAJECTORY · 240MO HORIZON</LSectionHeader>
        <LTrajectory mobile={mobile} />
      </section>

      {/* DEBTS TABLE */}
      <section>
        <LSectionHeader right={<LBracket>+ ADD DEBT</LBracket>}>OPEN POSITIONS · {L.debts.length}</LSectionHeader>
        <LDebtsTable mobile={mobile} showShield />
      </section>

      {/* PLAN DIAGNOSTICS */}
      <section>
        <LSectionHeader>SENSITIVITY · WHAT IF</LSectionHeader>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${mobile ? 2 : 4}, 1fr)`, gap: 1, background: L_T.ink, padding: 1 }}>
          {L.diagnostics.map((d, i) => (
            <div key={i} style={{ background: L_T.bg, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: L_T.muted, letterSpacing: '0.1em' }}>{d.label.toUpperCase()}</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4, color: d.tone === 'pos' ? L_T.positive : L_T.negative }}>{d.delta}</div>
              <div style={{ fontSize: 10, color: L_T.muted, marginTop: 2 }}>{d.interest}</div>
            </div>
          ))}
        </div>
      </section>

      {/* INSIGHT */}
      <section style={{ border: `1px solid ${L_T.ink}`, padding: '12px 16px' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 6 }}>$ INSIGHT · 14 MAY</div>
        <div style={{ fontSize: 12, color: L_T.ink }}>
          Real Kotak rate = <span style={{ color: L_T.accent, fontWeight: 700 }}>42.48%</span> after 1.5% monthly fee + 18% GST.
          {' '}<LBracket>show formula ↓</LBracket>
        </div>
      </section>
    </div>
    <LFooter mode="DETAILED" mobile={mobile} />
  </LShell>
);

// ═══════════════════════════════════════════════════════════════════════
// HOME — Overwhelmed (the soft statement, hides totals)
// ═══════════════════════════════════════════════════════════════════════
const LHomeOverwhelmed = ({ mobile }) => (
  <LShell>
    <LMasthead section="home" mobile={mobile} stmt="#SOFT" />
    <div style={{ flex: 1, overflow: 'auto', padding: mobile ? '40px 22px' : '60px 32px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
      <div style={{ maxWidth: 520, width: '100%', border: `2px solid ${L_T.ink}`, padding: mobile ? '24px 22px' : '32px 28px', background: L_T.paper }}>
        <div style={{ fontSize: 10, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 16 }}>
          ┌── SOFT VIEW · ONE STEP ──┐
        </div>
        <div style={{ fontSize: 13, color: L_T.muted, marginBottom: 22, lineHeight: 1.7 }}>
          TAKE A BREATH. YOU'RE GOING TO BE OKAY.
        </div>
        <div style={{ fontSize: mobile ? 20 : 24, fontWeight: 700, lineHeight: 1.35, letterSpacing: '-0.01em' }}>
          PAY ₹18,500 TO YOUR<br />KOTAK CREDIT CARD.
        </div>
        <div style={{ fontSize: 12, color: L_T.muted, marginTop: 18, lineHeight: 1.7 }}>
          THE SINGLE MOST USEFUL THING YOU CAN DO RIGHT NOW.<br />
          NOTHING ELSE NEEDS TO BE DECIDED TODAY.
        </div>
        <div style={{ marginTop: 24 }}>
          <button style={{ width: '100%', padding: 14, background: L_T.ink, color: L_T.bg, border: 'none', fontFamily: L_mono, fontSize: 13, letterSpacing: '0.14em', fontWeight: 700, cursor: 'pointer' }}>
            [ I'LL DO THIS ]
          </button>
        </div>
        <div style={{ fontSize: 10, color: L_T.muted, letterSpacing: '0.14em', textAlign: 'center', marginTop: 14 }}>
          OR · <LBracket>SEE THE FULL STATEMENT</LBracket>
        </div>
        <div style={{ fontSize: 10, letterSpacing: '0.18em', color: L_T.muted, marginTop: 20, textAlign: 'right' }}>
          └────────────────────────┘
        </div>
      </div>
      <div style={{ maxWidth: 480, fontSize: 11, color: L_T.muted, textAlign: 'center', lineHeight: 1.7, letterSpacing: '0.04em' }}>
        TOTALS, TRAJECTORIES, AND THE OTHER DEBTS ARE HIDDEN ON PURPOSE.<br />
        THEY'LL STILL BE HERE WHEN YOU'RE READY.
      </div>
    </div>
    <LFooter mode="SIMPLE" tone="OVERWHELMED" mobile={mobile} />
  </LShell>
);

// ──── Reusable: ledger debts table ────────────────────────────────────
const LDebtsTable = ({ mobile, showShield }) => (
  <div style={{ overflowX: 'auto' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: mobile ? 600 : 0 }}>
      <thead>
        <tr style={{ borderTop: `2px solid ${L_T.ink}`, borderBottom: `1px solid ${L_T.ink}` }}>
          {['#', 'LENDER', 'TYPE', 'RATE', 'EFFECTIVE', showShield ? 'POST-TAX' : null, 'OUTSTANDING', 'EMI', 'TENURE', 'NEXT'].filter(Boolean).map((h, i) => (
            <th key={i} style={{
              padding: '8px 12px', textAlign: i > 2 ? 'right' : 'left',
              fontWeight: 700, letterSpacing: '0.08em', fontSize: 10, color: L_T.muted,
            }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {L.debts.map((d, i) => (
          <tr key={i} style={{ borderBottom: `1px dashed ${L_T.faint}`, background: d.isHighest ? L_T.highlight : 'transparent' }}>
            <td style={{ padding: '10px 12px', color: L_T.muted }}>{String(d.rank).padStart(2, '0')}</td>
            <td style={{ padding: '10px 12px', fontWeight: 700 }}>{d.bank.toUpperCase()}</td>
            <td style={{ padding: '10px 12px', color: L_T.muted }}>{d.type}</td>
            <td style={{ padding: '10px 12px', textAlign: 'right' }}>{d.nominal}</td>
            <td style={{ padding: '10px 12px', textAlign: 'right', color: d.isHighest ? L_T.negative : L_T.ink, fontWeight: d.isHighest ? 700 : 500 }}>{d.effective}</td>
            {showShield && (
              <td style={{ padding: '10px 12px', textAlign: 'right', color: d.shieldNote ? L_T.positive : L_T.ink, fontWeight: 500 }}>
                {d.effectivePostTax}
                {d.shieldNote && <div style={{ fontSize: 9, color: L_T.positive, marginTop: 2 }}>{d.shieldNote.toUpperCase()}</div>}
              </td>
            )}
            <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>{d.outstanding}</td>
            <td style={{ padding: '10px 12px', textAlign: 'right' }}>{d.emi}</td>
            <td style={{ padding: '10px 12px', textAlign: 'right', color: L_T.muted }}>{d.tenure}</td>
            <td style={{ padding: '10px 12px', textAlign: 'right', color: d.isHighest ? L_T.accent : L_T.muted, fontWeight: d.isHighest ? 700 : 400 }}>{d.next}</td>
          </tr>
        ))}
        <tr style={{ borderTop: `2px solid ${L_T.ink}` }}>
          <td colSpan={showShield ? 6 : 5} style={{ padding: '10px 12px', color: L_T.muted, letterSpacing: '0.1em', fontSize: 10 }}>TOTAL</td>
          <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>{L.plan.totalOutstanding}</td>
          <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>₹51,800</td>
          <td colSpan={2}></td>
        </tr>
      </tbody>
    </table>
  </div>
);

// ──── ASCII / mini trajectory chart ────────────────────────────────────
const LTrajectory = ({ mobile }) => {
  const w = mobile ? 320 : 800, h = mobile ? 160 : 200;
  const pts = L.trajectoryPath;
  const toX = (t) => 40 + t * (w - 50);
  const toY = (v) => h - 30 - v * (h - 50);
  const path = (key) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.t).toFixed(1)},${toY(p[key]).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <div style={{ border: `2px solid ${L_T.ink}`, padding: '8px 12px 4px', background: L_T.paper }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
        {[0, 0.25, 0.5, 0.75, 1].map((g, i) => (
          <line key={i} x1={40} x2={w - 10} y1={toY(g)} y2={toY(g)} stroke={i === 0 || i === 4 ? L_T.ink : L_T.faint} strokeWidth={i === 0 || i === 4 ? 1 : 0.4} strokeDasharray={i === 0 || i === 4 ? '' : '2 3'} />
        ))}
        {[{ y: 1, l: '₹41L' }, { y: 0.5, l: '₹20L' }, { y: 0, l: '₹0' }].map((g, i) => (
          <text key={i} x={32} y={toY(g.y) + 3} fontFamily={L_mono} fontSize="9" fill={L_T.muted} textAnchor="end">{g.l}</text>
        ))}
        <path d={path('min')} stroke={L_T.muted} strokeWidth="1" fill="none" strokeDasharray="4 3" />
        <path d={path('av')}  stroke={L_T.ink} strokeWidth="2" fill="none" />
        <rect x={toX(last.t) - 4} y={toY(last.av) - 4} width="8" height="8" fill={L_T.accent} />
        <text x={toX(last.t) - 8} y={toY(last.av) - 10} fontFamily={L_mono} fontSize="10" fill={L_T.accent} fontWeight="700" textAnchor="end">AUG '27 · CLEAR</text>
        {['MAY 26', 'NOV 26', 'MAY 27', 'NOV 27', 'MAY 28'].map((d, i) => (
          <text key={i} x={toX(i / 4)} y={h - 6} fontFamily={L_mono} fontSize="9" fill={L_T.muted} textAnchor="middle">{d}</text>
        ))}
      </svg>
    </div>
  );
};

Object.assign(window, {
  LHomeSimple, LHomeDetailed, LHomeOverwhelmed,
  LShell, LMasthead, LFooter, LSectionHeader, LKpi, LRule, LBracket, LDebtsTable, LTrajectory,
  L_T, L_mono,
});
