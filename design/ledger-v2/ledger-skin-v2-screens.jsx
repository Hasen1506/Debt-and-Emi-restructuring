// ═══════════════════════════════════════════════════════════════════════
// LEDGER SKIN · V2 — Debts, Insights, Goals, Tax, Portfolio, Windfall
// ═══════════════════════════════════════════════════════════════════════
const { useState: useS2 } = React;

// ═══════════════════════════════════════════════════════════════════════
// DEBTS V2 — with EffectiveAprBreakdown expand, stale nudge, cash mgmt
// ═══════════════════════════════════════════════════════════════════════
const LDebtsV2 = ({ mobile, business }) => {
  const [expanded, setExpanded] = useS2(0);
  return (
    <LShell>
      <LMastheadV2 section="debts" mobile={mobile} business={business} stmt="#1138-DEBTS" />
      <div style={{ flex: 1, overflow: 'auto', padding: mobile ? '14px 18px 28px' : '18px 32px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* StaleCardNudge */}
        <section style={{ background: L_T.highlight, border: `1px solid ${L_T.ink}`, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, letterSpacing: '0.14em', color: L_T.ink }}>
            ⚠ STALE · KOTAK CC NOT RECONCILED IN 18D · BALANCE MAY HAVE DRIFTED · STATEMENT-DAY ₹1,00,000 → TODAY ?
          </span>
          <span style={{ display: 'flex', gap: 6 }}>
            <LBracket active>RECONCILE NOW</LBracket>
            <LBracket>DISMISS 7D</LBracket>
          </span>
        </section>

        <section>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 6 }}>
            $ DEBTS · 4 OPEN · WEIGHTED EFFECTIVE APR {_A.plan.weightedAPR}
          </div>
          <LKpi mobile={mobile} cols={mobile ? 2 : 4} items={[
            { l: 'TOTAL OUTSTANDING', v: _A.plan.totalOutstanding, s: `${_A.plan.totalOutstandingMTD} MTD`, tone: L_T.ink },
            { l: 'WEIGHTED APR',      v: _A.plan.weightedAPR,      s: 'POST-TAX', tone: L_T.ink },
            { l: 'TOTAL EMI',         v: '₹51,800/MO',             s: '+ ALLOC ₹18.5K', tone: L_T.ink },
            { l: 'HDFC HL · NEXT RESET', v: '47 D · 30 JUN',          s: 'NOW 8.50% · AT RESET = RBI-DEPENDENT', tone: L_T.accent },
          ]} />
          <div style={{ fontSize: 10, color: L_T.muted, letterSpacing: '0.08em', marginTop: 8 }}>
            ⓘ FLOATING RATE · CURRENT 8.50% (MCLR + 215 BPS) · POST-RESET RATE IS A FUNCTION OF RBI REPO @ 5.25% · NEXT MTG 7 JUN · IF HELD = RATE UNCHANGED · IF –25 BPS = ~8.25%.
          </div>
        </section>

        {/* OPEN POSITIONS — with expandable EffectiveAprBreakdown */}
        <section>
          <LSectionHeader right={<LBracket>+ ADD DEBT</LBracket>}>OPEN POSITIONS · {_A.debts.length}</LSectionHeader>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderTop: `2px solid ${L_T.ink}`, borderBottom: `1px solid ${L_T.ink}` }}>
                  {['#', 'LENDER', 'TYPE', 'NOMINAL', 'EFFECTIVE', 'POST-TAX', 'OUTSTANDING', 'EMI', 'TENURE', ''].map((h, i) => (
                    <th key={i} style={{ padding: '8px 12px', textAlign: i > 2 && i < 9 ? 'right' : 'left', fontWeight: 700, letterSpacing: '0.08em', fontSize: 10, color: L_T.muted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {_A.debts.map((d, i) => (
                  <React.Fragment key={i}>
                    <tr style={{ borderBottom: expanded === i ? 'none' : `1px dashed ${L_T.faint}`, background: d.isHighest ? L_T.highlight : 'transparent' }}>
                      <td style={{ padding: '10px 12px', color: L_T.muted }}>{String(d.rank).padStart(2, '0')}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 700 }}>{d.bank.toUpperCase()}</td>
                      <td style={{ padding: '10px 12px', color: L_T.muted }}>{d.type}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>{d.nominal}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: d.isHighest ? L_T.negative : L_T.ink, fontWeight: d.isHighest ? 700 : 500 }}>{d.effective}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: d.shieldNote ? L_T.positive : L_T.ink }}>
                        {d.effectivePostTax}
                        {d.shieldNote && <div style={{ fontSize: 9, color: L_T.positive, marginTop: 2 }}>{d.shieldNote.toUpperCase()}</div>}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>{d.outstanding}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>{d.emi}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: L_T.muted }}>{d.tenure}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <span onClick={() => setExpanded(expanded === i ? -1 : i)} style={{ cursor: 'pointer' }}>
                          <LBracket accent>{expanded === i ? '[ CLOSE ROW ]' : '[ OPEN ROW ]'}</LBracket>
                        </span>
                      </td>
                    </tr>
                    {expanded === i && (
                      <LExpandPanel accent>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
                          <span style={{ fontSize: 10, letterSpacing: '0.14em', color: L_T.muted }}>$ EFFECTIVE APR BREAKDOWN · {d.bank.toUpperCase()}</span>
                          <span style={{ display: 'flex', gap: 6 }}>
                            <LBracket accent>[ EDIT ENTRY ]</LBracket>
                            <LBracket>[ WHY THIS APR? ]</LBracket>
                          </span>
                        </div>
                        <div style={{ fontSize: 9, color: L_T.muted, letterSpacing: '0.08em', marginBottom: 12 }}>
                          IF A LINE BELOW LOOKS WRONG — NOMINAL, FEE %, GST, SHIELD — EDIT IT INLINE · PLAN RECOMPUTES.
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1.4fr 1fr', gap: 18 }}>
                          <div>
                            <div style={{ fontSize: 10, letterSpacing: '0.14em', color: L_T.muted, marginBottom: 8 }}>$ EFFECTIVE APR BREAKDOWN</div>
                            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                              <tbody>
                                {(i === 0 ? [
                                  ['NOMINAL APR',          '36.00%', 'PUBLISHED'],
                                  ['+ MONTHLY FEE × 12',   '+18.00%', '1.5% × 12'],
                                  ['+ GST ON FEE',         '+3.24%',  '18% × 18.00pp'],
                                  ['− TAX SHIELD',         '0',       'NO DEDUCTION'],
                                  ['= EFFECTIVE',          '42.48%',  '× COMPOUNDING'],
                                ] : i === 3 ? [
                                  ['NOMINAL APR',          '8.50%',  'FLOATING'],
                                  ['+ PROCESSING (AMORT)', '+0.05%', '0.5% / 10 YRS'],
                                  ['= EFFECTIVE',          '8.55%',  'PRE-SHIELD'],
                                  ['− SEC 24 SHIELD',      '−1.25%', '₹2L × 30%'],
                                  ['= POST-TAX',           '7.30%',  'NET COST'],
                                ] : [
                                  ['NOMINAL APR',          d.nominal, 'FIXED'],
                                  ['+ FEES (AMORT)',       '+0.00%',  'NONE'],
                                  ['= EFFECTIVE',          d.effective, 'NO SHIELD'],
                                ]).map((r, j) => (
                                  <tr key={j} style={{ borderBottom: `1px dashed ${L_T.faint}` }}>
                                    <td style={{ padding: '6px 0', color: L_T.muted, letterSpacing: '0.06em' }}>{r[0]}</td>
                                    <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 700 }}>{r[1]}</td>
                                    <td style={{ padding: '6px 0 6px 16px', color: L_T.muted, fontSize: 9, letterSpacing: '0.08em' }}>{r[2]}</td>
                                    <td style={{ padding: '6px 0 6px 12px', textAlign: 'right' }}><LBracket>EDIT</LBracket></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div>
                            <div style={{ fontSize: 10, letterSpacing: '0.14em', color: L_T.muted, marginBottom: 8 }}>$ MONTHLY INTEREST · ABSOLUTE</div>
                            <div style={{ fontSize: 26, fontWeight: 700, color: i === 0 ? L_T.negative : L_T.ink, letterSpacing: '-0.01em' }}>
                              {['₹3,540', '₹2,180', '₹2,040', '₹25,830'][i]}
                            </div>
                            <div style={{ fontSize: 10, color: L_T.muted, marginTop: 4, letterSpacing: '0.06em' }}>PER MONTH · PURE FRICTION</div>
                            {i === 3 && (
                              <div style={{ marginTop: 10, padding: '8px 10px', background: L_T.bg, border: `1px dashed ${L_T.ink}`, fontSize: 10, color: L_T.muted, letterSpacing: '0.04em', lineHeight: 1.6 }}>
                                ⓘ FLOATING · RATE AT 30 JUN RESET = RBI-DEPENDENT · NO WAY TO QUOTE PRE-MEETING.
                              </div>
                            )}
                            <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              {i === 0 && <LBracket active>BALANCE TRANSFER →</LBracket>}
                              {i === 3 && <LBracket>REFINANCE →</LBracket>}
                              <LBracket>EDIT TERMS</LBracket>
                              <LBracket>HISTORY</LBracket>
                            </div>
                            <div style={{ marginTop: 10, fontSize: 9, color: L_T.muted, letterSpacing: '0.06em', lineHeight: 1.6 }}>
                              BT = MOVE BALANCE TO LOWER-APR CARD/PL (CARDS REPRICE WEEKLY) · EDIT TERMS = UPDATE APR/FEES/TENURE · HISTORY = PAST RATE + PAYMENT CHANGES.
                            </div>
                          </div>
                        </div>
                      </LExpandPanel>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* LIFECYCLE EVENTS */}
        <section>
          <LSectionHeader right={<LBracket>+ ADD EVENT</LBracket>}>LIFECYCLE · {3} EVENTS</LSectionHeader>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderTop: `2px solid ${L_T.ink}`, borderBottom: `1px solid ${L_T.ink}` }}>
                {['DATE', 'LOAN', 'KIND', 'WHAT', 'STATUS'].map((h, i) => (
                  <th key={i} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, fontSize: 10, color: L_T.muted, letterSpacing: '0.08em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { date: '30 JUN 26', loan: 'HDFC HL', kind: 'FLOATING_RESET', what: 'Quarterly reset · MCLR + 215bps', status: 'SCHEDULED' },
                { date: '14 JUL 27', loan: 'KOTAK CC', kind: 'BRACKET_CROSS', what: 'Marginal slab 30% → 20% triggers', status: 'PROJECTED' },
                { date: '01 JAN 28', loan: 'HDFC HL', kind: 'PMI_DROP',     what: 'LTV < 80% · re-evaluate', status: 'CONDITIONAL' },
              ].map((e, i) => (
                <tr key={i} style={{ borderBottom: `1px dashed ${L_T.faint}` }}>
                  <td style={{ padding: '10px 12px', color: L_T.muted, letterSpacing: '0.06em' }}>{e.date}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 700 }}>{e.loan}</td>
                  <td style={{ padding: '10px 12px', color: L_T.accent, fontSize: 10, letterSpacing: '0.08em', fontWeight: 700 }}>{e.kind}</td>
                  <td style={{ padding: '10px 12px' }}>{e.what}</td>
                  <td style={{ padding: '10px 12px' }}><LBracket>{e.status}</LBracket></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* CASH MANAGEMENT moved to /portfolio — debts ledger stays focused on debt */}
      </div>
    </LShell>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// INSIGHTS V2 — summary strip, tax entries, invest-vs-prepay note, per-loan trajectory
// ═══════════════════════════════════════════════════════════════════════
const LInsightsV2 = ({ mobile, business }) => {
  const allInsights = [
    {
      date: 'May 14, 2026', eyebrow: 'WORKED EXAMPLE', tags: ['invest', 'prepay', 'tax'],
      title: 'YOUR FD IS LOSING TO YOUR KOTAK CARD BY 37.7 PP/YEAR',
      body: 'At your 30% marginal rate, a 6.8% FD nets you 4.76% after tax. The Kotak CC is costing you 42.48% all-in. Every rupee moved from the FD to the card saves 37.72pp — about ₹377 per year per ₹1,000 redirected.',
      isMath: true,
      math: [
        { lhs: 'fd_after_tax', rhs: '4.76%', note: '(6.8% × (1 − 0.30))' },
        { lhs: 'kotak_effective', rhs: '42.48%', note: 'POST-GST' },
        { lhs: 'gap', rhs: '37.72 pp', tone: 'pos' },
        { lhs: 'per_1k_moved', rhs: '₹377/yr saved', tone: 'pos' },
      ],
    },
    {
      date: 'May 12, 2026', eyebrow: 'TAX', tags: ['advance-tax', 'business'],
      title: 'Q1 ADVANCE TAX · ₹47,000 DUE 15 JUN',
      body: 'You crossed the ₹10K aggregate threshold this AY. First instalment (15% of estimated liability) is due in 32 days. Missing it triggers Sec 234C interest @ 1%/mo on the shortfall.',
    },
    {
      date: 'Apr 7, 2026',  eyebrow: 'RATES', tags: ['repo', 'floating', 'reset'],
      title: 'RBI held repo at 5.25%',
      body: 'Your floating home loan is unaffected at its next reset 47 days from today. The MCLR-linked spread will requote at the same level.',
    },
    {
      date: 'Apr 2, 2026', eyebrow: 'MILESTONE', tags: ['home loan', 'milestone'],
      title: 'Your home loan crossed the halfway mark',
      body: 'Principal paid since 2018 now exceeds remaining. From here, every EMI shifts more to principal than interest. Sec 24 shield still active.',
    },
    {
      date: 'Mar 20, 2026', eyebrow: 'TAX', tags: ['Sec 24', 'tax'],
      title: 'Your Sec 24 shield is worth ₹47k/yr',
      body: 'At your 30% marginal rate, the interest deduction on your home loan brings the after-tax cost from 8.50% down to roughly 7.30%. Factored into avalanche ordering.',
    },
  ];

  return (
    <LShell>
      <LMastheadV2 section="insights" mobile={mobile} business={business} stmt="#1138-NOTES" />
      <div style={{ flex: 1, overflow: 'auto', padding: mobile ? '14px 18px 28px' : '18px 32px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* InsightsSummaryStrip — plain language */}
        <section>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 6 }}>
            $ NOTES · WHAT THE ENGINE LEARNED THIS YEAR · {allInsights.length} ENTRIES
          </div>
          <LKpi mobile={mobile} cols={mobile ? 2 : 4} items={[
            { l: 'NOTES LOGGED',       v: String(allInsights.length), s: 'YOU\'VE OPENED THIS MANY THIS YEAR' },
            { l: 'PLAN SHIFTED BY',    v: '−2.4 MO',     s: 'FROM ACTING ON NOTES · NOW AHEAD',     tone: L_T.positive },
            { l: 'INTEREST AVOIDED',   v: '−₹18,200',    s: 'BY FOLLOWING ENGINE RECOMMENDATIONS',  tone: L_T.positive },
            { l: 'LATEST NOTE',        v: 'MAY 14',      s: 'WORKED EXAMPLE · OPEN BELOW ↓',        tone: L_T.accent },
          ]} />
        </section>

        {allInsights.map((n, i) => (
          <section key={i} style={{ paddingBottom: 18, borderBottom: i < allInsights.length - 1 ? `1px dashed ${L_T.faint}` : 'none' }}>
            <div style={{ display: 'flex', gap: 14, fontSize: 10, color: L_T.muted, letterSpacing: '0.12em', marginBottom: 10, flexWrap: 'wrap' }}>
              <span>NO. {String(i + 1).padStart(3, '0')}</span>
              <span>· {n.date.toUpperCase()}</span>
              <span style={{ color: L_T.accent, fontWeight: 700 }}>· {n.eyebrow}</span>
              <span style={{ marginLeft: 'auto' }}>{n.tags.map((t) => `#${t}`).join('  ')}</span>
            </div>
            <h2 style={{ fontFamily: L_mono, fontSize: mobile ? 16 : 20, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 8, lineHeight: 1.25 }}>
              {n.title.toUpperCase()}
            </h2>
            <p style={{ fontSize: 12, color: L_T.ink, lineHeight: 1.7, marginBottom: n.isMath ? 12 : 10 }}>{n.body}</p>
            {n.isMath && <LMathBlock rows={n.math} />}
            <div style={{ marginTop: 10 }}>
              <LBracket>OPEN FULL NOTE →</LBracket>
            </div>
          </section>
        ))}

        {/* LIFECYCLE EVENTS · ported from the deleted /debts tab · belongs with notes */}
        <section>
          <LSectionHeader right={<LBracket>+ ADD EVENT</LBracket>}>LIFECYCLE EVENTS · 3 SCHEDULED</LSectionHeader>
          <div style={{ fontSize: 11, color: L_T.muted, marginBottom: 10, letterSpacing: '0.04em', lineHeight: 1.6 }}>
            DATED OUT-OF-BAND EVENTS THAT WILL MOVE THE PLAN · BANK RESETS, TAX-SLAB CROSSINGS, LTV THRESHOLDS · EACH HAS A TRIGGER → ACTION.
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderTop: `2px solid ${L_T.ink}`, borderBottom: `1px solid ${L_T.ink}` }}>
                {['DATE', 'LOAN', 'KIND', 'WHAT', 'STATUS', ''].map((h, i) => (
                  <th key={i} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, fontSize: 10, color: L_T.muted, letterSpacing: '0.08em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { date: '30 JUN 26', loan: 'HDFC HL', kind: 'FLOATING_RESET', what: 'Quarterly reset · MCLR + 215bps · RBI 7 JUN sets new rate', status: 'SCHEDULED' },
                { date: '14 JUL 27', loan: 'KOTAK CC', kind: 'BRACKET_CROSS', what: 'Marginal slab 30% → 20% triggers · shield value drops', status: 'PROJECTED' },
                { date: '01 JAN 28', loan: 'HDFC HL', kind: 'PMI_DROP',      what: 'LTV < 80% · re-evaluate · drop insurance premium',     status: 'CONDITIONAL' },
              ].map((e, i) => (
                <tr key={i} style={{ borderBottom: `1px dashed ${L_T.faint}` }}>
                  <td style={{ padding: '10px 12px', color: L_T.muted, letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{e.date}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>{e.loan}</td>
                  <td style={{ padding: '10px 12px', color: L_T.accent, fontSize: 10, letterSpacing: '0.08em', fontWeight: 700, whiteSpace: 'nowrap' }}>{e.kind}</td>
                  <td style={{ padding: '10px 12px' }}>{e.what}</td>
                  <td style={{ padding: '10px 12px' }}><LBracket>{e.status}</LBracket></td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}><LBracket>EDIT</LBracket></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </LShell>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// GOALS & TOOLS — merged surface
//   Answers user's open questions on this screen:
//   · How do I cancel / edit a goal?  → per-row actions (EDIT · CANCEL · ARCHIVE)
//   · What does OPEN do?              → opens the goal's detail · history · adjustments
//   · What inputs to capture?         → an INPUT SPEC block lays it out
//   · Need for Allocation Sandbox?    → kept, but explained + worked example
//                                       (₹15L target · ₹50K surplus · ₹1L + ₹5L debts)
//   · Tools tab merged here           → 7 one-question tools at the bottom
// ═══════════════════════════════════════════════════════════════════════
const LGoalsScreen = ({ mobile, business }) => {
  const goals = V2.goals;
  const active = goals.length;
  const funded = goals.filter(g => g.status === 'FUNDED').length;
  const behind = goals.filter(g => g.status === 'BEHIND').length;
  const tools = (window.APP && window.APP.tools) || [];
  return (
    <LShell>
      <LMastheadV2 section="goals" mobile={mobile} business={business} stmt="#1138-GOALS" />
      <div style={{ flex: 1, overflow: 'auto', padding: mobile ? '14px 18px 28px' : '18px 32px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>

        <section>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 6 }}>
            $ GOALS · {active} ACTIVE · {funded} FUNDED · {behind} BEHIND · TOTAL TARGET ₹54L
          </div>
          <LKpi mobile={mobile} cols={mobile ? 2 : 4} items={[
            { l: 'ACTIVE',        v: String(active),   s: 'GOALS',           tone: L_T.ink },
            { l: 'FUNDED',        v: String(funded),   s: 'AT OR PAST',      tone: L_T.positive },
            { l: 'BEHIND',        v: String(behind),   s: 'NEEDS ATTENTION', tone: L_T.negative },
            { l: 'PRIORITY GOAL', v: 'HOUSE',          s: '★ HARD-LOCKED',   tone: L_T.accent },
          ]} />
        </section>

        {/* Goals ledger — now with EDIT · CANCEL · OPEN per row */}
        <section>
          <LSectionHeader right={<LBracket accent>+ NEW GOAL</LBracket>}>GOAL LEDGER</LSectionHeader>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderTop: `2px solid ${L_T.ink}`, borderBottom: `1px solid ${L_T.ink}` }}>
                  {['#', 'GOAL', 'TARGET', 'SAVED', 'PROGRESS', 'ETA', 'MONTHLY', 'STATUS', ''].map((h, i) => (
                    <th key={i} style={{ padding: '8px 12px', textAlign: i > 1 && i < 7 ? 'right' : 'left', fontWeight: 700, fontSize: 10, color: L_T.muted, letterSpacing: '0.08em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {goals.map((g, i) => {
                  const pct = (g.saved / g.target) * 100;
                  const tone = g.status === 'FUNDED' ? 'pos' : g.status === 'BEHIND' ? 'neg' : null;
                  return (
                    <tr key={g.id} style={{ borderBottom: `1px dashed ${L_T.faint}`, borderLeft: g.priority ? `3px solid ${L_T.accent}` : '3px solid transparent' }}>
                      <td style={{ padding: '12px 12px', color: L_T.muted }}>{String(i + 1).padStart(2, '0')}</td>
                      <td style={{ padding: '12px 12px', fontWeight: 700 }}>
                        {g.priority && <span style={{ color: L_T.accent, marginRight: 4 }}>★</span>}
                        {g.label}
                      </td>
                      <td style={{ padding: '12px 12px', textAlign: 'right' }}>₹{(g.target/100000).toFixed(1)}L</td>
                      <td style={{ padding: '12px 12px', textAlign: 'right', fontWeight: 700 }}>₹{(g.saved/100000).toFixed(2)}L</td>
                      <td style={{ padding: '12px 12px', textAlign: 'right' }}><LProgressBar pct={pct} width={mobile ? 14 : 22} tone={tone} /></td>
                      <td style={{ padding: '12px 12px', textAlign: 'right', color: g.status === 'BEHIND' ? L_T.negative : L_T.ink, fontWeight: g.priority ? 700 : 500 }}>{g.eta}</td>
                      <td style={{ padding: '12px 12px', textAlign: 'right', color: L_T.muted }}>₹{(g.monthly/1000).toFixed(0)}K</td>
                      <td style={{ padding: '12px 12px' }}>
                        <span style={{
                          fontSize: 9, letterSpacing: '0.14em', fontWeight: 700,
                          color: tone === 'pos' ? L_T.positive : tone === 'neg' ? L_T.negative : L_T.ink,
                        }}>{g.status}</span>
                      </td>
                      <td style={{ padding: '12px 12px', textAlign: 'right' }}>
                        <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <LBracket accent>OPEN</LBracket>
                          <LBracket>EDIT</LBracket>
                          <LBracket>{g.status === 'FUNDED' ? 'ARCHIVE' : 'CANCEL'}</LBracket>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 8, fontSize: 10, color: L_T.muted, letterSpacing: '0.06em', lineHeight: 1.6 }}>
            <strong>OPEN</strong> · GOAL DETAIL · CONTRIBUTION HISTORY · ETA SENSITIVITY · DRAW-DOWN PLAN ·{' '}
            <strong>EDIT</strong> · CHANGE TARGET / ETA / MONTHLY / PRIORITY · LOGS TO ACTIVITY ·{' '}
            <strong>CANCEL</strong> · MARKS GOAL CANCELLED · CONTRIBUTIONS STOP · SAVED AMOUNT STAYS · ROUTED TO ENGINE NEXT MONTH.
          </div>
        </section>

        {/* INPUT SPEC — what to capture when a user adds a goal */}
        <section style={{ border: `1px solid ${L_T.ink}`, padding: mobile ? '14px 16px' : '18px 22px' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 4 }}>$ NEW GOAL · INPUT SPEC</div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, letterSpacing: '-0.01em' }}>
            EIGHT QUESTIONS · CAPTURED ONCE · EVERYTHING ELSE DERIVED
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(4, 1fr)', gap: 14 }}>
            {[
              { n: '01', label: 'LABEL',            ex: 'HOUSE DOWN-PAYMENT',  why: 'How you\'ll recognise it in the ledger' },
              { n: '02', label: 'TARGET AMOUNT',    ex: '₹15,00,000',          why: 'Total to accumulate · pre-tax' },
              { n: '03', label: 'WHEN BY',          ex: 'JUN 2029 · 37 MO',    why: 'Hard date or soft target' },
              { n: '04', label: 'WHY · WORTHINESS', ex: 'HOME · WEDDING · CAR · EDU · TRIP', why: 'Engine maps to hard/soft/discretionary' },
              { n: '05', label: 'STARTING POSITION',ex: '₹50,000 ALREADY SAVED', why: 'Counts toward progress · stays if cancelled' },
              { n: '06', label: 'PRIORITY',         ex: '★ PRIORITY / NORMAL / WAIT', why: 'Hard-locked goals get protected allocation' },
              { n: '07', label: 'PARK WHERE',       ex: 'LIQUID FD · DEBT FUND · EQUITY', why: 'Determines after-tax return + lock-in risk' },
              { n: '08', label: 'FAIL MODE',        ex: 'DELAY · SHRINK · BORROW',       why: 'What if you fall short · informs engine' },
            ].map((q, i) => (
              <div key={i} style={{ borderTop: `1px dashed ${L_T.faint}`, paddingTop: 8 }}>
                <div style={{ fontSize: 9, color: L_T.muted, letterSpacing: '0.14em', marginBottom: 4 }}>{q.n} · {q.label}</div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{q.ex}</div>
                <div style={{ fontSize: 10, color: L_T.muted, lineHeight: 1.5 }}>{q.why}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px dashed ${L_T.faint}`, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 10, color: L_T.muted, letterSpacing: '0.06em', lineHeight: 1.6, maxWidth: 680 }}>
              FROM THESE 8 INPUTS THE ENGINE DERIVES: REQUIRED MONTHLY, MAX TOLERABLE DELAY, COMPETITION WITH DEBT (BY AFTER-TAX SPREAD), AND HOW THIS GOAL BEHAVES IF A WINDFALL ARRIVES OR A RATE RESETS.
            </span>
            <span style={{ display: 'flex', gap: 6, alignSelf: 'flex-start' }}>
              <LBracket accent>OPEN INPUT FORM</LBracket>
              <LBracket>SHOW EXAMPLE</LBracket>
            </span>
          </div>
        </section>

        {/* Worked example removed — math now lives at /windfall · the engine math block at the bottom of that screen explains how an inflow gets split */}

        {/* ALLOCATION SANDBOX — kept, framed as "what if I override the engine?" */}
        <section style={{ border: `1px solid ${L_T.ink}`, padding: mobile ? '16px 18px' : '22px 26px' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, fontWeight: 700, marginBottom: 4 }}>$ ALLOCATION SANDBOX · OPTIONAL · OVERRIDE THE ENGINE</div>
          <div style={{ fontSize: mobile ? 15 : 17, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 6 }}>
            IF YOU HAD ₹1,00,000 RIGHT NOW · HOW WOULD YOU SPLIT IT ACROSS GOALS?
          </div>
          <div style={{ fontSize: 10, color: L_T.muted, marginBottom: 16, lineHeight: 1.7 }}>
            FOR WHEN YOU WANT TO PLAY WITH ALLOCATION · NOT REQUIRED FOR MONTHLY DECISIONS · ENGINE STILL WARNS IF YOUR SPLIT COSTS &gt; 0.5 MO OF DEBT-FREE DATE.
          </div>

          <LGoalSlider goals={goals.filter(g => g.status !== 'FUNDED')} total={100000} />

          <div style={{ marginTop: 14, fontSize: 10, color: L_T.muted, letterSpacing: '0.06em' }}>
            ★ HOUSE IS YOUR PRIORITY GOAL · DEFAULT WEIGHTING FAVOURS IT
          </div>

          <div style={{ marginTop: 18, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={{ padding: '10px 16px', background: L_T.ink, color: L_T.bg, border: 'none', fontFamily: L_mono, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', cursor: 'pointer' }}>
              [ APPLY ALLOCATION → ACTIVITY ]
            </button>
            <LBracket>OPEN IN WINDFALL TOOL →</LBracket>
            <LBracket>RESET TO ENGINE PICK</LBracket>
          </div>
        </section>

        {/* TOOLS · ported from /tools · merged into Goals as user requested */}
        <section>
          <LSectionHeader right={<LBracket>+ NEW TOOL</LBracket>}>TOOLS · {tools.length} · ONE QUESTION EACH</LSectionHeader>
          <div style={{ fontSize: 11, color: L_T.muted, marginBottom: 10, letterSpacing: '0.04em', lineHeight: 1.6 }}>
            EACH TOOL ANSWERS ONE FOCUSED QUESTION · OPEN ANY TOOL TO RUN IT · RESULTS LOG TO ACTIVITY.
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderTop: `2px solid ${L_T.ink}`, borderBottom: `1px solid ${L_T.ink}` }}>
                {['§', 'TOOL', 'ONE QUESTION', 'WHAT IT DOES', ''].map((h, i) => (
                  <th key={i} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, fontSize: 10, color: L_T.muted, letterSpacing: '0.08em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tools.map((t, i) => (
                <tr key={t.id} style={{ borderBottom: `1px dashed ${L_T.faint}` }}>
                  <td style={{ padding: '12px 12px', color: L_T.accent, fontWeight: 700, letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>§{(t.tag || '').toUpperCase()}</td>
                  <td style={{ padding: '12px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>{t.name}</td>
                  <td style={{ padding: '12px 12px', fontStyle: 'italic', color: L_T.ink }}>"{t.q}"</td>
                  <td style={{ padding: '12px 12px', color: L_T.muted, fontSize: 10, lineHeight: 1.6 }}>{t.sub}</td>
                  <td style={{ padding: '12px 12px', textAlign: 'right' }}>
                    <LBracket accent>OPEN →</LBracket>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </LShell>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// TAX — business-user-gated /tax route
// ═══════════════════════════════════════════════════════════════════════
const LTaxScreen = ({ mobile }) => (
  <LShell>
    <LMastheadV2 section="tax" mobile={mobile} business stmt="#1138-TAX" />
    <div style={{ flex: 1, overflow: 'auto', padding: mobile ? '14px 18px 28px' : '18px 32px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>

      <section>
        <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 6 }}>
          $ TAX · BUSINESS PROFILE · AY 2026-27 · REGIME=NEW · MARGINAL=30%
        </div>
        <LKpi mobile={mobile} cols={mobile ? 2 : 4} items={[
          { l: 'NEXT DUE',     v: '15 JUN · 32D',  s: 'Q1 ADVANCE',    tone: L_T.accent },
          { l: 'AY EST. LIAB', v: '₹3,13,000',     s: 'ENGINE PROJECTION' },
          { l: 'PAID YTD',     v: '₹0',            s: '0 OF 4 PAID' },
          { l: 'PENALTY RISK', v: '₹1,400',        s: 'IF Q1 MISSED · 234C', tone: L_T.negative },
        ]} />
      </section>

      {/* ADVANCE TAX SCHEDULE */}
      <section>
        <LSectionHeader right={<LBracket>EXPORT CHALLAN</LBracket>}>ADVANCE TAX · 4 INSTALMENTS</LSectionHeader>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ borderTop: `2px solid ${L_T.ink}`, borderBottom: `1px solid ${L_T.ink}` }}>
              {['DUE DATE', 'INSTALMENT', 'CUM %', 'AMOUNT', 'DAYS', 'STATUS', ''].map((h, i) => (
                <th key={i} style={{ padding: '8px 12px', textAlign: i > 1 && i < 5 ? 'right' : 'left', fontWeight: 700, fontSize: 10, color: L_T.muted, letterSpacing: '0.08em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {V2.advanceTax.map((t, i) => (
              <tr key={i} style={{ borderBottom: `1px dashed ${L_T.faint}`, background: i === 0 ? L_T.highlight : 'transparent' }}>
                <td style={{ padding: '12px 12px', fontWeight: 700, letterSpacing: '0.06em' }}>{t.due}</td>
                <td style={{ padding: '12px 12px', color: L_T.accent, fontWeight: 700 }}>{t.q}</td>
                <td style={{ padding: '12px 12px', textAlign: 'right', color: L_T.muted }}>{t.pct}</td>
                <td style={{ padding: '12px 12px', textAlign: 'right', fontWeight: 700 }}>{t.amount}</td>
                <td style={{ padding: '12px 12px', textAlign: 'right', color: t.daysOut < 60 ? L_T.accent : L_T.muted }}>{t.daysOut}D</td>
                <td style={{ padding: '12px 12px', fontSize: 10, letterSpacing: '0.14em', fontWeight: 700, color: t.status === 'PENDING' ? L_T.negative : L_T.muted }}>{t.status}</td>
                <td style={{ padding: '12px 12px', textAlign: 'right' }}>
                  {t.status === 'PENDING' ? <LBracket accent>PAY NOW →</LBracket> : <LBracket>REMIND</LBracket>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* TAX BREAKDOWN BY LOAN */}
      <section>
        <LSectionHeader right={<span style={{ color: L_T.positive, fontWeight: 700 }}>TOTAL SHIELD ₹1,05,000/Y</span>}>DEDUCTIONS BY LOAN</LSectionHeader>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ borderTop: `2px solid ${L_T.ink}`, borderBottom: `1px solid ${L_T.ink}` }}>
              {['LOAN', 'SECTION', 'DEDUCTION CAP', 'CLAIMED', 'AT 30%', 'SHIELD VALUE'].map((h, i) => (
                <th key={i} style={{ padding: '8px 12px', textAlign: i > 1 ? 'right' : 'left', fontWeight: 700, fontSize: 10, color: L_T.muted, letterSpacing: '0.08em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {V2.taxByLoan.map((t, i) => (
              <tr key={i} style={{ borderBottom: `1px dashed ${L_T.faint}` }}>
                <td style={{ padding: '12px 12px', fontWeight: 700 }}>{t.loan}</td>
                <td style={{ padding: '12px 12px', color: L_T.accent, fontWeight: 700, letterSpacing: '0.06em' }}>{t.section}</td>
                <td style={{ padding: '12px 12px', textAlign: 'right' }}>{t.deduction}</td>
                <td style={{ padding: '12px 12px', textAlign: 'right' }}>{t.deduction}</td>
                <td style={{ padding: '12px 12px', textAlign: 'right', color: L_T.muted }}>{t.rate}</td>
                <td style={{ padding: '12px 12px', textAlign: 'right', color: L_T.positive, fontWeight: 700 }}>{t.shield}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 10, fontSize: 11, color: L_T.muted, letterSpacing: '0.04em' }}>
          ENGINE INCORPORATES SHIELDS INTO POST-TAX EFFECTIVE APR · CHANGES PROPAGATE TO AVALANCHE ORDERING ON `/PLAN`
        </div>
      </section>

      <LMathBlock rows={[
        { lhs: 'ay_estimated_tax',     rhs: '₹3,13,000', note: '(₹15L SE income − shields)' },
        { lhs: 'q1_instalment',        rhs: '₹47,000',   note: '(15% × ₹3.13L)' },
        { lhs: 'sec_234c_if_missed',   rhs: '₹1,400',    note: '(1% × ₹47K × 3 mo)', tone: 'neg' },
        { lhs: 'sec_24_shield_value',  rhs: '₹60,000/y', note: '(₹2L × 30%)', tone: 'pos' },
      ]} />
    </div>
  </LShell>
);

// ═══════════════════════════════════════════════════════════════════════
// PORTFOLIO — holdings list
// ═══════════════════════════════════════════════════════════════════════
const LPortfolioScreen = ({ mobile, business }) => {
  const h = V2.holdings;
  const totalCost = 333928, totalMv = 366399, totalPnl = 32471;
  return (
    <LShell>
      <LMastheadV2 section="portfolio" mobile={mobile} business={business} stmt="#1138-PORT" />
      <div style={{ flex: 1, overflow: 'auto', padding: mobile ? '14px 18px 28px' : '18px 32px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>

        <section>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 6 }}>
            $ PORTFOLIO · {h.length} POSITIONS · COST ₹{(totalCost/100000).toFixed(2)}L · NAV ₹{(totalMv/100000).toFixed(2)}L
          </div>
          <LKpi mobile={mobile} cols={mobile ? 2 : 4} items={[
            { l: 'POSITIONS',    v: String(h.length),                              s: 'OPEN',                    tone: L_T.ink },
            { l: 'NAV',          v: `₹${(totalMv/100000).toFixed(2)}L`,            s: 'MARKET VALUE',            tone: L_T.ink },
            { l: 'UNREALISED',   v: `+₹${(totalPnl/1000).toFixed(1)}K`,            s: '+9.7% · ON COST',         tone: L_T.positive },
            { l: 'BLENDED YIELD',v: '6.4%',                                        s: 'TEY · POST-TAX 4.5%',     tone: L_T.muted },
          ]} />
        </section>

        <section>
          <LSectionHeader right={<><LBracket>+ ADD HOLDING</LBracket> <LBracket>IMPORT CSV</LBracket></>}>HOLDINGS · LIQUIDATION ORDER</LSectionHeader>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderTop: `2px solid ${L_T.ink}`, borderBottom: `1px solid ${L_T.ink}` }}>
                  {['#', 'SYMBOL', 'QTY', 'AVG', 'LTP', 'COST', 'MV', 'P&L', 'P&L %', ''].map((h, i) => (
                    <th key={i} style={{ padding: '8px 12px', textAlign: i > 1 ? 'right' : 'left', fontWeight: 700, fontSize: 10, color: L_T.muted, letterSpacing: '0.08em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {h.map((p, i) => (
                  <tr key={i} style={{ borderBottom: `1px dashed ${L_T.faint}` }}>
                    <td style={{ padding: '12px 12px', color: L_T.muted }}>{String(i + 1).padStart(2, '0')}</td>
                    <td style={{ padding: '12px 12px', fontWeight: 700 }}>{p.sym}</td>
                    <td style={{ padding: '12px 12px', textAlign: 'right', color: L_T.muted }}>{p.qty}</td>
                    <td style={{ padding: '12px 12px', textAlign: 'right' }}>{p.avg}</td>
                    <td style={{ padding: '12px 12px', textAlign: 'right' }}>{p.ltp}</td>
                    <td style={{ padding: '12px 12px', textAlign: 'right', color: L_T.muted }}>{p.cost}</td>
                    <td style={{ padding: '12px 12px', textAlign: 'right', fontWeight: 700 }}>{p.mv}</td>
                    <td style={{ padding: '12px 12px', textAlign: 'right', color: p.tone === 'pos' ? L_T.positive : L_T.negative, fontWeight: 700 }}>{p.pnl}</td>
                    <td style={{ padding: '12px 12px', textAlign: 'right', color: p.tone === 'pos' ? L_T.positive : L_T.negative }}>{p.pnlPct}</td>
                    <td style={{ padding: '12px 12px', textAlign: 'right' }}><LBracket>SELL</LBracket></td>
                  </tr>
                ))}
                <tr style={{ borderTop: `2px solid ${L_T.ink}` }}>
                  <td colSpan={5} style={{ padding: '10px 12px', color: L_T.muted, letterSpacing: '0.1em', fontSize: 10 }}>TOTAL</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>₹{totalCost.toLocaleString('en-IN')}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>₹{totalMv.toLocaleString('en-IN')}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: L_T.positive, fontWeight: 700 }}>+₹{totalPnl.toLocaleString('en-IN')}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: L_T.positive, fontWeight: 700 }}>+9.7%</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section style={{ fontSize: 11, color: L_T.muted, lineHeight: 1.7, borderTop: `1px dashed ${L_T.faint}`, paddingTop: 12 }}>
          NOTE · LIQUIDATION ORDER OPTIMISES FOR (1) NEGATIVE OR FLAT P&amp;L FIRST (LOSS HARVEST), (2) LOWEST TEY, (3) HIGHEST APR DEBT TARGETED.
          {' '}<LBracket>RUN LIQUIDATE TOOL →</LBracket>
        </section>

        {/* CASH MANAGEMENT · ported from /debts · belongs with the rest of the asset side */}
        <section>
          <LSectionHeader right={<span style={{ color: L_T.negative, fontWeight: 700 }}>DRAG −₹14,400/Y</span>}>CASH · WHERE IT SITS · WHAT IT EARNS</LSectionHeader>
          <div style={{ fontSize: 10, color: L_T.muted, letterSpacing: '0.04em', marginBottom: 10, lineHeight: 1.6, padding: '8px 12px', background: L_T.highlightSoft, border: `1px dashed ${L_T.ink}` }}>
            ⓘ "IDLE" THRESHOLD · ANY CASH EARNING LESS THAN THE BEST RISK-FREE LIQUID YIELD (TODAY 7.10% · KOTAK SWEEP-IN FD) IS DRAG.
            {' '}OPERATIONAL FLOAT — ROUGHLY 1 MO EXPENSES · ₹50,000 — IS NEVER FLAGGED · EVERYTHING ABOVE IT IS ELIGIBLE FOR REDIRECT.
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderTop: `2px solid ${L_T.ink}`, borderBottom: `1px solid ${L_T.ink}` }}>
                {['WHERE', 'BALANCE', 'YIELD', 'YIELD AFTER TAX', 'OPP. COST', ''].map((h, i) => (
                  <th key={i} style={{ padding: '8px 12px', textAlign: i > 0 ? 'right' : 'left', fontWeight: 700, fontSize: 10, color: L_T.muted, letterSpacing: '0.08em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {V2.cashManagement.map((c, i) => (
                <tr key={i} style={{ borderBottom: `1px dashed ${L_T.faint}`, background: c.tone === 'neg' ? L_T.highlightSoft : 'transparent' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 700 }}>{c.where}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>{c.balance}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{c.yield}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: L_T.muted }}>{(parseFloat(c.yield)*0.7).toFixed(2)}%</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: c.tone === 'neg' ? L_T.negative : L_T.muted, fontWeight: c.tone === 'neg' ? 700 : 400 }}>{c.drag}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}><LBracket>{c.tone === 'neg' ? 'MOVE TO FD →' : 'OK'}</LBracket></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </LShell>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// WINDFALL V2 — per-target sliders (debts by highest APR, then goals)
//   · Each slider carries its own impact badge at the bottom corner:
//       debts  → DEBT-FREE +N MO   ·   goals → +N% PROGRESS
//   · ENGINE PICK sets every slider to the optimal math (avalanche).
//   · MANUAL UPDATE lets the user override any slider; pool capped at ₹1L.
//   · No split slider, no worked example — just the sliders + THE MATH.
// ═══════════════════════════════════════════════════════════════════════
const WF_TOTAL = 100000;
const WF_debts = [
  { id: 'kotak',  label: 'KOTAK CC',  apr: '42.48%', balance: 100000,  moAtFull: 4 },
  { id: 'hdfcpl', label: 'HDFC PL',   apr: '14.50%', balance: 285000,  moAtFull: 2 },
  { id: 'sbi',    label: 'SBI AUTO',  apr: '9.25%',  balance: 210000,  moAtFull: 1 },
  { id: 'hdfchl', label: 'HDFC HL',   apr: '8.50%',  balance: 4200000, moAtFull: 1 },
];
const WF_aprNum = { kotak: 42.48, hdfcpl: 14.5, sbi: 9.25, hdfchl: 8.5 };
const WF_goals = V2.goals.filter(g => g.status !== 'FUNDED');
const WF_items = [
  ...WF_debts.map((d, i) => ({ type: 'debt', rank: i + 1, ...d })),
  ...WF_goals.map(g => ({ type: 'goal', ...g })),
];
// Engine optimal — avalanche: pour into highest-APR debt up to its balance, in order.
const WF_engineAlloc = (() => {
  let rem = WF_TOTAL;
  return WF_items.map(it => {
    if (it.type === 'debt') { const a = Math.min(rem, it.balance); rem -= a; return a; }
    return 0;
  });
})();

// Strong, clearly-differentiated section header (numbered + underlined + bold)
const WFHead = ({ no, children, accent }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, paddingBottom: 8, borderBottom: `2px solid ${L_T.ink}` }}>
    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: accent ? '#fff' : L_T.ink, background: accent ? L_T.accent : 'transparent', border: `1.5px solid ${accent ? L_T.accent : L_T.ink}`, padding: '2px 7px' }}>{no}</span>
    <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: L_T.ink }}>{children}</span>
  </div>
);

// Lighter group sub-header (DEBTS / GOALS / RESULTING SPLIT)
const WFSub = ({ children, right }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '2px 0 8px', paddingBottom: 5, borderBottom: `1px solid ${L_T.faint}`, gap: 8, flexWrap: 'wrap' }}>
    <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', color: L_T.ink }}>{children}</span>
    {right}
  </div>
);

// One allocation slider with its impact badge at the bottom corner
const WFAllocRow = ({ item, amount, idx, disabled, onChange, first }) => {
  const pct = (amount / WF_TOTAL) * 100;
  const isDebt = item.type === 'debt';
  let badge, bc;
  if (isDebt) {
    const mo = item.moAtFull * amount / WF_TOTAL;
    const moD = amount === 0 ? '0' : (mo < 1 ? mo.toFixed(1) : String(Math.round(mo)));
    badge = 'DEBT-FREE  +' + moD + ' MO';
    bc = amount > 0 ? L_T.positive : L_T.faint;
  } else {
    const pp = amount / item.target * 100;
    const ppD = amount === 0 ? '0' : (pp < 1 ? pp.toFixed(1) : String(Math.round(pp)));
    const now = Math.round((item.saved + amount) / item.target * 100);
    badge = '+' + ppD + '% PROGRESS  ·  NOW ' + now + '%';
    bc = amount > 0 ? L_T.accent : L_T.faint;
  }
  const barColor = amount === 0 ? L_T.ruleSoft : (isDebt ? L_T.negative : L_T.accent);
  return (
    <div style={{ padding: '13px 0', borderTop: first ? 'none' : `1px dashed ${L_T.faint}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, fontSize: 13, fontWeight: 700, letterSpacing: '0.02em' }}>
          {isDebt
            ? <span style={{ fontSize: 9, fontWeight: 700, color: L_T.negative, border: `1px solid ${L_T.negative}`, padding: '1px 5px', letterSpacing: '0.06em' }}>{item.rank} · {item.apr} APR</span>
            : (item.priority ? <span style={{ color: L_T.accent }}>★</span> : null)}
          {item.label}
          {!isDebt && <span style={{ fontSize: 9, color: item.status === 'BEHIND' ? L_T.negative : L_T.muted, letterSpacing: '0.1em' }}>{item.status}</span>}
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: amount > 0 ? L_T.ink : L_T.faint }}>₹{amount.toLocaleString('en-IN')}</span>
      </div>
      <div style={{ position: 'relative', height: 10, background: L_T.ruleSoft }}>
        <div style={{ position: 'absolute', height: '100%', width: pct + '%', background: barColor }} />
        <input
          type="range" min="0" max="100000" step="1000" value={amount} disabled={disabled}
          onChange={e => onChange(idx, parseInt(e.target.value, 10))}
          style={{ position: 'absolute', top: -7, left: 0, width: '100%', height: 24, opacity: 0, cursor: disabled ? 'not-allowed' : 'pointer' }}
        />
        <div style={{ position: 'absolute', top: '50%', left: pct + '%', width: 14, height: 18, background: disabled ? L_T.muted : L_T.ink, transform: 'translate(-50%, -50%)', pointerEvents: 'none' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6, gap: 8 }}>
        <span style={{ fontSize: 9, color: L_T.muted, letterSpacing: '0.1em' }}>{pct.toFixed(0)}% OF WINDFALL</span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: bc }}>▸ {badge}</span>
      </div>
    </div>
  );
};

const LWindfallV2 = ({ mobile, business }) => {
  const [mode, setMode] = useS2('engine');           // 'engine' | 'manual'
  const [manual, setManual] = useS2(WF_engineAlloc);
  const alloc = mode === 'engine' ? WF_engineAlloc : manual;
  const assigned = alloc.reduce((s, x) => s + x, 0);
  const left = WF_TOTAL - assigned;

  const setItem = (idx, v) => {
    setManual(prev => {
      const others = prev.reduce((s, x, i) => (i === idx ? s : s + x), 0);
      const cap = Math.min(WF_items[idx].type === 'debt' ? WF_items[idx].balance : WF_TOTAL, WF_TOTAL - others);
      const nv = Math.max(0, Math.min(Math.round(v / 1000) * 1000, cap));
      const next = [...prev]; next[idx] = nv; return next;
    });
  };
  const goManual = () => { setManual(alloc); setMode('manual'); };
  const resetEngine = () => { setManual(WF_engineAlloc); setMode('engine'); };

  const debtIdx = WF_items.map((it, i) => (it.type === 'debt' ? i : -1)).filter(i => i >= 0);
  const goalIdx = WF_items.map((it, i) => (it.type === 'goal' ? i : -1)).filter(i => i >= 0);

  const toGoals = goalIdx.reduce((s, i) => s + alloc[i], 0);
  const monthsSaved = debtIdx.reduce((s, i) => s + WF_items[i].moAtFull * alloc[i] / WF_TOTAL, 0);
  const interestAvoided = debtIdx.reduce((s, i) => s + alloc[i] * WF_aprNum[WF_items[i].id] / 100, 0);
  const goalsBoosted = goalIdx.filter(i => alloc[i] > 0).length;

  const segments = WF_items
    .map((it, i) => ({ id: it.id, label: it.label + ' · ₹' + alloc[i].toLocaleString('en-IN'), value: alloc[i], color: it.type === 'debt' ? L_T.negative : (it.priority ? L_T.accent : '#a8a8a3'), textColor: '#fff' }))
    .filter(s => s.value > 0)
    .concat(left > 0 ? [{ id: 'idle', label: 'UNALLOCATED · ₹' + left.toLocaleString('en-IN'), value: left, color: L_T.ruleSoft, textColor: L_T.ink }] : []);

  return (
    <LShell>
      <LMastheadV2 section="tools" mobile={mobile} business={business} stmt="§8a-WINDFALL" />
      <div style={{ flex: 1, overflow: 'auto', padding: mobile ? '14px 18px 28px' : '18px 32px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>

        <section>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', color: L_T.accent, fontWeight: 700, marginBottom: 6 }}>
            §8a · WINDFALL · ALLOCATE A LUMP-SUM INFLOW · 14 MAY 2026
          </div>
          <div style={{ fontSize: mobile ? 20 : 26, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 4 }}>
            GOT A BONUS? WHERE SHOULD IT GO?
          </div>
        </section>

        {/* 01 · INPUT */}
        <section style={{ border: `1px solid ${L_T.ink}`, padding: mobile ? '14px 16px' : '18px 22px' }}>
          <WFHead no="01">INPUT</WFHead>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr 1fr 1fr', gap: 16 }}>
            <LField label="AMOUNT" value="1,00,000" prefix="₹" />
            <LField label="FROM" value="ANNUAL BONUS" hint="TAXABLE" />
            <LField label="WHEN RECEIVED" value="14 MAY 2026" />
            <LField label="AS OF · TODAY" value="14 MAY 2026" hint="DECISION LOG STAMP" />
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: L_T.muted, letterSpacing: '0.04em' }}>
            ENGINE CONSIDERS: HIGHEST EFFECTIVE APR · EF SHORTFALL · {WF_goals.length} ACTIVE GOAL{WF_goals.length === 1 ? '' : 'S'} · {Math.round(_A.user.marginalRate * 100)}% MARGINAL RATE
          </div>
        </section>

        {/* 02 · ALLOCATE — per-target sliders */}
        <section style={{ border: `2px solid ${L_T.ink}`, padding: mobile ? '16px 18px' : '22px 26px' }}>
          <WFHead no="02" accent>ALLOCATE THE WINDFALL</WFHead>

          {/* mode toggle */}
          <div style={{ display: 'flex', marginBottom: 14, border: `1px solid ${L_T.ink}`, width: 'fit-content', maxWidth: '100%', flexWrap: 'wrap' }}>
            {[['engine', 'ENGINE PICK · OPTIMAL'], ['manual', 'MANUAL UPDATE']].map(([k, lbl], i) => (
              <button
                key={k}
                onClick={k === 'engine' ? resetEngine : goManual}
                style={{
                  fontFamily: L_mono, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
                  padding: '9px 16px', cursor: 'pointer', border: 'none',
                  borderLeft: i > 0 ? `1px solid ${L_T.ink}` : 'none',
                  background: mode === k ? L_T.ink : 'transparent',
                  color: mode === k ? L_T.bg : L_T.muted,
                }}
              >{lbl}</button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: L_T.muted, lineHeight: 1.7, marginBottom: 18 }}>
            {mode === 'engine'
              ? 'ENGINE PICK SETS EACH SLIDER TO THE OPTIMAL MATH — IT CRUSHES THE HIGHEST EFFECTIVE-APR DEBT FIRST (AVALANCHE). SWITCH TO MANUAL UPDATE TO OVERRIDE ANY SLIDER.'
              : 'MANUAL · DRAG ANY SLIDER. THE POOL IS CAPPED AT ₹1,00,000 — EACH SLIDER STOPS AT WHATEVER IS LEFT. RESET TO ENGINE PICK RESTORES THE OPTIMAL SPLIT.'}
          </div>

          {/* pool meter */}
          <div style={{ margin: '0 0 22px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, fontSize: 11, flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontWeight: 700, letterSpacing: '0.04em' }}>₹{WF_TOTAL.toLocaleString('en-IN')} TO ALLOCATE</span>
              <span style={{ letterSpacing: '0.04em' }}>
                <span style={{ fontWeight: 700 }}>₹{assigned.toLocaleString('en-IN')}</span>
                <span style={{ color: L_T.muted }}> ASSIGNED · </span>
                <span style={{ fontWeight: 700, color: left > 0 ? L_T.accent : L_T.positive }}>₹{left.toLocaleString('en-IN')}</span>
                <span style={{ color: L_T.muted }}> LEFT</span>
              </span>
            </div>
            <div style={{ display: 'flex', height: 8, border: `1px solid ${L_T.ink}` }}>
              <div style={{ width: (assigned / WF_TOTAL * 100) + '%', background: L_T.ink }} />
            </div>
          </div>

          {/* DEBTS — highest APR first */}
          <WFSub right={<span style={{ fontSize: 9, color: L_T.muted, letterSpacing: '0.12em' }}>PAID FIRST · AVALANCHE ORDER</span>}>DEBTS · HIGHEST APR FIRST</WFSub>
          {debtIdx.map((i, k) => (
            <WFAllocRow key={WF_items[i].id} item={WF_items[i]} amount={alloc[i]} idx={i} disabled={mode === 'engine'} onChange={setItem} first={k === 0} />
          ))}

          {/* GOALS */}
          <div style={{ marginTop: 18 }}>
            <WFSub right={<span style={{ fontSize: 9, color: L_T.muted, letterSpacing: '0.12em' }}>★ = PRIORITY · HARD-LOCKED</span>}>GOALS</WFSub>
            {goalIdx.map((i, k) => (
              <WFAllocRow key={WF_items[i].id} item={WF_items[i]} amount={alloc[i]} idx={i} disabled={mode === 'engine'} onChange={setItem} first={k === 0} />
            ))}
          </div>

          {/* resulting split bar */}
          <div style={{ marginTop: 22 }}>
            <WFSub>RESULTING SPLIT</WFSub>
            <LAllocationBar segments={segments} />
          </div>

          {/* impact KPIs */}
          <div style={{ marginTop: 18 }}>
            <LKpi mobile={mobile} cols={mobile ? 2 : 4} items={[
              { l: 'INTEREST AVOIDED', v: '₹' + Math.round(interestAvoided).toLocaleString('en-IN'), s: '12-MO · ON DEBT PORTION', tone: L_T.positive },
              { l: 'DEBT-FREE SHIFT',  v: monthsSaved > 0 ? '−' + (monthsSaved < 1 ? monthsSaved.toFixed(1) : Math.round(monthsSaved)) + ' MO' : '0', s: 'SOONER VS NO PREPAY', tone: monthsSaved > 0 ? L_T.positive : L_T.muted },
              { l: 'TO GOALS',         v: '₹' + toGoals.toLocaleString('en-IN'), s: goalsBoosted + ' GOAL' + (goalsBoosted === 1 ? '' : 'S') + ' BOOSTED', tone: L_T.accent },
              { l: 'UNALLOCATED',      v: '₹' + left.toLocaleString('en-IN'), s: left > 0 ? 'STILL TO ASSIGN' : 'FULLY ASSIGNED', tone: left > 0 ? L_T.negative : L_T.ink },
            ]} />
          </div>
        </section>

        {/* actions */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button style={{ padding: '10px 16px', background: L_T.ink, color: L_T.bg, border: 'none', fontFamily: L_mono, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', cursor: 'pointer' }}>
            [ APPLY · LOG TO ACTIVITY ]
          </button>
          <span onClick={resetEngine} style={{ cursor: 'pointer' }}><LBracket>RESET TO ENGINE PICK</LBracket></span>
          <LBracket>SAVE BRIEF</LBracket>
          <LBracket>OPEN ENGINE EXPLAINER</LBracket>
        </div>

        {/* THE MATH — kept exactly as the windfall tab shows it */}
        <LMathBlock rows={[
          { lhs: 'total_windfall',   rhs: '₹' + WF_TOTAL.toLocaleString('en-IN') },
          { lhs: 'strategy',         rhs: mode === 'engine' ? 'AVALANCHE · ENGINE' : 'MANUAL OVERRIDE', note: 'HIGHEST EFF APR FIRST' },
          ...debtIdx.filter(i => alloc[i] > 0).map(i => ({ lhs: '→ ' + WF_items[i].label.toLowerCase().replace(' ', '_'), rhs: '₹' + alloc[i].toLocaleString('en-IN'), note: '@ ' + WF_items[i].apr + ' APR' })),
          { lhs: 'to_goals',         rhs: '₹' + toGoals.toLocaleString('en-IN'), note: goalsBoosted + ' GOAL' + (goalsBoosted === 1 ? '' : 'S') + ' BOOSTED' },
          { lhs: 'interest_avoided', rhs: '₹' + Math.round(interestAvoided).toLocaleString('en-IN'), tone: 'pos', note: 'Σ(amt × apr) · 12-MO' },
          { lhs: 'unallocated',      rhs: '₹' + left.toLocaleString('en-IN'), tone: left > 0 ? 'neg' : null },
        ]} />
      </div>
    </LShell>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// ACTIVITY — central registration hub
//   Every actual + future event is logged here:
//     - Payments (full / partial / skipped) per debt per month
//     - Rate updates (when bank SMS confirms a floating-rate reset)
//     - Expense changes (rent up, subscription added)
//     - Income changes (hike, bonus, side-income)
//     - Lifecycle events (annual review, slab cross, PMI drop)
//     - "I'll actually do this" sensitivity apply-outs
//   The plan recomputes off this ledger.
// ═══════════════════════════════════════════════════════════════════════
const LActivityScreen = ({ mobile, business }) => {
  const [modalOpen, setModalOpen] = useS2(true);   // demo: modal pinned open
  const [modalType, setModalType] = useS2('PAYMENT');
  const [modalStatus, setModalStatus] = useS2('FULL');
  const [collapsed, setCollapsed] = useS2({}); // monthKey -> true means collapsed
  const grouped = V2.activity.reduce((acc, r) => {
    (acc[r.month] = acc[r.month] || []).push(r);
    return acc;
  }, {});
  const monthOrder = ['JUN 26', 'MAY 26', 'APR 26'];
  const monthMeta = {
    'JUN 26': { label: 'UPCOMING',     accent: L_T.muted },
    'MAY 26': { label: 'IN PROGRESS',  accent: L_T.accent },
    'APR 26': { label: 'CLOSED',       accent: L_T.positive },
  };
  const totalEntries = V2.activity.length;
  const lastEntry = V2.activity.find(r => r.status !== 'PENDING' && r.status !== 'AWAITING BANK');

  return (
    <LShell>
      <LMastheadV2 section="activity" mobile={mobile} business={business} stmt="#1138-ACTIVITY" />
      <div style={{ flex: 1, overflow: 'auto', padding: mobile ? '14px 18px 28px' : '18px 32px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* KPI strip — plain English */}
        <section>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 6 }}>
            $ ACTIVITY · ONE PLACE FOR EVERY UPDATE · {totalEntries} ENTRIES YTD
          </div>
          <LKpi mobile={mobile} cols={mobile ? 2 : 4} items={[
            { l: 'ENTRIES LOGGED',  v: String(totalEntries),  s: 'PAYMENTS · RATES · EXPENSES · INCOME' },
            { l: 'LAST LOGGED',     v: lastEntry ? lastEntry.date.slice(0, 6) : '—', s: '2D AGO · KOTAK PAID',     tone: L_T.accent },
            { l: 'PLAN AHEAD BY',   v: '−2.4 MO',             s: 'NET OF ALL LOGGED ENTRIES',                       tone: L_T.positive },
            { l: 'INTEREST CHANGE', v: '−₹18,200',            s: 'SAVED · FROM ON-TIME + EXTRAS',                   tone: L_T.positive },
          ]} />
        </section>

        {/* Two-col layout: main ledger on the left, modal preview pinned on the right */}
        <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1.55fr 1fr', gap: 22 }}>

          {/* LEFT · main activity ledger ─────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <section>
              <LSectionHeader right={
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  <span onClick={() => setModalOpen(true)} style={{ cursor: 'pointer' }}><LBracket accent>[ + LOG NEW ENTRY ]</LBracket></span>
                  <LBracket>FILTER</LBracket>
                  <LBracket>EXPORT</LBracket>
                </span>
              }>ACTIVITY LEDGER · ALL EVENTS</LSectionHeader>

              {/* Month jump-strip · scales to 6/12/24+ months · collapse to keep current month tight */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 0', borderTop: `1px dashed ${L_T.faint}`, borderBottom: `1px dashed ${L_T.faint}`, marginTop: 6, alignItems: 'baseline' }}>
                <span style={{ fontSize: 9, letterSpacing: '0.14em', color: L_T.muted, marginRight: 4 }}>JUMP →</span>
                {monthOrder.map(m => {
                  const isCol = collapsed[m];
                  const n = (grouped[m] || []).length;
                  return (
                    <span key={m} onClick={() => setCollapsed(c => ({ ...c, [m]: !c[m] }))} style={{ cursor: 'pointer' }}>
                      <LBracket active={!isCol}>{m} · {n}</LBracket>
                    </span>
                  );
                })}
                <span style={{ fontSize: 9, color: L_T.muted, letterSpacing: '0.06em', marginLeft: 'auto' }}>
                  CLICK A MONTH TO COLLAPSE · OLDER MONTHS STAY OUT OF THE WAY AS THE LEDGER GROWS
                </span>
              </div>
            </section>

            {monthOrder.map(month => {
              const meta = monthMeta[month];
              const rows = grouped[month] || [];
              const done = rows.filter(r => r.status !== 'PENDING' && r.status !== 'AWAITING BANK').length;
              const isCol = collapsed[month];
              return (
                <section key={month}>
                  <div onClick={() => setCollapsed(c => ({ ...c, [month]: !c[month] }))} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: `2px solid ${L_T.ink}`, padding: '10px 0', marginBottom: 0 }}>
                    <span style={{ fontSize: 12, letterSpacing: '0.18em', color: L_T.ink, fontWeight: 700 }}>$ {month} · {meta.label}</span>
                    <span style={{ display: 'inline-flex', gap: 10, alignItems: 'baseline' }}>
                      <span style={{ fontSize: 10, color: meta.accent, letterSpacing: '0.1em', fontWeight: 700 }}>{done} / {rows.length} LOGGED</span>
                      <LBracket>{isCol ? '↓ EXPAND' : '↑ COLLAPSE'}</LBracket>
                    </span>
                  </div>
                  {!isCol && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr style={{ borderTop: `1px solid ${L_T.ink}`, borderBottom: `1px dashed ${L_T.faint}` }}>
                          {['DUE', 'TYPE', 'TARGET', 'PLANNED', 'ACTUAL', 'STATUS', 'IMPACT', 'NOTE', ''].map((h, i) => (
                            <th key={i} style={{ padding: '6px 10px', textAlign: i > 2 && i < 7 ? 'right' : 'left', fontWeight: 700, fontSize: 9, color: L_T.muted, letterSpacing: '0.08em' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => {
                          const pending = r.status === 'PENDING' || r.status === 'AWAITING BANK';
                          const partial = r.status === 'PAID PARTIAL';
                          const tone = r.status === 'PAID FULL' || r.status === 'APPLIED' || r.status === 'CONFIRMED' ? L_T.positive
                                     : partial ? L_T.negative
                                     : pending ? L_T.muted : L_T.ink;
                          // r.date is "12 MAY 26" — strip year (month section header conveys it)
                          const parts = r.date.split(' ');
                          const dueDay = parts[0];
                          const dueMon = parts[1] || '';
                          return (
                            <tr key={i} style={{ borderBottom: `1px dashed ${L_T.faint}`, background: pending ? L_T.highlightSoft : 'transparent', opacity: pending ? 0.85 : 1 }}>
                              <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', minWidth: 78 }}>
                                <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', color: L_T.ink, fontVariantNumeric: 'tabular-nums' }}>{dueDay}</span>
                                <span style={{ fontSize: 9, color: L_T.muted, letterSpacing: '0.12em', marginLeft: 4, fontWeight: 600 }}>{dueMon}</span>
                              </td>
                              <td style={{ padding: '9px 10px', color: L_T.accent, fontSize: 9, letterSpacing: '0.14em', fontWeight: 700, whiteSpace: 'nowrap' }}>{r.type}</td>
                              <td style={{ padding: '9px 10px', fontWeight: 700, whiteSpace: 'nowrap' }}>{r.target}</td>
                              <td style={{ padding: '9px 10px', textAlign: 'right', color: L_T.muted, whiteSpace: 'nowrap' }}>{r.planned}</td>
                              <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: tone, whiteSpace: 'nowrap' }}>{r.actual}</td>
                              <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 9, letterSpacing: '0.12em', fontWeight: 700, color: tone, whiteSpace: 'nowrap' }}>{r.status}</td>
                              <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: r.impact.startsWith('−') ? L_T.positive : r.impact.startsWith('+') ? L_T.negative : L_T.muted, whiteSpace: 'nowrap' }}>{r.impact}</td>
                              <td style={{ padding: '9px 10px', color: L_T.muted, fontSize: 10, maxWidth: 180 }}>{r.note || '—'}</td>
                              <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                                {pending
                                  ? <span onClick={() => { setModalOpen(true); setModalType(r.type); }} style={{ cursor: 'pointer' }}><LBracket accent>LOG NOW</LBracket></span>
                                  : <span style={{ display: 'inline-flex', gap: 4 }}><LBracket>EDIT</LBracket><LBracket>UNDO</LBracket></span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  )}
                </section>
              );
            })}

            <section style={{ borderTop: `1px dashed ${L_T.faint}`, paddingTop: 12, fontSize: 10, color: L_T.muted, lineHeight: 1.7, letterSpacing: '0.04em' }}>
              EVERY ROW HERE IS THE SINGLE SOURCE OF TRUTH FOR ITS EVENT. THE PLAN RECOMPUTES OFF THIS LEDGER · NO OTHER SCREEN STORES STATE.
              <br />
              MISSED A PAYMENT? <LBracket>LOG MISSED</LBracket> RATE CHANGED? <LBracket>LOG RATE</LBracket> NEW EXPENSE? <LBracket>LOG EXPENSE</LBracket>
            </section>
          </div>

          {/* RIGHT · modal preview pinned open ───────────────────────────── */}
          <div>
            <div style={{ position: mobile ? 'static' : 'sticky', top: 12 }}>
              {modalOpen ? (
                <div style={{ border: `2px solid ${L_T.ink}`, background: L_T.paper, padding: mobile ? '16px 18px' : '20px 22px', boxShadow: '6px 6px 0 0 ' + L_T.ink }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, flexWrap: 'wrap', gap: 6 }}>
                    <span style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.accent, fontWeight: 700 }}>$ NEW ENTRY · LOG ACTUALS</span>
                    <span onClick={() => setModalOpen(false)} style={{ cursor: 'pointer' }}><LBracket>[ × CLOSE ]</LBracket></span>
                  </div>

                  <div style={{ fontSize: 10, color: L_T.muted, letterSpacing: '0.12em', marginBottom: 6 }}>WHAT KIND OF EVENT?</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 16 }}>
                    {['PAYMENT', 'PARTIAL', 'RATE UPDATE', 'EXPENSE CHANGE', 'INCOME CHANGE', 'LIFECYCLE'].map(t => (
                      <span key={t} onClick={() => setModalType(t)} style={{ cursor: 'pointer' }}>
                        <LBracket active={modalType === t} accent={modalType !== t}>{t}</LBracket>
                      </span>
                    ))}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <LField label="DATE"      value="14 MAY 2026" hint="WHEN IT ACTUALLY HAPPENED" />
                    <LField label="TARGET"    value="KOTAK CC ▾" hint="DEBT / EF / GOAL / SOURCE" />
                    <LField label="PLANNED"   value="₹18,500"    hint="WHAT THE ENGINE SCHEDULED" prefix="₹" />
                    <LField label="ACTUAL"    value="₹18,500"    hint="WHAT YOU ACTUALLY PAID" prefix="₹" />
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 9, letterSpacing: '0.14em', color: L_T.muted, marginBottom: 6 }}>STATUS</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {['PAID FULL', 'PARTIAL', 'SKIPPED', 'OVERPAID'].map(s => (
                        <span key={s} onClick={() => setModalStatus(s.split(' ')[0])} style={{ cursor: 'pointer' }}>
                          <LBracket active={modalStatus === s.split(' ')[0]}>{s}</LBracket>
                        </span>
                      ))}
                    </div>
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <LField label="NOTE · OPTIONAL" value="—" hint="ANYTHING TO REMEMBER" />
                  </div>

                  {/* preview pane — engine impact before applying */}
                  <div style={{ marginTop: 16, padding: '10px 12px', background: L_T.highlightSoft, border: `1px dashed ${L_T.ink}` }}>
                    <div style={{ fontSize: 9, letterSpacing: '0.14em', color: L_T.muted, marginBottom: 6 }}>$ ENGINE PREVIEW · BEFORE YOU APPLY</div>
                    <div style={{ fontSize: 11, lineHeight: 1.7, color: L_T.ink }}>
                      DEBT-FREE · <span style={{ color: L_T.positive, fontWeight: 700 }}>−1.4 MO</span> → JUL 2027<br />
                      INTEREST · <span style={{ color: L_T.positive, fontWeight: 700 }}>−₹24,780</span><br />
                      EF COVERAGE · <span style={{ color: L_T.muted }}>50% UNCHANGED</span>
                    </div>
                  </div>

                  <div style={{ marginTop: 16, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button style={{ flex: 1, minWidth: 180, padding: '12px 14px', background: L_T.ink, color: L_T.bg, border: 'none', fontFamily: L_mono, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', cursor: 'pointer' }}>
                      [ APPLY &amp; RECOMPUTE PLAN ]
                    </button>
                    <span onClick={() => setModalOpen(false)} style={{ cursor: 'pointer' }}><LBracket>CANCEL</LBracket></span>
                  </div>

                  <div style={{ marginTop: 12, fontSize: 9, letterSpacing: '0.08em', color: L_T.muted, lineHeight: 1.6 }}>
                    THIS PANEL APPEARS AS A POPUP IN THE LIVE APP · STAYS PINNED HERE FOR PREVIEW · APPLY UPDATES ENTIRE PLAN.
                  </div>
                </div>
              ) : (
                <div style={{ border: `1px dashed ${L_T.ink}`, padding: 22, textAlign: 'center', fontSize: 11, color: L_T.muted, letterSpacing: '0.1em' }}>
                  <div style={{ marginBottom: 10 }}>MODAL CLOSED</div>
                  <span onClick={() => setModalOpen(true)} style={{ cursor: 'pointer' }}><LBracket accent>[ OPEN MODAL AGAIN ]</LBracket></span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </LShell>
  );
};

Object.assign(window, { LDebtsV2, LInsightsV2, LGoalsScreen, LTaxScreen, LPortfolioScreen, LWindfallV2, LActivityScreen });
