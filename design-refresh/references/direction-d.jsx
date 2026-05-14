// Direction D — "The Ledger"
// Brutalist, monospaced, no rounded corners, ASCII rules.
// Reads like a printed bank statement crossed with a terminal session.
// Hyper-functional. Every number is there. No "design polish" — just structure.

const D_T = {
  bg: '#fbfaf3',       // warm paper
  paper: '#ffffff',
  ink: '#0a0a0a',
  rule: '#0a0a0a',
  faint: '#a8a8a3',
  muted: '#5e5e58',
  accent: '#b91c1c',
  positive: '#15803d',
  negative: '#b91c1c',
  highlight: '#fff3a3',
};
const D_mono = "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace";
const D_sans = D_mono;

const DShell = ({ children }) => (
  <div style={{
    width: '100%', height: '100%', background: D_T.bg, color: D_T.ink,
    fontFamily: D_mono, fontSize: 12, lineHeight: 1.55,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  }}>{children}</div>
);

const Rule = ({ char = '─', length = 100 }) => (
  <div style={{ whiteSpace: 'pre', overflow: 'hidden', color: D_T.ink, fontWeight: 700 }}>
    {char.repeat(length)}
  </div>
);

const DHeader = ({ section, day = 'THU, 14 MAY 2026' }) => (
  <div style={{ padding: '14px 32px 0' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.18em' }}>
        FINOPTIMA<span style={{ color: D_T.muted, fontWeight: 400 }}> / LEDGER</span>
      </div>
      <div style={{ fontSize: 11, color: D_T.muted, letterSpacing: '0.1em' }}>
        {day} · 14:32 IST · STMT #1138
      </div>
    </div>
    <div style={{ margin: '8px 0 0' }}>
      <Rule length={200} />
    </div>
    <div style={{ display: 'flex', gap: 24, padding: '8px 0', fontSize: 11, letterSpacing: '0.1em' }}>
      {['LEDGER', 'PLAN', 'DEBTS', 'TOOLS', 'INSIGHTS', 'SETUP'].map((t) => (
        <span key={t} style={{
          color: t === section ? D_T.ink : D_T.muted,
          fontWeight: t === section ? 700 : 500,
          textDecoration: t === section ? 'underline' : 'none',
          textDecorationThickness: t === section ? 2 : 0,
          textUnderlineOffset: 4,
          cursor: 'pointer',
        }}>[{t}]</span>
      ))}
    </div>
    <Rule length={200} />
  </div>
);

// ─── LEDGER (HOME) ────────────────────────────────────────────────────────
const DHome = () => (
  <DShell>
    <DHeader section="LEDGER" />

    <div style={{ flex: 1, padding: '18px 32px 32px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 22 }}>

      {/* HEADLINES (3 column metrics in fixed-width grid) */}
      <section>
        <div style={{ fontSize: 11, color: D_T.muted, letterSpacing: '0.18em', marginBottom: 6 }}>
          $ STATUS
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1, background: D_T.ink, padding: 1 }}>
          {[
            { l: 'OUTSTANDING', v: '₹41,80,000', s: '−₹2,40,000 MTD', tone: D_T.ink },
            { l: 'DEBT-FREE', v: 'AUG 2027', s: '17 MO · −14 vs MIN', tone: D_T.positive },
            { l: 'EFFECTIVE APR', v: '11.94%', s: 'WEIGHTED', tone: D_T.ink },
            { l: 'SURPLUS', v: '₹1,05,000/MO', s: 'NET ALLOC', tone: D_T.positive },
            { l: 'NEXT ACTION', v: 'PAY ₹18,500', s: '→ ICICI · DUE 1 JUN', tone: D_T.accent },
          ].map((m, i) => (
            <div key={i} style={{ background: D_T.bg, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: D_T.muted, letterSpacing: '0.12em', marginBottom: 4 }}>{m.l}</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: m.tone, letterSpacing: '-0.01em' }}>{m.v}</div>
              <div style={{ fontSize: 10, color: D_T.muted, marginTop: 4 }}>{m.s}</div>
            </div>
          ))}
        </div>
      </section>

      {/* DEBTS TABLE */}
      <section>
        <div style={{ fontSize: 11, color: D_T.muted, letterSpacing: '0.18em', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
          <span>$ OPEN POSITIONS · 3</span>
          <span style={{ color: D_T.ink }}>[+] ADD DEBT</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderTop: `2px solid ${D_T.ink}`, borderBottom: `1px solid ${D_T.ink}` }}>
              {['#', 'LENDER', 'TYPE', 'RATE', 'EFFECTIVE', 'OUTSTANDING', 'EMI', 'TENURE', 'NEXT'].map((h, i) => (
                <th key={i} style={{ padding: '8px 12px', textAlign: i > 2 ? 'right' : 'left', fontWeight: 700, letterSpacing: '0.08em', fontSize: 10, color: D_T.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              { p: '01', l: 'ICICI', t: 'CARD', r: '36.00%', e: '42.48%', o: '₹1,00,000', emi: '—', tn: '—', nx: 'PAY ₹18,500', tone: D_T.negative, hl: true },
              { p: '02', l: 'SBI', t: 'PERS LOAN', r: '13.00%', e: '13.00%', o: '₹80,000', emi: '₹2,400', tn: '36 mo', nx: 'AUTO', tone: D_T.ink, hl: false },
              { p: '03', l: 'HDFC', t: 'HOME · FLT', r: '8.50%', e: '8.50%', o: '₹40,00,000', emi: '₹35,200', tn: '240 mo', nx: 'AUTO · RESET 47d', tone: D_T.ink, hl: false },
            ].map((r, i) => (
              <tr key={i} style={{ borderBottom: `1px dashed ${D_T.faint}`, background: r.hl ? D_T.highlight : 'transparent' }}>
                <td style={{ padding: '10px 12px', color: D_T.muted }}>{r.p}</td>
                <td style={{ padding: '10px 12px', fontWeight: 700 }}>{r.l}</td>
                <td style={{ padding: '10px 12px', color: D_T.muted }}>{r.t}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>{r.r}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: r.tone, fontWeight: r.hl ? 700 : 400 }}>{r.e}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>{r.o}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>{r.emi}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: D_T.muted }}>{r.tn}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: r.tone, fontWeight: r.hl ? 700 : 400 }}>{r.nx}</td>
              </tr>
            ))}
            <tr style={{ borderTop: `2px solid ${D_T.ink}` }}>
              <td colSpan={5} style={{ padding: '10px 12px', fontWeight: 700 }}>TOTAL</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>₹41,80,000</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>₹37,600/mo</td>
              <td colSpan={2}></td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* DECISION BOX, ASCII chart, RESTRUCTURE — full source in design handoff. */}
    </div>
  </DShell>
);

