// ═══════════════════════════════════════════════════════════════════════
// LEDGER SKIN — Plan, Debts, Insights, Onboarding, Tools, Windfall
// ═══════════════════════════════════════════════════════════════════════
const _L = window.APP;

// ───────────────────────────────────────────────────────────────────────
// PLAN — statement-style
// ───────────────────────────────────────────────────────────────────────
const LPlanScreen = ({ mobile }) => (
  <LShell>
    <LMasthead section="plan" mobile={mobile} stmt="#1138-PLAN" />
    <div style={{ flex: 1, overflow: 'auto', padding: mobile ? '14px 18px 28px' : '18px 32px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>

      <section>
        <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 6 }}>
          $ PLAN · STRATEGY=AVALANCHE · HORIZON=240MO · MARGINAL=30% · CONF={_L.plan.debtFreeConfidence}%
        </div>
        <LKpi mobile={mobile} cols={mobile ? 2 : 4} items={[
          { l: 'CLEAR DATE',     v: 'AUG 2027',                              s: '17MO · BAND JUL–OCT', tone: L_T.ink },
          { l: 'TOTAL INTEREST', v: _L.plan.totalInterestAvalanche,          s: `VS ${_L.plan.totalInterestMinimums} BASE`, tone: L_T.positive },
          { l: 'MONTHS SAVED',   v: String(_L.plan.monthsSaved),             s: 'VS MINIMUMS BASELINE', tone: L_T.accent },
          { l: 'MONTHLY OUTLAY', v: _L.plan.monthlyOutlay,                   s: 'SCHEDULED + ALLOC',   tone: L_T.ink },
        ]} />
      </section>

      {/* Trajectory */}
      <section>
        <LSectionHeader right={<><LBracket>CSV</LBracket> <LBracket>PRINT</LBracket></>}>TRAJECTORY · TOTAL DEBT OVER TIME</LSectionHeader>
        <LTrajectory mobile={mobile} />
        <div style={{ display: 'flex', gap: 18, fontSize: 10, color: L_T.muted, marginTop: 8, letterSpacing: '0.1em' }}>
          <span><span style={{ display: 'inline-block', width: 14, height: 2, background: L_T.ink, verticalAlign: 'middle', marginRight: 6 }} />AVALANCHE</span>
          <span><span style={{ display: 'inline-block', width: 14, borderTop: `2px dashed ${L_T.muted}`, verticalAlign: 'middle', marginRight: 6 }} />MINIMUMS</span>
        </div>
      </section>

      {/* Restructure */}
      <section>
        <LSectionHeader right={<span style={{ color: L_T.positive, fontWeight: 700 }}>SAVES {_L.totalAnnualSaving}/YR</span>}>
          RESTRUCTURE · LAYER 1 (RE-PRICE BEFORE ACCELERATE)
        </LSectionHeader>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ borderTop: `2px solid ${L_T.ink}`, borderBottom: `1px solid ${L_T.ink}` }}>
              {['KIND', 'FROM', 'TO', 'Δ RATE', 'BREAKEVEN', 'SAVES/Y', 'STATUS'].map((h, i) => (
                <th key={i} style={{ padding: '8px 12px', textAlign: i > 2 ? 'right' : 'left', fontWeight: 700, letterSpacing: '0.08em', fontSize: 10, color: L_T.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {_L.opportunities.map((opp, i) => (
              <tr key={i} style={{ borderBottom: `1px dashed ${L_T.faint}` }}>
                <td style={{ padding: '12px 12px', fontWeight: 700, color: L_T.accent }}>{opp.kind}</td>
                <td style={{ padding: '12px 12px' }}>{opp.from} ({i === 0 ? 'KOTAK CARD' : 'HDFC HOME'})</td>
                <td style={{ padding: '12px 12px' }}>{opp.to} ({i === 0 ? 'HDFC BT' : 'ICICI REFI'})</td>
                <td style={{ padding: '12px 12px', textAlign: 'right', color: L_T.positive }}>−{i === 0 ? '26.48' : '0.45'}pp</td>
                <td style={{ padding: '12px 12px', textAlign: 'right' }}>{opp.breakevenWeeks}w</td>
                <td style={{ padding: '12px 12px', textAlign: 'right', color: L_T.positive, fontWeight: 700 }}>{opp.savesAnnual}</td>
                <td style={{ padding: '12px 12px', textAlign: 'right' }}><LBracket>{opp.status}</LBracket></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Amortisation schedule */}
      <section>
        <LSectionHeader right={<><LBracket>CSV</LBracket> <LBracket>PRINT</LBracket> <LBracket>↓ EXPAND ALL 240</LBracket></>}>
          AMORTISATION · NEXT 12 MO
        </LSectionHeader>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: mobile ? 700 : 0 }}>
            <thead>
              <tr style={{ borderTop: `2px solid ${L_T.ink}`, borderBottom: `1px solid ${L_T.ink}` }}>
                {['MO', 'DATE', 'KOTAK', 'HDFC PL', 'SBI', 'HDFC HL', 'EXTRA', 'INT PAID', 'PRIN', 'BALANCE', 'EVENT'].map((h, i) => (
                  <th key={i} style={{ padding: '6px 10px', textAlign: i < 2 ? 'left' : 'right', fontWeight: 700, fontSize: 9, color: L_T.muted, letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { mo: '01', d: 'JUN 26', a: '18,500', b: '11,400', c: '5,200',  hl: '35,200', x: '0',      i: '6,840',  pr: '63,460', b2: '40,80,000', ev: '' },
                { mo: '02', d: 'JUL 26', a: '0',      b: '11,400', c: '5,200',  hl: '35,200', x: '18,500', i: '4,210',  pr: '66,090', b2: '40,14,000', ev: '⊕ KOTAK CLEARED', hl: true },
                { mo: '03', d: 'AUG 26', a: '—',      b: '11,400', c: '5,200',  hl: '35,200', x: '18,500', i: '4,030',  pr: '66,270', b2: '39,48,000', ev: '' },
                { mo: '04', d: 'SEP 26', a: '—',      b: '11,400', c: '5,200',  hl: '35,200', x: '18,500', i: '3,940',  pr: '66,360', b2: '38,81,000', ev: '' },
                { mo: '05', d: 'OCT 26', a: '—',      b: '11,400', c: '5,200',  hl: '35,200', x: '18,500', i: '3,850',  pr: '66,450', b2: '38,15,000', ev: '⊙ ANN. REVIEW', hl: true },
                { mo: '06', d: 'NOV 26', a: '—',      b: '11,400', c: '5,200',  hl: '35,200', x: '18,500', i: '3,760',  pr: '66,540', b2: '37,48,000', ev: '' },
                { mo: '07', d: 'DEC 26', a: '—',      b: '11,400', c: '5,200',  hl: '35,200', x: '18,500', i: '3,670',  pr: '66,630', b2: '36,82,000', ev: '⊙ HDFC HL RESET', hl: true },
                { mo: '08', d: 'JAN 27', a: '—',      b: '11,400', c: '5,200',  hl: '35,200', x: '18,500', i: '3,580',  pr: '66,720', b2: '36,15,000', ev: '' },
                { mo: '09', d: 'FEB 27', a: '—',      b: '0',      c: '5,200',  hl: '35,200', x: '29,900', i: '3,250',  pr: '67,050', b2: '35,48,000', ev: '⊕ HDFC PL CLEARED', hl: true },
                { mo: '10', d: 'MAR 27', a: '—',      b: '—',      c: '5,200',  hl: '35,200', x: '29,900', i: '3,160',  pr: '67,140', b2: '34,81,000', ev: '' },
              ].map((r, i) => (
                <tr key={i} style={{ borderBottom: `1px dashed ${L_T.faint}`, background: r.hl ? L_T.highlight : 'transparent' }}>
                  <td style={{ padding: '6px 10px' }}>{r.mo}</td>
                  <td style={{ padding: '6px 10px' }}>{r.d}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}>{r.a}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}>{r.b}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}>{r.c}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}>{r.hl}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', color: L_T.accent }}>{r.x}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', color: L_T.negative }}>{r.i}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', color: L_T.positive }}>{r.pr}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>{r.b2}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontSize: 9, fontWeight: 700 }}>{r.ev}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* What-if sliders, command-line style */}
      <section style={{ border: `2px solid ${L_T.ink}`, padding: mobile ? '14px 16px' : '18px 22px' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 12 }}>$ SENSITIVITY · LIVE ENGINE</div>
        {[
          { cmd: 'SET SURPLUS_DELTA',  val: '+₹15,000/mo',         fill: 30, mo: '−6 MO', int: '−₹28,400', tone: 'pos' },
          { cmd: 'SET RATE_SHOCK',     val: '+150 bps',            fill: 70, mo: '+4 MO', int: '+₹19,200', tone: 'neg' },
          { cmd: 'SET LUMP_SUM',       val: '₹2,00,000 → HDFC HL', fill: 40, mo: '−3 MO', int: '−₹42,800', tone: 'pos' },
        ].map((s, i) => (
          <div key={i} style={{ padding: '12px 0', borderTop: i > 0 ? `1px dashed ${L_T.faint}` : 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, fontSize: 11, gap: 8 }}>
              <span style={{ color: L_T.muted }}>$ {s.cmd} =</span>
              <span style={{ color: L_T.ink, fontWeight: 700 }}>{s.val}</span>
            </div>
            <div style={{ position: 'relative', height: 6, background: L_T.ruleSoft, margin: '8px 0' }}>
              <div style={{ position: 'absolute', height: '100%', width: s.fill + '%', background: L_T.ink }} />
              <div style={{ position: 'absolute', top: '50%', left: s.fill + '%', width: 12, height: 12, background: L_T.accent, transform: 'translate(-50%, -50%)' }} />
            </div>
            <div style={{ display: 'flex', gap: 18, fontSize: 11, color: L_T.muted }}>
              <span>→ DEBT-FREE <span style={{ color: s.tone === 'pos' ? L_T.positive : L_T.negative, fontWeight: 700 }}>{s.mo}</span></span>
              <span>→ INTEREST <span style={{ color: s.tone === 'pos' ? L_T.positive : L_T.negative, fontWeight: 700 }}>{s.int}</span></span>
            </div>
          </div>
        ))}
      </section>
    </div>
  </LShell>
);

// ───────────────────────────────────────────────────────────────────────
// DEBTS — full ledger
// ───────────────────────────────────────────────────────────────────────
const LDebtsScreen = ({ mobile }) => (
  <LShell>
    <LMasthead section="debts" mobile={mobile} stmt="#1138-DEBTS" />
    <div style={{ flex: 1, overflow: 'auto', padding: mobile ? '14px 18px 28px' : '18px 32px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <section>
        <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 6 }}>
          $ DEBTS · 4 OPEN · WEIGHTED EFFECTIVE APR {_L.plan.weightedAPR}
        </div>
        <LKpi mobile={mobile} cols={mobile ? 2 : 4} items={[
          { l: 'TOTAL OUTSTANDING', v: _L.plan.totalOutstanding, s: `${_L.plan.totalOutstandingMTD} MTD`, tone: L_T.ink },
          { l: 'WEIGHTED APR',      v: _L.plan.weightedAPR,      s: 'POST-TAX', tone: L_T.ink },
          { l: 'TOTAL EMI',         v: '₹51,800/MO',            s: '+ ALLOC ₹18.5K', tone: L_T.ink },
          { l: 'NEXT RESET',        v: '47 D',                   s: 'HDFC HL FLOATING', tone: L_T.accent },
        ]} />
      </section>

      <section>
        <LSectionHeader right={<LBracket>+ ADD DEBT</LBracket>}>OPEN POSITIONS · DETAILED</LSectionHeader>
        <LDebtsTable mobile={mobile} showShield />
      </section>

      {/* Detail panel for highlighted */}
      <section style={{ border: `2px solid ${L_T.accent}`, padding: mobile ? '14px 16px' : '18px 22px' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.accent, fontWeight: 700, marginBottom: 8 }}>$ HIGHLIGHTED · LOUDEST DEBT</div>
        <div style={{ fontSize: mobile ? 16 : 18, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 8 }}>
          {_L.debts[0].bank.toUpperCase()} · {_L.debts[0].product.toUpperCase()}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginTop: 8 }}>
          <tbody>
            {[
              ['NOMINAL RATE', _L.debts[0].nominal, 'PUBLISHED APR'],
              ['EFFECTIVE',    _L.debts[0].effective, '+ 1.5% MONTHLY FEE + 18% GST'],
              ['OUTSTANDING',  _L.debts[0].outstanding, '100% UTILISATION'],
              ['MONTHLY INT',  '₹3,540',  'PURE FRICTION'],
              ['VS NEXT',      '+₹2,420',  'MORE THAN HDFC PL + SBI AUTO COMBINED'],
            ].map((r, i) => (
              <tr key={i} style={{ borderBottom: `1px dashed ${L_T.faint}` }}>
                <td style={{ padding: '6px 0', color: L_T.muted, width: 160, letterSpacing: '0.08em' }}>{r[0]}</td>
                <td style={{ padding: '6px 0', fontWeight: 700, color: i === 1 ? L_T.negative : L_T.ink, width: 120 }}>{r[1]}</td>
                <td style={{ padding: '6px 0', color: L_T.muted, fontSize: 10, letterSpacing: '0.06em' }}>{r[2]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <LBracket active>BALANCE TRANSFER →</LBracket>
          <LBracket>SHOW MATH</LBracket>
          <LBracket>MARK PAID</LBracket>
        </div>
      </section>
    </div>
  </LShell>
);

// ───────────────────────────────────────────────────────────────────────
// INSIGHTS / NOTES
// ───────────────────────────────────────────────────────────────────────
const LInsightsScreen = ({ mobile }) => (
  <LShell>
    <LMasthead section="insights" mobile={mobile} stmt="#1138-NOTES" />
    <div style={{ flex: 1, overflow: 'auto', padding: mobile ? '14px 18px 28px' : '18px 32px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <section>
        <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 6 }}>
          $ NOTES · ENGINE OUTPUT · {_L.insights.length} ENTRIES · LAST UPDATED {_L.user.today.toUpperCase()}
        </div>
        <LRule length={300} />
      </section>

      {_L.insights.map((n, i) => (
        <section key={i} style={{ paddingBottom: 18, borderBottom: i < _L.insights.length - 1 ? `1px dashed ${L_T.faint}` : 'none' }}>
          <div style={{ display: 'flex', gap: 14, fontSize: 10, color: L_T.muted, letterSpacing: '0.12em', marginBottom: 10, flexWrap: 'wrap' }}>
            <span>NO. {String(i + 1).padStart(3, '0')}</span>
            <span>· {n.date.toUpperCase()}</span>
            <span style={{ color: L_T.accent, fontWeight: 700 }}>· {n.eyebrow}</span>
            <span style={{ marginLeft: 'auto' }}>{n.tags.map((t) => `#${t}`).join('  ')}</span>
          </div>
          <h2 style={{ fontFamily: L_mono, fontSize: mobile ? 16 : 20, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 8, lineHeight: 1.25 }}>
            {n.title.toUpperCase()}
          </h2>
          <p style={{ fontSize: 12, color: L_T.ink, lineHeight: 1.7 }}>{n.body}</p>
          <div style={{ marginTop: 10 }}>
            <LBracket>OPEN FULL NOTE →</LBracket>
          </div>
        </section>
      ))}
    </div>
  </LShell>
);

// ───────────────────────────────────────────────────────────────────────
// ONBOARDING — six-step form
// ───────────────────────────────────────────────────────────────────────
const LOnboardingScreen = ({ mobile }) => {
  const cur = _L.onboarding.currentStep - 1;
  const steps = _L.onboarding.steps;
  return (
    <LShell>
      <LMasthead section="setup" mobile={mobile} stmt="#SETUP" />
      <div style={{ flex: 1, overflow: 'auto', padding: mobile ? '14px 18px 28px' : '18px 32px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <section>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 6 }}>
            $ SETUP · STEP {cur + 1} OF 6 · NO ACCOUNT · NO UPLOAD
          </div>
          {/* Step rail */}
          <div style={{ display: 'flex', gap: 1, background: L_T.ink, padding: 1 }}>
            {steps.map((s, i) => (
              <div key={i} style={{
                flex: 1, background: i === cur ? L_T.ink : L_T.bg,
                color: i === cur ? L_T.bg : (i < cur ? L_T.muted : L_T.faint),
                padding: '10px 10px', fontSize: 10, letterSpacing: '0.12em',
                textAlign: 'center', fontWeight: i === cur ? 700 : 500,
              }}>
                {String(s.n).padStart(2, '0')} · {s.label.toUpperCase()}
              </div>
            ))}
          </div>
        </section>

        <section>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.accent, fontWeight: 700, marginBottom: 4 }}>
            $ STEP {cur + 1} · {steps[cur].label.toUpperCase()}
          </div>
          <div style={{ fontSize: mobile ? 18 : 22, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 6 }}>{steps[cur].title.toUpperCase()}</div>
          <div style={{ fontSize: 12, color: L_T.muted, marginBottom: 16 }}>{steps[cur].desc}</div>
        </section>

        {/* Loans table-style form */}
        {[0, 1].map((idx) => (
          <section key={idx} style={{ border: `1px solid ${L_T.ink}`, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, fontWeight: 700, marginBottom: 10 }}>
              $ LOAN {String.fromCharCode(65 + idx)} · {idx === 0 ? 'CREDIT_CARD' : 'HOME_LOAN'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 14 }}>
              <LField label="BANK" value={idx === 0 ? 'KOTAK' : 'HDFC'} />
              <LField label="OUTSTANDING" value={idx === 0 ? '1,00,000' : '36,60,000'} prefix="₹" />
              <LField label="NOMINAL RATE" value={idx === 0 ? '0.36' : '0.085'} hint={idx === 0 ? '= 36.00%' : '= 8.50%'} />
              <LField label="RATE TYPE" value={idx === 0 ? 'FIXED' : 'FLOATING'} />
              <LField label="TENURE / MO" value={idx === 0 ? '0' : '180'} hint={idx === 0 ? 'REVOLVING' : ''} />
              <LField label="SCHEDULED EMI" value={idx === 0 ? '0' : '35,200'} prefix="₹" />
              {idx === 1 && <LField label="RESET CYCLE" value="47" hint="DAYS" />}
              {idx === 1 && <LField label="TAX SHIELD" value="SEC 24" />}
            </div>
          </section>
        ))}

        <section>
          <LBracket accent>+ ADD ANOTHER LOAN</LBracket>
        </section>

        <section style={{ borderTop: `2px solid ${L_T.ink}`, paddingTop: 18, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <LBracket>← BACK</LBracket>
          <button style={{ padding: '10px 20px', background: L_T.ink, color: L_T.bg, border: 'none', fontFamily: L_mono, fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', cursor: 'pointer' }}>
            [ CONTINUE → SAVINGS ]
          </button>
        </section>
      </div>
    </LShell>
  );
};

const LField = ({ label, value, hint, prefix }) => (
  <div>
    <div style={{ fontSize: 9, letterSpacing: '0.14em', color: L_T.muted, marginBottom: 4 }}>{label}</div>
    <div style={{ borderBottom: `2px solid ${L_T.ink}`, padding: '6px 2px', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
      {prefix && <span style={{ color: L_T.muted }}>{prefix}</span>}
      <span>{value}</span>
    </div>
    {hint && <div style={{ fontSize: 9, color: L_T.muted, marginTop: 4, letterSpacing: '0.08em' }}>{hint}</div>}
  </div>
);

// ───────────────────────────────────────────────────────────────────────
// TOOLS index — list view
// ───────────────────────────────────────────────────────────────────────
const LToolsIndex = ({ mobile }) => (
  <LShell>
    <LMasthead section="tools" mobile={mobile} stmt="#TOOLS" />
    <div style={{ flex: 1, overflow: 'auto', padding: mobile ? '14px 18px 28px' : '18px 32px 32px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <section>
        <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 6 }}>$ TOOLS · 7 · ONE QUESTION EACH</div>
        <LRule length={300} />
      </section>

      <section>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${L_T.ink}` }}>
              {['§', 'TOOL', 'QUESTION', 'WHAT IT DOES', ''].map((h, i) => (
                <th key={i} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, fontSize: 9, color: L_T.muted, letterSpacing: '0.1em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {_L.tools.map((t, i) => (
              <tr key={t.id} style={{ borderBottom: `1px dashed ${L_T.faint}` }}>
                <td style={{ padding: '14px 10px', color: L_T.accent, fontWeight: 700, letterSpacing: '0.08em' }}>§{t.tag.toUpperCase()}</td>
                <td style={{ padding: '14px 10px', fontWeight: 700 }}>{t.name.toUpperCase()}</td>
                <td style={{ padding: '14px 10px' }}>{t.q}</td>
                <td style={{ padding: '14px 10px', color: L_T.muted, fontSize: 11 }}>{t.sub}</td>
                <td style={{ padding: '14px 10px', textAlign: 'right' }}><LBracket accent>OPEN →</LBracket></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  </LShell>
);

// ───────────────────────────────────────────────────────────────────────
// TOOL — Windfall as a transaction slip
// ───────────────────────────────────────────────────────────────────────
const LWindfallScreen = ({ mobile }) => {
  const w = _L.windfall;
  return (
    <LShell>
      <LMasthead section="tools" mobile={mobile} stmt="§8a-WINDFALL" />
      <div style={{ flex: 1, overflow: 'auto', padding: mobile ? '14px 18px 28px' : '18px 32px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>

        <section>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 6 }}>
            $ §8a · WINDFALL · ALLOCATE A LUMP-SUM INFLOW
          </div>
          <div style={{ fontSize: mobile ? 20 : 26, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 4 }}>
            GOT A BONUS? WHERE SHOULD IT GO?
          </div>
        </section>

        {/* Input box */}
        <section style={{ border: `1px solid ${L_T.ink}`, padding: mobile ? '14px 16px' : '16px 22px' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 12 }}>$ INPUT</div>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr 1fr', gap: 16 }}>
            <LField label="AMOUNT" value="1,00,000" prefix="₹" />
            <LField label="FROM" value="ANNUAL BONUS" hint="TAXABLE" />
            <LField label="WHEN RECEIVED" value="14 MAY 2026" />
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: L_T.muted, letterSpacing: '0.04em' }}>
            ENGINE CONSIDERS: HIGHEST EFFECTIVE APR · EF SHORTFALL · INVESTMENT OPTIONS · {Math.round(_L.user.marginalRate*100)}% MARGINAL RATE
          </div>
        </section>

        {/* Verdict block */}
        <section style={{ border: `2px solid ${L_T.ink}`, padding: mobile ? '16px 18px' : '22px 26px' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.accent, fontWeight: 700, marginBottom: 10 }}>$ VERDICT</div>
          <div style={{ fontSize: mobile ? 20 : 26, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.25, marginBottom: 8 }}>
            ALLOCATE 100% → KOTAK CARD
          </div>
          <div style={{ fontSize: 12, color: L_T.muted, marginBottom: 18 }}>
            42.48% EFFECTIVE APR &gt; 4.76% LIQUID AFTER-TAX · GAP 37.72PP
          </div>

          {/* Allocation bar */}
          <div style={{ fontSize: 10, letterSpacing: '0.12em', color: L_T.muted, marginBottom: 6 }}>ALLOCATION</div>
          <div style={{ display: 'flex', height: 26, border: `1px solid ${L_T.ink}` }}>
            <div style={{ flex: 100, background: L_T.accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em' }}>100% · KOTAK CC · ₹1,00,000</div>
          </div>

          {/* Outcome KPI */}
          <div style={{ marginTop: 18 }}>
            <LKpi mobile={mobile} cols={mobile ? 2 : 4} items={[
              { l: 'INTEREST AVOIDED', v: w.interestAvoided, s: '12-MO HORIZON', tone: L_T.positive },
              { l: 'NEW DEBT-FREE',    v: w.debtFreeAfter.toUpperCase(),   s: w.debtFreeDelta.toUpperCase(), tone: L_T.ink },
              { l: 'SCORE IMPACT',     v: '+18 / +28',       s: 'PTS · 90D', tone: L_T.positive },
              { l: 'EF COVERAGE',      v: '50%',             s: 'UNCHANGED' },
            ]} />
          </div>

          <div style={{ marginTop: 18, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button style={{ padding: '10px 16px', background: L_T.ink, color: L_T.bg, border: 'none', fontFamily: L_mono, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', cursor: 'pointer' }}>
              [ APPLY &amp; RECOMPUTE ]
            </button>
            <LBracket>TWEAK INPUTS</LBracket>
            <LBracket>SAVE BRIEF</LBracket>
          </div>
        </section>

        {/* Math block */}
        <section style={{ border: `1px solid ${L_T.faint}`, padding: '14px 18px', background: L_T.paper }}>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 8 }}>$ THE MATH</div>
          <div style={{ fontSize: 12, color: L_T.ink, lineHeight: 1.8 }}>
            <div>highest_eff_apr   = 42.48%   <span style={{ color: L_T.muted }}>(KOTAK CC · POST-GST)</span></div>
            <div>liquid_after_tax  =  4.76%   <span style={{ color: L_T.muted }}>(6.8% × (1 − 0.30))</span></div>
            <div>ef_shortfall      =  0       <span style={{ color: L_T.muted }}>(EF AT 50% TARGET · NO PRIORITY)</span></div>
            <div>action            =  pay_highest_debt</div>
            <div>interest_avoided  =  100,000 × 0.4248 × (7/12) = <span style={{ color: L_T.positive, fontWeight: 700 }}>₹{Math.round(100000*0.4248*7/12).toLocaleString('en-IN')}</span></div>
            <div>score_delta_p10p90 = +18 ↔ +28  <span style={{ color: L_T.muted }}>(CIBIL · 90D · UTIL 100→0)</span></div>
          </div>
        </section>
      </div>
    </LShell>
  );
};

Object.assign(window, {
  LPlanScreen, LDebtsScreen, LInsightsScreen, LOnboardingScreen, LToolsIndex, LWindfallScreen,
});