// ─── PLAN — amortisation print-out ───────────────────────────────────────
const DPlan = () => (
  <DShell>
    <DHeader section="PLAN" />

    <div style={{ flex: 1, padding: '18px 32px 32px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 22 }}>

      {/* Header line + 4-up KPI grid (with 1px black grout) */}
      <section>
        <div style={{ fontSize: 11, color: D_T.muted, letterSpacing: '0.18em', marginBottom: 6 }}>
          $ PLAN · STRATEGY = AVALANCHE · HORIZON = 240MO · MARGINAL RATE = 30%
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: D_T.ink, padding: 1 }}>
          {[
            { l: 'CLEAR DATE', v: 'AUG 2027', c: D_T.ink },
            { l: 'TOTAL INTEREST', v: '₹2,40,000', c: D_T.positive, sub: 'VS ₹4,10,000 BASE' },
            { l: 'MONTHS SAVED', v: '14', c: D_T.accent, sub: 'AGAINST MINIMUMS' },
            { l: 'MONTHLY OUTLAY', v: '₹86,500', c: D_T.ink, sub: 'EMI ₹37,600 + ALLOC ₹48,900' },
          ].map((s, i) => (
            <div key={i} style={{ background: D_T.bg, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: D_T.muted, letterSpacing: '0.12em', marginBottom: 4 }}>{s.l}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.c }}>{s.v}</div>
              {s.sub && <div style={{ fontSize: 10, color: D_T.muted, marginTop: 4 }}>{s.sub}</div>}
            </div>
          ))}
        </div>
      </section>

      {/* Trajectory chart, schedule table, sensitivity panel — full source archived in handoff */}
    </div>
  </DShell>
);

window.DirectionD = { DHome, DPlan };
