// ═══════════════════════════════════════════════════════════════════════
// LEDGER SKIN · V2 — missing features re-introduced
// Walks the LEDGER_MISSING.md list, places each item per the design
// conversation. Original screens stay intact for comparison.
// ═══════════════════════════════════════════════════════════════════════
const _A = window.APP;
const { useState, useMemo } = React;

// ──── extended mock data ────────────────────────────────────────────────
const V2 = {
  goals: [
    { id: 'house',   label: 'HOUSE DOWNPAYMENT', target: 1500000, saved: 480000,  eta: 'DEC 2027', monthly: 35000, priority: true,  status: 'BEHIND' },
    { id: 'wedding', label: "DAUGHTER'S WEDDING", target: 2500000, saved: 1320000, eta: 'AUG 2031', monthly: 18000, priority: false, status: 'ON TRACK' },
    { id: 'sabb',    label: 'SABBATICAL · 6 MO', target: 600000,  saved: 510000,  eta: 'FEB 2027', monthly: 12000, priority: false, status: 'FUNDED' },
    { id: 'car',     label: 'CAR REPLACEMENT',  target: 800000,  saved: 120000,  eta: 'JUL 2028', monthly: 14000, priority: false, status: 'BEHIND' },
  ],
  surplusWaterfall: [
    { id: 'kotak',    label: 'KOTAK CC',     amount: 18500, color: '#c96442', pct: 17.6 },
    { id: 'hdfc-pl',  label: 'HDFC PL',      amount: 11400, color: '#0a0a0a', pct: 10.9 },
    { id: 'sbi',      label: 'SBI AUTO',     amount: 5200,  color: '#2a2a26', pct: 5.0 },
    { id: 'hdfc-hl',  label: 'HDFC HL',      amount: 35200, color: '#5e5e58', pct: 33.5 },
    { id: 'ef',       label: 'EF TOP-UP',    amount: 12000, color: '#15803d', pct: 11.4 },
    { id: 'goals',    label: 'GOALS',        amount: 18000, color: '#a8a8a3', pct: 17.1 },
    { id: 'idle',     label: 'IDLE',         amount: 4700,  color: '#d8d6cd', pct: 4.5 },
  ],
  activityImpact: {
    entries: 3,
    monthsShift: -2,
    interestDelta: '−₹18,200',
    since: 'APR 27',
  },
  recentActivity: [
    { date: 'MAY 12', kind: 'PAID',   text: '₹18,500 → KOTAK CC',     impact: '−1.4 MO',  tone: 'pos' },
    { date: 'MAY 03', kind: 'PARTIAL',text: '₹6,500 (of ₹11,400) → HDFC PL', impact: '+0.3 MO', tone: 'neg' },
    { date: 'APR 27', kind: 'PAID',   text: '₹35,200 → HDFC HL',      impact: '0',        tone: 'mute' },
  ],
  assumptions: ['HIKE = +8% / Y · STARTS APR 27', 'NEVER MISS MIN EMI', 'TAX SHIELD REINVESTED', 'EF · 30% OF SURPLUS · TARGET 6 MO TAKE-HOME', 'INFLATION +6% / Y', 'FX DRIFT OFF · NRI ONLY'],
  centralBank: { last: 'RBI HELD 5.25% · 4 APR', next: 'NEXT MTG · 7 JUN' },
  cashManagement: [
    { where: 'HDFC SAVINGS',       balance: '₹3,00,000', yield: '3.00%',  drag: '−₹14,400/Y vs FD', tone: 'neg' },
    { where: 'AXIS LIQUID FUND',   balance: '₹1,20,000', yield: '6.80%',  drag: '—',                 tone: 'mute' },
    { where: 'KOTAK SWEEP-IN FD',  balance: '₹50,000',   yield: '7.10%',  drag: '—',                 tone: 'mute' },
  ],
  advanceTax: [
    { due: '15 JUN 26', q: 'Q1', pct: '15%', amount: '₹47,000', status: 'PENDING', daysOut: 32 },
    { due: '15 SEP 26', q: 'Q2', pct: '45%', amount: '₹94,000', status: 'SCHEDULED', daysOut: 124 },
    { due: '15 DEC 26', q: 'Q3', pct: '75%', amount: '₹94,000', status: 'SCHEDULED', daysOut: 215 },
    { due: '15 MAR 27', q: 'Q4', pct: '100%', amount: '₹78,000', status: 'SCHEDULED', daysOut: 306 },
  ],
  taxByLoan: [
    { loan: 'HDFC HOME LOAN', section: 'SEC 24', deduction: '₹2,00,000', shield: '₹60,000', rate: '30%' },
    { loan: 'HDFC HOME LOAN', section: 'SEC 80C (PRIN)', deduction: '₹1,50,000', shield: '₹45,000', rate: '30%' },
  ],
  holdings: [
    { sym: 'NIFTY 50 ETF',  qty: 320, avg: '₹245',  ltp: '₹289',  cost: '₹78,400', mv: '₹92,480', pnl: '+₹14,080', pnlPct: '+18.0%', tone: 'pos' },
    { sym: 'GOLD ETF',      qty: 80,  avg: '₹620',  ltp: '₹712',  cost: '₹49,600', mv: '₹56,960', pnl: '+₹7,360',  pnlPct: '+14.8%', tone: 'pos' },
    { sym: 'HDFC FD 13M',   qty: 1,   avg: '₹2,00,000', ltp: '₹2,11,440', cost: '₹2,00,000', mv: '₹2,11,440', pnl: '+₹11,440', pnlPct: '+5.7%', tone: 'pos' },
    { sym: 'PARAG PARIKH FCF', qty: 95, avg: '₹62.4', ltp: '₹58.1', cost: '₹5,928', mv: '₹5,519', pnl: '−₹409',  pnlPct: '−6.9%',  tone: 'neg' },
  ],
  perLoanTrajectory: [
    { name: 'KOTAK CC',   clear: 'JUL 26',  cur: 1.00, balPath: [1.0, 0.6, 0.3, 0.0], months: ['MAY 26','JUN 26','JUL 26','AUG 26'] },
    { name: 'HDFC PL',    clear: 'FEB 27',  cur: 0.95, balPath: [1.0, 0.86, 0.71, 0.55, 0.38, 0.20, 0.04, 0.0] },
    { name: 'SBI AUTO',   clear: 'NOV 29',  cur: 0.98, balPath: [1.0, 0.95, 0.90, 0.84, 0.78, 0.71, 0.63, 0.55, 0.46, 0.36, 0.25, 0.13, 0.0] },
    { name: 'HDFC HL',    clear: 'OCT 40',  cur: 0.99, balPath: Array.from({length: 14}, (_, i) => 1 - i*0.075) },
  ],
  // What the engine modelled this month — every figure traceable
  payThisMonth: [
    { target: 'KOTAK CC',       kind: 'PAY FULL',    amount: 16543, due: '01 JUN', accent: true,
      note: 'CLEAR BALANCE · STOPS 42.48% APR BLEED', priority: 'CRITICAL' },
    { target: 'HDFC PL',        kind: 'EMI',         amount: 11427, due: '05 JUN',
      note: 'SCHEDULED · 14.5% NOM' },
    { target: 'SBI AUTO',       kind: 'EMI',         amount: 5218,  due: '07 JUN',
      note: 'SCHEDULED · 9.25% NOM' },
    { target: 'HDFC HL',        kind: 'EMI',         amount: 35184, due: '05 JUN',
      note: 'SCHEDULED · 8.50% FLOATING · RESET 30 JUN' },
    { target: 'EMERGENCY FUND', kind: 'TOP-UP',      amount: 12000, due: '15 JUN',
      note: 'EF AT 50% TARGET · ENGINE WANTS 100% BEFORE ACCELERATE' },
    { target: 'HOUSE GOAL ★',   kind: 'CONTRIB',     amount: 18000, due: '15 JUN', priority: 'PRIORITY',
      note: 'PRIORITY GOAL · HARD-LOCKED' },
    { target: 'WEDDING GOAL',   kind: 'CONTRIB',     amount: 4500,  due: '15 JUN',
      note: 'ON TRACK' },
    { target: 'CAR GOAL',       kind: 'CONTRIB',     amount: 2000,  due: '15 JUN',
      note: 'BEHIND · NEEDS ATTN' },
  ],
  // The modelling inputs that produced the figures above — editable
  assumptionsList: [
    { cmd: 'STRATEGY',     val: 'AVALANCHE',     hint: 'POST-TAX APR ORDER' },
    { cmd: 'PLAN START',   val: 'MAY 2026',      hint: 'EDIT IN SETUP' },
    { cmd: 'TAX REGIME',   val: 'NEW · 30%',     hint: 'MARGINAL RATE' },
    { cmd: 'INFLATION',    val: '6.0% / Y',      hint: 'CPI ROLLING' },
    { cmd: 'HIKE RATE',    val: '8.0% / Y',      hint: 'AT YOUR COMPANY' },
    { cmd: 'HIKE MONTH',   val: 'APR · ANNUAL',  hint: 'WHEN YOUR APPRAISAL LANDS' },
    { cmd: 'EF RULE',      val: '30% SURPLUS', hint: 'TARGET = 6 MO TAKE-HOME · USER-PICK 3 / 6 / 9 / 12' },
    { cmd: 'FX DRIFT',     val: 'OFF',           hint: 'NRI ONLY' },
    { cmd: 'MIN EMI',      val: 'ON',            hint: 'NEVER MISS SCHEDULED EMI' },
  ],
  // Cash flow primitives — salary, inflated expense, surplus
  cashFlow: {
    takeHome: 180000,
    takeHomeNote: 'POST-TAX · NEW REGIME · +8% HIKE LANDS APR 2027',
    expense: 75000,
    expenseNote: 'INFLATED +6% Y/Y · BASE ₹70,755 (APR) · NEXT MO ₹75,375',
    surplus: 105000,
    surplusNote: 'AVAILABLE TO ALLOCATE · ₹1,04,872 PLANNED · ₹128 UNUSED',
  },
  // Activity ledger — central registration point for every actual + future event
  activity: [
    // JUN 2026 — pending
    { date: '01 JUN 26', month: 'JUN 26', type: 'PAYMENT',  target: 'KOTAK CC', planned: '₹16,543',   actual: '—',         status: 'PENDING',       impact: '—',      note: 'Pay full · clears balance' },
    { date: '05 JUN 26', month: 'JUN 26', type: 'PAYMENT',  target: 'HDFC PL',  planned: '₹11,427',   actual: '—',         status: 'PENDING',       impact: '—',      note: 'Scheduled EMI' },
    { date: '15 JUN 26', month: 'JUN 26', type: 'ALLOC',    target: 'EF TOP-UP',planned: '₹12,000',   actual: '—',         status: 'PENDING',       impact: '—',      note: 'EF at 50% → push to 100%' },
    { date: '30 JUN 26', month: 'JUN 26', type: 'RATE',     target: 'HDFC HL',  planned: '8.50% NOW', actual: '—',         status: 'AWAITING BANK', impact: '—',      note: 'Floating reset · RBI-dependent · log here when SMS arrives' },
    // MAY 2026 — in progress
    { date: '12 MAY 26', month: 'MAY 26', type: 'PAYMENT',  target: 'KOTAK CC', planned: '₹18,500',   actual: '₹18,500',   status: 'PAID FULL',     impact: '−1.4 MO',note: '' },
    { date: '03 MAY 26', month: 'MAY 26', type: 'PAYMENT',  target: 'HDFC PL',  planned: '₹11,427',   actual: '₹6,500',    status: 'PAID PARTIAL',  impact: '+0.3 MO',note: 'Shortfall logged · engine reflowed' },
    { date: '02 MAY 26', month: 'MAY 26', type: 'PAYMENT',  target: 'HDFC HL',  planned: '₹35,184',   actual: '₹35,184',   status: 'PAID FULL',     impact: '0',      note: '' },
    { date: '02 MAY 26', month: 'MAY 26', type: 'EXPENSE',  target: 'RENT',     planned: '—',         actual: '+₹3,000/mo',status: 'APPLIED',       impact: '+0.8 MO',note: 'Recurring · forward-applied' },
    // APR 2026 — closed
    { date: '27 APR 26', month: 'APR 26', type: 'PAYMENT',  target: 'HDFC HL',  planned: '₹35,184',   actual: '₹35,184',   status: 'PAID FULL',     impact: '0',      note: '' },
    { date: '15 APR 26', month: 'APR 26', type: 'INCOME',   target: 'SALARY',   planned: '—',         actual: '+₹15,000/mo',status: 'APPLIED',      impact: '−2.1 MO',note: 'Annual hike · +8.3%' },
    { date: '05 APR 26', month: 'APR 26', type: 'PAYMENT',  target: 'HDFC PL',  planned: '₹11,427',   actual: '₹11,427',   status: 'PAID FULL',     impact: '0',      note: '' },
    { date: '04 APR 26', month: 'APR 26', type: 'RATE',     target: 'HDFC HL',  planned: '8.50%',     actual: '8.50%',     status: 'CONFIRMED',     impact: '0',      note: 'RBI held repo · no change' },
  ],
  // Restructure opportunities — reframed for clarity (no "pp", explicit FROM→TO)
  restructureV2: [
    { id: 'bt-kotak', kind: 'BALANCE TRANSFER · CREDIT CARD', headlineFrom: '36.00% APR + 1.5%/MO FEE', headlineTo: '17.50% APR · FEE-FREE',
      explainer: 'Your Kotak CC is bleeding 42.48% all-in. HDFC offers a 0% balance-transfer for 3 months then 17.5%. You stop the GST + fee compound. Break-even is immediate; the fee is waived for existing-relationship customers.',
      savesAnnual: '₹24,780', breakeven: 'INSTANT · NO FEE', confidence: 'LIKELY APPROVED', recommendedAction: 'OPEN HDFC BT APPLICATION' },
    { id: 'refi-hdfc', kind: 'REFINANCE · HOME LOAN', headlineFrom: '8.50% MCLR + 215 BPS', headlineTo: '8.05% ICICI',
      explainer: 'You are on a 2018-era spread. ICICI is offering 8.05% for your profile. Switch saves ₹2.15L over remaining tenure. Processing fee ₹11K; break-even ~14 months. The Sec 24 shield carries over.',
      savesAnnual: '₹2,15,000', breakeven: '14 MO · ₹11K FEE', confidence: 'CIBIL 742 · APPROVED', recommendedAction: 'OPEN ICICI REFI APPLICATION' },
  ],
  negotiateScripts: {
    'bt-cc': {
      title: 'CC BALANCE TRANSFER · 0–1% PA · 3–6 MO',
      lines: [
        'CALL · HDFC CARDS · 1860 266 4332',
        '──',
        '"Hi, I\'m an existing HDFC customer with a savings + credit card relationship.',
        ' I have a Kotak credit card outstanding of ₹1,00,000 at 36% APR plus 1.5% monthly fees.',
        ' I\'ve been on-time on all my EMIs and cards for the last 12 months · CIBIL 742.',
        ' I\'d like to balance-transfer this onto my HDFC card at your 3-month 0% offer or 6-month 1%.',
        ' My current utilisation will drop to under 30% post-transfer.',
        ' Can you tell me the exact APR after the promo window, and confirm the BT fee?"',
        '──',
        'ASK FOR · BT fee waived (existing customer leverage), confirm post-promo APR ≤ 18%.',
      ],
    },
    'refi-hl': {
      title: 'HOME LOAN REFI · TARGET 8.05%',
      lines: [
        'CALL · YOUR CURRENT LENDER FIRST · HDFC HOME · 1860 267 6161',
        '──',
        '"I\'ve held this home loan with you since 2018 at 8.50% MCLR + 215bps.',
        ' I\'ve been informed ICICI is offering 8.05% for my profile · CIBIL 742 · LTV now ~52%.',
        ' Before I move, I want to give you the chance to retain me at 8.05% or better.',
        ' If you can match — I stay. If not, I\'ll move within 30 days."',
        '──',
        'ASK FOR · Spread reduction (cheapest path), no fee, written confirmation.',
        'IF DECLINED · Apply to ICICI; processing fee ~₹11K · breakeven 14 mo.',
      ],
    },
  },
};

// ──── primitives ────────────────────────────────────────────────────────

// Masthead with GOALS in main nav, TAX conditionally
const LMastheadV2 = ({ section, mobile, business, stmt = '#1138' }) => (
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
    <div style={{ display: 'flex', gap: mobile ? 12 : 18, padding: '8px 0', overflowX: 'auto', flexWrap: 'wrap' }}>
      {[
        ['LEDGER',   'home'],
        ['PLAN',     'plan'],
        ['DEBTS',    'debts'],
        ['GOALS',    'goals'],
        ['ACTIVITY', 'activity'],
        ['TOOLS',    'tools'],
        ['NOTES',    'insights'],
        ...(business ? [['TAX', 'tax']] : []),
        ['PORTFOLIO','portfolio'],
        ['SETUP',    'setup'],
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

// 26px horizontal stacked allocation bar — every segment carries a visible label
const LAllocationBar = ({ segments, height = 28 }) => {
  const total = segments.reduce((s, x) => s + (x.value ?? x.pct ?? 0), 0) || 1;
  return (
    <div style={{ display: 'flex', height, border: `1px solid ${L_T.ink}` }}>
      {segments.map((s, i) => {
        const v = s.value ?? s.pct ?? 0;
        const flex = v / total;
        // truncate label to fit narrow segments rather than hiding it
        const full = s.label || '';
        const maxChars = Math.max(2, Math.floor(flex * 95));
        const shown = full.length > maxChars ? full.slice(0, maxChars).trim() + '…' : full;
        return (
          <div key={s.id ?? i} title={`${full}: ${s.amountStr ?? v}`} style={{
            flex,
            background: s.color,
            color: s.textColor || (s.color === '#fff3a3' || s.color === '#d8d6cd' || s.color === '#a8a8a3' ? L_T.ink : '#fff'),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
            borderRight: i < segments.length - 1 ? `1px solid ${L_T.ink}` : 'none',
            overflow: 'hidden', whiteSpace: 'nowrap', padding: '0 4px',
          }}>{shown}</div>
        );
      })}
    </div>
  );
};

// Mathblock — monospace derivation rows
const LMathBlock = ({ rows }) => (
  <div style={{ border: `1px solid ${L_T.faint}`, padding: '14px 18px', background: L_T.paper, fontSize: 12, lineHeight: 1.8, color: L_T.ink }}>
    <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 8 }}>$ THE MATH</div>
    {rows.map((r, i) => (
      <div key={i}>
        <span style={{ display: 'inline-block', minWidth: 180 }}>{r.lhs}</span>
        <span>= </span>
        <span style={{ color: r.tone === 'pos' ? L_T.positive : r.tone === 'neg' ? L_T.negative : L_T.ink, fontWeight: r.tone ? 700 : 500 }}>{r.rhs}</span>
        {r.note && <span style={{ color: L_T.muted, marginLeft: 8 }}>{r.note}</span>}
      </div>
    ))}
  </div>
);

// Progress bar — ASCII filled segments
const LProgressBar = ({ pct, width = 36, tone }) => {
  const filled = Math.round((pct / 100) * width);
  const color = tone === 'pos' ? L_T.positive : tone === 'neg' ? L_T.negative : L_T.ink;
  return (
    <span style={{ fontFamily: L_mono, fontSize: 11, letterSpacing: 0, color, whiteSpace: 'pre' }}>
      [<span style={{ color }}>{'█'.repeat(filled)}</span><span style={{ color: L_T.faint }}>{'░'.repeat(Math.max(0, width - filled))}</span>] {Math.round(pct)}%
    </span>
  );
};

// Goal allocation slider — proportional compression
const LGoalSlider = ({ goals, total = 100000 }) => {
  const [allocs, setAllocs] = useState(() => {
    // initial: priority goal gets 60%, others split remaining proportionally to behind-ness
    const base = goals.map(g => g.priority ? 60 : (g.status === 'BEHIND' ? 15 : 5));
    const sum = base.reduce((s, x) => s + x, 0);
    return base.map(b => (b / sum) * 100);
  });
  const [locks, setLocks] = useState(() => goals.map(() => false));

  const drag = (idx, newVal) => {
    newVal = Math.max(0, Math.min(100, newVal));
    setAllocs(prev => {
      const next = [...prev];
      const oldVal = next[idx];
      const diff = newVal - oldVal;
      // Find unlocked others
      const others = prev.map((_, i) => i).filter(i => i !== idx && !locks[i]);
      const otherSum = others.reduce((s, i) => s + prev[i], 0);
      if (otherSum <= 0 || others.length === 0) return prev;
      next[idx] = newVal;
      others.forEach(i => {
        next[i] = Math.max(0, prev[i] - diff * (prev[i] / otherSum));
      });
      // renormalise
      const tot = next.reduce((s, x) => s + x, 0);
      if (tot > 0) for (let i = 0; i < next.length; i++) next[i] = (next[i] / tot) * 100;
      return next;
    });
  };

  const toggleLock = (idx) => setLocks(prev => prev.map((l, i) => i === idx ? !l : l));

  return (
    <div>
      {goals.map((g, i) => {
        const pct = allocs[i];
        const amt = Math.round((pct / 100) * total);
        return (
          <div key={g.id} style={{ padding: '10px 0', borderTop: i > 0 ? `1px dashed ${L_T.faint}` : 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, fontSize: 11, gap: 8 }}>
              <span style={{ color: L_T.muted, letterSpacing: '0.06em' }}>
                $ ALLOCATE → {g.label}{g.priority && <span style={{ color: L_T.accent, fontWeight: 700 }}> ★</span>}
              </span>
              <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ color: L_T.ink, fontWeight: 700 }}>{pct.toFixed(0)}% · ₹{amt.toLocaleString('en-IN')}</span>
                <span onClick={() => toggleLock(i)} style={{ cursor: 'pointer' }}>
                  <LBracket active={locks[i]}>{locks[i] ? 'LOCKED' : 'LOCK'}</LBracket>
                </span>
              </span>
            </div>
            <div style={{ position: 'relative', height: 6, background: L_T.ruleSoft, margin: '6px 0' }}>
              <div style={{ position: 'absolute', height: '100%', width: pct + '%', background: locks[i] ? L_T.muted : (g.priority ? L_T.accent : L_T.ink) }} />
              <input
                type="range" min="0" max="100" step="1" value={pct}
                disabled={locks[i]}
                onChange={(e) => drag(i, parseFloat(e.target.value))}
                style={{ position: 'absolute', top: -8, left: 0, width: '100%', height: 22, opacity: 0, cursor: locks[i] ? 'not-allowed' : 'pointer' }}
              />
              <div style={{ position: 'absolute', top: '50%', left: pct + '%', width: 12, height: 12, background: locks[i] ? L_T.muted : L_T.accent, transform: 'translate(-50%, -50%)', pointerEvents: 'none' }} />
            </div>
            {/* live ETA */}
            <div style={{ fontSize: 10, color: L_T.muted, letterSpacing: '0.06em' }}>
              ETA → <span style={{ color: pct > 30 ? L_T.positive : L_T.muted, fontWeight: 600 }}>
                {pct > 60 ? shiftEta(g.eta, -8) : pct > 30 ? shiftEta(g.eta, -3) : pct > 5 ? shiftEta(g.eta, -1) : g.eta}
              </span>
              {pct > 30 && <span style={{ color: L_T.positive, marginLeft: 8 }}>(was {g.eta})</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// helper: shift "DEC 2027" by N months
function shiftEta(eta, deltaMo) {
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const m = eta.match(/(\w+)\s+(\d+)/); if (!m) return eta;
  let mi = months.indexOf(m[1].toUpperCase());
  let yr = parseInt(m[2], 10);
  let newIdx = mi + deltaMo;
  while (newIdx < 0) { newIdx += 12; yr--; }
  while (newIdx >= 12) { newIdx -= 12; yr++; }
  return `${months[newIdx]} ${yr}`;
}

// Inline expand row — used by debts/restructure to reveal sub-bits
const LExpandPanel = ({ children, accent }) => (
  <tr>
    <td colSpan={99} style={{ background: accent ? '#faf6f0' : L_T.paper, padding: '12px 14px', borderBottom: `1px dashed ${L_T.faint}` }}>
      {children}
    </td>
  </tr>
);

// Open Positions table — full expandable variant, shared between /home and /debts
const LOpenPositionsExpandable = ({ mobile, expanded, setExpanded }) => (
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
            <tr style={{ borderBottom: expanded === i ? 'none' : `1px dashed ${L_T.faint}`, background: 'transparent', borderLeft: d.isHighest ? `3px solid ${L_T.negative}` : '3px solid transparent' }}>
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
);

// ═══════════════════════════════════════════════════════════════════════
// HOME V2 — every figure traceable
//   01 · MASTHEAD
//   02 · CONTEXT BAR        plan-start, tax regime, marginal — pulled from setup
//   03 · STATUS             KPIs, no orphan "PAY ₹X" cell
//   04 · ASSUMPTIONS        the modelling inputs that produced THIS month
//   05 · PAY THIS MONTH     ledger of every payment scheduled, with register
//   06 · RESTRUCTURE        marquee · negotiate script inline
//   07 · OPEN POSITIONS     short table · breakdown lives on /debts
//   08 · MORE TOOLS         smaller ticker, no § symbols
// ═══════════════════════════════════════════════════════════════════════
const LHomeV2 = ({ mobile }) => {
  const [showAssumptions, setShowAssumptions] = useState(true);
  const [marqueeOpen, setMarqueeOpen] = useState(0);
  const [scriptOpen, setScriptOpen] = useState(null);
  const [paidRows, setPaidRows] = useState({}); // { rowIdx: 'PAID' | 'PARTIAL' | 'SNOOZED' }
  const [openPosExpanded, setOpenPosExpanded] = useState(-1);

  const payTotal = V2.payThisMonth.reduce((s, r) => s + r.amount, 0);
  const paidSum = V2.payThisMonth.reduce((s, r, i) => paidRows[i] === 'PAID' ? s + r.amount : s, 0);
  const fmt = n => '₹' + n.toLocaleString('en-IN');

  return (
    <LShell>
      <LMastheadV2 section="home" mobile={mobile} />
      <div style={{ flex: 1, overflow: 'auto', padding: mobile ? '14px 18px 28px' : '18px 32px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* ─── CONTEXT · the answers from setup, repeated here for grounding ── */}
        <section style={{
          fontSize: 11, letterSpacing: '0.12em', color: L_T.muted,
          borderTop: `1px dashed ${L_T.faint}`, borderBottom: `1px dashed ${L_T.faint}`,
          padding: '8px 0', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'baseline',
        }}>
          <span>$ CONTEXT · PLAN START = MAY 2026 · TAX REGIME = NEW · MARGINAL = 30% · HORIZON = 240 MO</span>
          <LBracket>EDIT IN SETUP →</LBracket>
        </section>

        {/* ─── 03 · CASH FLOW · the three numbers everything else derives from ── */}
        <section>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 10 }}>
            $ CASH FLOW · MAY 2026 · WHERE THE MONTH'S MONEY GOES
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(3, 1fr)', gap: 0, border: `1px solid ${L_T.ink}` }}>
            {[
              { label: 'SALARY · TAKE HOME', value: fmt(V2.cashFlow.takeHome), tone: L_T.ink,      note: V2.cashFlow.takeHomeNote, sign: '+' },
              { label: 'EXPENSES · MAY',     value: fmt(V2.cashFlow.expense),  tone: L_T.negative, note: V2.cashFlow.expenseNote,  sign: '−' },
              { label: 'SURPLUS · NET',      value: fmt(V2.cashFlow.surplus),  tone: L_T.positive, note: V2.cashFlow.surplusNote,  sign: '=' },
            ].map((c, i) => (
              <div key={i} style={{
                padding: mobile ? '14px 16px' : '16px 22px',
                borderRight: !mobile && i < 2 ? `1px solid ${L_T.ink}` : 'none',
                borderBottom: mobile && i < 2 ? `1px solid ${L_T.ink}` : 'none',
                background: L_T.paper,
              }}>
                <div style={{ fontSize: 10, letterSpacing: '0.16em', color: L_T.muted, fontWeight: 600, marginBottom: 6 }}>
                  {c.label}
                </div>
                <div style={{
                  fontSize: mobile ? 26 : 32,
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  color: c.tone,
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1.05,
                }}>
                  <span style={{ fontSize: '0.6em', verticalAlign: 'baseline', marginRight: 4 }}>{c.sign}</span>{c.value}
                </div>
                <div style={{ fontSize: 9, letterSpacing: '0.08em', color: L_T.muted, marginTop: 8, lineHeight: 1.55 }}>
                  {c.note}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ─── 04 · STATUS · debt-side KPIs ─────────────────────────────── */}
        <section>
          <LSectionHeader>STATUS · DEBT + GOALS</LSectionHeader>
          <LKpi mobile={mobile} cols={mobile ? 2 : 4} items={[
            { l: 'OUTSTANDING',         v: _A.plan.totalOutstanding, s: `${_A.plan.totalOutstandingMTD} MTD` },
            { l: 'CONSUMER DEBT FREE',  v: 'AUG 2027',               s: '17 MO · KOTAK + PL + AUTO', tone: L_T.positive },
            { l: 'ALL DEBT + GOALS DONE', v: 'OCT 2031',             s: '65 MO · INCL. HOUSE GOAL',  tone: L_T.ink },
            { l: 'EFFECTIVE APR',       v: _A.plan.weightedAPR,      s: 'POST-TAX · WEIGHTED' },
          ]} />
        </section>

        {/* ─── 04 · ASSUMPTIONS · how this month was modelled ─────────────
             The "2nd thing user views" requirement. Editable inline. */}
        <section style={{ border: `1px solid ${L_T.ink}`, padding: '12px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: showAssumptions ? 10 : 0 }}>
            <span style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted }}>
              $ ASSUMPTIONS · HOW THIS MONTH WAS MODELLED
            </span>
            <span onClick={() => setShowAssumptions(s => !s)} style={{ cursor: 'pointer' }}>
              <LBracket>{showAssumptions ? '[ CLOSE ROW ]' : '[ OPEN ROW ]'}</LBracket>
            </span>
          </div>
          {showAssumptions && (
            <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(3, 1fr)', gap: 0 }}>
              {V2.assumptionsList.map((t, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  padding: '8px 12px',
                  borderBottom: (mobile || i < V2.assumptionsList.length - 3) ? `1px dashed ${L_T.faint}` : 'none',
                  borderRight: !mobile && (i % 3 < 2) ? `1px dashed ${L_T.faint}` : 'none',
                  fontSize: 11,
                }}>
                  <div>
                    <div style={{ color: L_T.muted, letterSpacing: '0.06em', fontSize: 10 }}>$ {t.cmd}</div>
                    <div style={{ color: L_T.ink, fontWeight: 700, marginTop: 2 }}>{t.val}</div>
                    <div style={{ color: L_T.muted, fontSize: 9, letterSpacing: '0.08em', marginTop: 2 }}>{t.hint}</div>
                  </div>
                  <LBracket>EDIT</LBracket>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ─── 05 · PAY THIS MONTH · register, not a quoted number ───────── */}
        <section style={{ border: `2px solid ${L_T.ink}`, padding: mobile ? '14px 16px' : '18px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.accent, fontWeight: 700 }}>$ PAY THIS MONTH · MAY 2026 · ENGINE ALLOCATION</span>
            <span style={{ fontSize: 10, color: L_T.muted, letterSpacing: '0.1em' }}>
              {fmt(paidSum)} / {fmt(payTotal)} PAID · {V2.payThisMonth.length - Object.keys(paidRows).length} ROWS PENDING
            </span>
          </div>
          <div style={{ fontSize: 11, color: L_T.muted, marginBottom: 14 }}>
            EVERY ROW IS WHAT THE ENGINE SAYS TO PAY THIS MONTH · MARK PAID / PARTIAL / SNOOZE TO LOG IT · PLAN RECOMPUTES ON LOG.
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderTop: `2px solid ${L_T.ink}`, borderBottom: `1px solid ${L_T.ink}` }}>
                  {['#', 'TARGET · KIND', 'AMOUNT', 'DUE', ''].map((h, i) => (
                    <th key={i} style={{ padding: '8px 12px', textAlign: i === 2 ? 'right' : 'left', fontWeight: 700, fontSize: 10, color: L_T.muted, letterSpacing: '0.08em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {V2.payThisMonth.map((r, i) => {
                  const st = paidRows[i];
                  const pri = r.priority === 'CRITICAL' ? { tag: 'CRITICAL', tone: L_T.negative }
                            : r.priority === 'PRIORITY' ? { tag: '★ PRIORITY', tone: L_T.accent }
                            : null;
                  return (
                    <tr key={i} style={{
                      borderBottom: `1px dashed ${L_T.faint}`,
                      background: 'transparent',
                      opacity: st === 'SNOOZED' ? 0.45 : st === 'PAID' ? 0.6 : 1,
                    }}>
                      <td style={{ padding: '10px 12px', color: L_T.muted, width: 24, verticalAlign: 'top' }}>{String(i + 1).padStart(2, '0')}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700 }}>{r.target}</span>
                          <span style={{ fontSize: 9, color: r.kind === 'PAY FULL' ? L_T.accent : L_T.muted, letterSpacing: '0.12em', fontWeight: 700 }}>{r.kind}</span>
                          {pri && <span style={{ fontSize: 9, letterSpacing: '0.14em', fontWeight: 700, color: pri.tone }}>· {pri.tag}</span>}
                          {st && <span style={{ fontSize: 9, letterSpacing: '0.14em', fontWeight: 700, color: st === 'PAID' ? L_T.positive : L_T.accent }}>· {st}</span>}
                        </div>
                        {r.note && <div style={{ marginTop: 3, fontSize: 10, color: L_T.muted, lineHeight: 1.5 }}>{r.note}</div>}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', textDecoration: st === 'PAID' ? 'line-through' : 'none', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{fmt(r.amount)}</td>
                      <td style={{ padding: '10px 12px', color: L_T.muted, fontSize: 10, letterSpacing: '0.06em', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{r.due}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', verticalAlign: 'top' }}>
                        <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <span onClick={() => setPaidRows(p => ({ ...p, [i]: p[i] === 'PAID' ? undefined : 'PAID' }))} style={{ cursor: 'pointer' }}><LBracket active={st === 'PAID'} accent={st !== 'PAID'}>MARK PAID FULLY</LBracket></span>
                          <span onClick={() => setPaidRows(p => ({ ...p, [i]: p[i] === 'PARTIAL' ? undefined : 'PARTIAL' }))} style={{ cursor: 'pointer' }}><LBracket active={st === 'PARTIAL'}>PARTIAL / OTHER</LBracket></span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {/* footer · single source of truth, no duplicate "idle" */}
                <tr style={{ borderTop: `2px solid ${L_T.ink}` }}>
                  <td colSpan={2} style={{ padding: '10px 12px', color: L_T.muted, letterSpacing: '0.1em', fontSize: 10 }}>TOTAL · NET SURPLUS = ₹1,05,000/MO</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>{fmt(payTotal)}</td>
                  <td colSpan={2} style={{ padding: '10px 12px', color: L_T.muted, fontSize: 10, letterSpacing: '0.06em' }}>UNUSED · ₹128 · ROLLS TO NEXT MONTH</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* minimal allocation summary bar — one row, no duplicate legend */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, letterSpacing: '0.12em', color: L_T.muted, marginBottom: 6 }}>$ ALLOCATION SHAPE</div>
            {(() => {
              // explicit palette — no two adjacent segments share the same hue
              const palette = ['#c96442', '#0a0a0a', '#c4744a', '#3a3a36', '#15803d', '#1d4e3a', '#5e5e58', '#a8a8a3'];
              const segs = V2.payThisMonth.map((r, i) => ({
                id: i,
                // FULL specific name — "HDFC HL", "HDFC PL", "KOTAK CC" (not just "HDFC")
                label: r.target.replace('★', '').trim() + ' · ' + fmt(r.amount),
                value: r.amount,
                color: palette[i % palette.length],
                textColor: '#fff',
              }));
              return <LAllocationBar segments={segs} />;
            })()}
          </div>
        </section>

        {/* ─── 06 · RESTRUCTURE · simple table · explanations inline on expand ─── */}
        <section>
          <LSectionHeader right={<span style={{ color: L_T.positive, fontWeight: 700 }}>SAVES {_A.totalAnnualSaving}/Y · BEFORE ACCELERATE</span>}>
            RESTRUCTURE · LAYER 1 · {V2.restructureV2.length} OPPORTUNITIES
          </LSectionHeader>
          <div style={{ fontSize: 11, color: L_T.muted, marginBottom: 10, letterSpacing: '0.04em', lineHeight: 1.6 }}>
            RE-PRICE WHAT YOU OWE BEFORE THROWING MORE MONEY AT IT · EACH ROW EXPANDS TO ITS EXPLANATION + NEGOTIATION SCRIPT.
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderTop: `2px solid ${L_T.ink}`, borderBottom: `1px solid ${L_T.ink}` }}>
                  {['#', 'KIND', 'FROM', 'TO', 'Δ RATE', 'BREAKEVEN', 'SAVES / Y', 'STATUS', ''].map((h, i) => (
                    <th key={i} style={{ padding: '8px 12px', textAlign: i > 3 && i < 7 ? 'right' : 'left', fontWeight: 700, letterSpacing: '0.08em', fontSize: 10, color: L_T.muted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {V2.restructureV2.map((opp, i) => {
                  const open = marqueeOpen === i;
                  const isScriptOpen = scriptOpen === i;
                  const script = V2.negotiateScripts[opp.id === 'bt-kotak' ? 'bt-cc' : 'refi-hl'];
                  const deltaTxt = i === 0 ? '−26.48pp' : '−0.45pp';
                  const breakevenTxt = i === 0 ? 'INSTANT · NO FEE' : '14 MO · ₹11K FEE';
                  return (
                    <React.Fragment key={i}>
                      <tr style={{
                        borderBottom: open ? 'none' : `1px dashed ${L_T.faint}`,
                        background: 'transparent',
                        borderLeft: i === 0 ? `3px solid ${L_T.accent}` : '3px solid transparent',
                      }}>
                        <td style={{ padding: '12px 12px', color: L_T.muted }}>{String(i + 1).padStart(2, '0')}</td>
                        <td style={{ padding: '12px 12px', fontWeight: 700, color: L_T.accent, fontSize: 10, letterSpacing: '0.08em' }}>{opp.kind}</td>
                        <td style={{ padding: '12px 12px', color: L_T.negative }}>{opp.headlineFrom}</td>
                        <td style={{ padding: '12px 12px', color: L_T.positive, fontWeight: 700 }}>{opp.headlineTo}</td>
                        <td style={{ padding: '12px 12px', textAlign: 'right', color: L_T.positive, fontWeight: 700 }}>{deltaTxt}</td>
                        <td style={{ padding: '12px 12px', textAlign: 'right', color: L_T.muted }}>{breakevenTxt}</td>
                        <td style={{ padding: '12px 12px', textAlign: 'right', color: L_T.positive, fontWeight: 700 }}>{opp.savesAnnual}</td>
                        <td style={{ padding: '12px 12px', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: L_T.positive }}>{opp.confidence}</td>
                        <td style={{ padding: '12px 12px', textAlign: 'right' }}>
                          <span onClick={() => { setMarqueeOpen(open ? -1 : i); if (open) setScriptOpen(null); }} style={{ cursor: 'pointer' }}>
                            <LBracket accent>{open ? '[ CLOSE ROW ]' : '[ OPEN ROW ]'}</LBracket>
                          </span>
                        </td>
                      </tr>
                      {open && (
                        <LExpandPanel accent>
                          {/* explanation — ported from the marquee, kept as prose */}
                          <div style={{ fontSize: 10, letterSpacing: '0.14em', color: L_T.muted, marginBottom: 6 }}>$ EXPLANATION · WHY THIS OPPORTUNITY</div>
                          <div style={{ fontSize: 12, color: L_T.ink, lineHeight: 1.65, maxWidth: 820, marginBottom: 14 }}>
                            {opp.explainer}
                          </div>

                          {/* 3-col detail — alternate, rate-as-of, eligibility */}
                          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(3, 1fr)', gap: 16, marginBottom: 14, paddingTop: 12, borderTop: `1px dashed ${L_T.faint}` }}>
                            <div>
                              <div style={{ fontSize: 9, color: L_T.muted, letterSpacing: '0.14em', marginBottom: 4 }}>ALTERNATE BANK</div>
                              <div style={{ fontSize: 13, fontWeight: 700 }}>{i === 0 ? 'AXIS · 17.5% · NO FEE' : 'AXIS · 8.10% · ₹3K FEE'}</div>
                              <div style={{ fontSize: 10, color: L_T.muted, marginTop: 2 }}>{i === 0 ? '+1.5pp BUT FEE-FREE · 2W BE' : '+5BPS BUT BANK RELATIONSHIP'}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 9, color: L_T.muted, letterSpacing: '0.14em', marginBottom: 4 }}>RATE AS OF</div>
                              <div style={{ fontSize: 13, fontWeight: 700 }}>12 MAY 2026</div>
                              <div style={{ fontSize: 10, color: L_T.muted, marginTop: 2 }}>VERIFY AT APPLICATION · CARDS REPRICE WEEKLY</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 9, color: L_T.muted, letterSpacing: '0.14em', marginBottom: 4 }}>ELIGIBILITY</div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: L_T.positive }}>{opp.confidence}</div>
                              <div style={{ fontSize: 10, color: L_T.muted, marginTop: 2 }}>{i === 0 ? '6MO ON-TIME · UTIL DROPS POST-BT' : 'TENURE LEFT > BANK MIN'}</div>
                            </div>
                          </div>

                          {/* actions */}
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <LBracket active>{opp.recommendedAction} →</LBracket>
                            <LBracket>SEE ALT LENDER</LBracket>
                            <span onClick={() => setScriptOpen(isScriptOpen ? null : i)} style={{ cursor: 'pointer' }}>
                              <LBracket accent>{isScriptOpen ? '[ CLOSE NEGOTIATE SCRIPT ]' : '[ NEGOTIATE SCRIPT ↓ ]'}</LBracket>
                            </span>
                            <LBracket>UPDATE TERMS</LBracket>
                            <LBracket>SHOW BREAKEVEN MATH</LBracket>
                          </div>

                          {isScriptOpen && (
                            <div style={{ marginTop: 14, padding: '14px 16px', background: L_T.bg, border: `1px dashed ${L_T.ink}` }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                                <span style={{ fontSize: 10, color: L_T.muted, letterSpacing: '0.14em' }}>$ NEGOTIATE SCRIPT</span>
                                <span style={{ fontSize: 10, color: L_T.accent, letterSpacing: '0.1em', fontWeight: 700 }}>{script.title}</span>
                              </div>
                              <div style={{ fontFamily: L_mono, fontSize: 12, lineHeight: 1.75, color: L_T.ink, whiteSpace: 'pre-wrap' }}>
                                {script.lines.join('\n')}
                              </div>
                              <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <LBracket active>COPY SCRIPT</LBracket>
                                <LBracket>OPEN DIALER</LBracket>
                                <LBracket>EMAIL TEMPLATE</LBracket>
                                <LBracket>LOG OUTCOME → ACTIVITY</LBracket>
                              </div>
                            </div>
                          )}
                        </LExpandPanel>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* ─── 07 · OPEN POSITIONS · table with inline EFFECTIVE APR BREAKDOWN ── */}
        <section>
          {/* StaleCardNudge — ported from the deleted /debts tab */}
          <div style={{ marginBottom: 10, padding: '10px 14px', border: `1px solid ${L_T.ink}`, background: L_T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, letterSpacing: '0.06em', color: L_T.ink }}>
              ⚠ <strong style={{ letterSpacing: '0.12em' }}>STALE</strong> · KOTAK CC NOT RECONCILED IN 18D · STATEMENT-DAY ₹1,00,000 → TODAY ?
            </span>
            <span style={{ display: 'flex', gap: 6 }}>
              <LBracket accent>RECONCILE NOW</LBracket>
              <LBracket>DISMISS 7D</LBracket>
            </span>
          </div>
          <LSectionHeader right={<LBracket>+ ADD DEBT</LBracket>}>
            OPEN POSITIONS · {_A.debts.length}
          </LSectionHeader>
          <LOpenPositionsExpandable mobile={mobile} expanded={openPosExpanded} setExpanded={setOpenPosExpanded} />
          <div style={{ marginTop: 8, fontSize: 10, color: L_T.muted, letterSpacing: '0.06em' }}>
            CLICK ANY ROW FOR THE FULL EFFECTIVE-APR BREAKDOWN (NOMINAL → FEES → GST → SHIELD) + EDIT ENTRY.
          </div>
        </section>

        {/* ─── 08 · MORE TOOLS · smaller, plain names, no § ──────────────── */}
        <section>
          <LSectionHeader right={<LBracket>OPEN /TOOLS →</LBracket>}>MORE TOOLS · 9 · ONE QUESTION EACH</LSectionHeader>
          <div style={{ overflowX: 'auto', borderTop: `1px solid ${L_T.ink}`, borderBottom: `1px solid ${L_T.ink}` }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: mobile ? 900 : 0 }}>
              <tbody>
                <tr>
                  {[
                    { name: 'WINDFALL',         q: 'GOT A BONUS?' },
                    { name: 'NEW DEBT',         q: 'CAN I AFFORD THIS EMI?' },
                    { name: 'LIQUIDATE',        q: 'SELL TO CLEAR?' },
                    { name: 'RECOMPUTE',        q: 'JUST PAID · NOW WHAT?' },
                    { name: 'CASH YIELD',       q: 'IS MY IDLE CASH WORKING?' },
                    { name: 'RIGHT TIME',       q: 'WAIT OR BORROW NOW?' },
                    { name: 'NRI PREPAY',       q: 'LOAN ABROAD · CASH HERE?' },
                    { name: 'INVEST VS PREPAY', q: 'INVEST OR PAY DOWN?' },
                    { name: 'GOAL PLANNER',     q: 'WHEN DO MY GOALS LAND?' },
                  ].map((t, i) => (
                    <td key={t.name} style={{ padding: '8px 10px', verticalAlign: 'top', borderRight: i < 8 ? `1px dashed ${L_T.faint}` : 'none', cursor: 'pointer', minWidth: 100 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', color: L_T.ink }}>{t.name}</div>
                      <div style={{ fontSize: 9, color: L_T.muted, marginTop: 3, letterSpacing: '0.04em' }}>{t.q}</div>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <LFooter mode="SIMPLE" mobile={mobile} />
    </LShell>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// PLAN V2 — trimmed: Modeling, Next Action, Restructure removed
//   Restructure moved to /home (Layer-1 strategy belongs alongside the
//   debt ledger). Modeling toggles live in /setup. Next-Action sits on /home
//   as the engine-pick on PAY THIS MONTH.
// ═══════════════════════════════════════════════════════════════════════
const LPlanV2 = ({ mobile, business }) => {
  return (
    <LShell>
      <LMastheadV2 section="plan" mobile={mobile} business={business} stmt="#1138-PLAN" />
      <div style={{ flex: 1, overflow: 'auto', padding: mobile ? '14px 18px 28px' : '18px 32px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* SCHEDULE AMENDED banner */}
        <section style={{ background: L_T.highlight, border: `1px solid ${L_T.ink}`, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, letterSpacing: '0.14em', color: L_T.ink }}>
            ⚠ SCHEDULE AMENDED · {V2.activityImpact.entries} ACTIVITY ENTRIES SINCE {V2.activityImpact.since} · NOW {Math.abs(V2.activityImpact.monthsShift)} MO AHEAD OF SCHEDULE · INTEREST DOWN {V2.activityImpact.interestDelta.replace('−', '')}
          </span>
          <LBracket>OPEN ACTIVITY →</LBracket>
        </section>

        {/* CLI + KPIs */}
        <section>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 6 }}>
            $ PLAN · STRATEGY = AVALANCHE · 65 MO UNTIL DEBTS + GOALS DONE · TAX REGIME = NEW · CONFIDENCE = {_A.plan.debtFreeConfidence}%
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            {V2.assumptions.map((a, i) => (
              <span key={i} style={{ fontSize: 9, letterSpacing: '0.14em', color: L_T.muted, border: `1px solid ${L_T.faint}`, padding: '2px 8px', fontWeight: 600 }}>{a}</span>
            ))}
          </div>
          <LKpi mobile={mobile} cols={mobile ? 2 : 4} items={[
            { l: 'DEBT-FREE',          v: 'AUG 2027',                              s: '17 MO · RANGE JUL–OCT',                tone: L_T.ink },
            { l: 'INTEREST SAVED',     v: _A.plan.totalInterestAvalanche,          s: 'VS PAYING ONLY MIN EMI ON EVERY DEBT', tone: L_T.positive },
            { l: 'MONTHS SAVED',       v: String(_A.plan.monthsSaved),             s: 'VS MIN-PAYMENT-ONLY BASELINE',         tone: L_T.accent },
            { l: 'MONTHLY OUTLAY',     v: _A.plan.monthlyOutlay,                   s: 'EMI + EXTRA (SURPLUS REDIRECTED TO HIGHEST APR)', tone: L_T.ink },
          ]} />
          <div style={{ marginTop: 10, fontSize: 11, color: L_T.muted, letterSpacing: '0.04em', lineHeight: 1.6, padding: '8px 12px', borderTop: `1px dashed ${L_T.faint}`, borderBottom: `1px dashed ${L_T.faint}` }}>
            ⓘ RESTRUCTURE (LAYER 1) NOW LIVES ON THE <strong>LEDGER</strong> TAB — RE-PRICE BEFORE ACCELERATE.
            {' '}MODELING TOGGLES MOVED TO <strong>SETUP</strong>. NEXT-ACTION IS THE TOP ROW OF <strong>PAY THIS MONTH</strong>.
          </div>
        </section>

        {/* TRAJECTORY — rebuilt */}
        <section>
          <LSectionHeader right={<><LBracket>CSV</LBracket> <LBracket>PRINT</LBracket></>}>TRAJECTORY · TOTAL DEBT OVER TIME</LSectionHeader>
          <LTrajectoryV2 mobile={mobile} />
          <div style={{ display: 'flex', gap: 18, fontSize: 10, color: L_T.muted, marginTop: 10, letterSpacing: '0.1em', flexWrap: 'wrap' }}>
            <span><span style={{ display: 'inline-block', width: 14, height: 3, background: L_T.ink, verticalAlign: 'middle', marginRight: 6 }} />AVALANCHE · YOUR PLAN</span>
            <span><span style={{ display: 'inline-block', width: 14, borderTop: `2px dashed ${L_T.muted}`, verticalAlign: 'middle', marginRight: 6 }} />MIN-PAYMENT-ONLY BASELINE</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: L_T.accent, verticalAlign: 'middle', marginRight: 6 }} />MILESTONE</span>
          </div>
        </section>

        {/* AMORTISATION — uniform highlight only · alert + central-bank below */}
        <section>
          <LSectionHeader right={<><LBracket>CSV</LBracket> <LBracket>PRINT</LBracket> <LBracket>↓ EXPAND ALL 240</LBracket></>}>
            AMORTISATION · COLLAPSED · EVENT ROWS ONLY
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
                  { mo: '02', d: 'JUL 26', a: '0',      b: '11,400', c: '5,200', hl: '35,200', x: '18,500', i: '4,210', pr: '66,090', b2: '40,14,000', ev: '★ KOTAK CLEARED' },
                  { mo: '05', d: 'OCT 26', a: '—',      b: '11,400', c: '5,200', hl: '35,200', x: '18,500', i: '3,850', pr: '66,450', b2: '38,15,000', ev: '⊙ ANN. REVIEW' },
                  { mo: '07', d: 'DEC 26', a: '—',      b: '11,400', c: '5,200', hl: '35,200', x: '18,500', i: '3,670', pr: '66,540', b2: '36,82,000', ev: '⊕ HDFC HL RATE RESET' },
                  { mo: '09', d: 'FEB 27', a: '—',      b: '0',      c: '5,200', hl: '35,200', x: '29,900', i: '3,250', pr: '67,050', b2: '35,48,000', ev: '★ HDFC PL CLEARED' },
                  { mo: '14', d: 'JUL 27', a: '—',      b: '—',      c: '5,200', hl: '35,200', x: '52,300', i: '2,940', pr: '70,560', b2: '32,15,000', ev: '⊕ TAX SLAB 30%→20%' },
                  { mo: '18', d: 'NOV 27', a: '—',      b: '—',      c: '5,200', hl: '35,200', x: '52,300', i: '2,460', pr: '70,040', b2: '0',          ev: '★ ALL CONSUMER DEBT CLEARED · HDFC HL CONTINUES' },
                ].map((r, i) => (
                  <tr key={i} style={{ borderBottom: `1px dashed ${L_T.faint}`, background: L_T.highlight }}>
                    <td style={{ padding: '8px 10px' }}>{r.mo}</td>
                    <td style={{ padding: '8px 10px' }}>{r.d}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>{r.a}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>{r.b}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>{r.c}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>{r.hl}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: L_T.accent }}>{r.x}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: L_T.negative }}>{r.i}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: L_T.positive }}>{r.pr}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>{r.b2}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 9, fontWeight: 700 }}>{r.ev}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Floating-reset alert — moved BELOW the table */}
          <div style={{ marginTop: 12, padding: '12px 14px', border: `1px solid ${L_T.ink}`, background: L_T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, letterSpacing: '0.04em', color: L_T.ink, lineHeight: 1.6 }}>
              ⏰ <strong style={{ letterSpacing: '0.06em' }}>HDFC HL FLOATING RATE RESET · 47D AWAY · 30 JUN</strong> · DECIDED BY BANK (RBI-LINKED) · NEW RATE UNKNOWN UNTIL THE MEETING.
            </span>
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <LBracket accent>LOG WHEN SMS ARRIVES → ACTIVITY</LBracket>
              <LBracket>SHOW IMPACT · ±5 BPS · ±50 BPS</LBracket>
            </span>
          </div>

          {/* Central-bank context — its proper home, right next to the floating-rate alert */}
          <div style={{ marginTop: 10, padding: '10px 14px', borderTop: `1px dashed ${L_T.faint}`, borderBottom: `1px dashed ${L_T.faint}`, fontSize: 11, letterSpacing: '0.04em', color: L_T.ink, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ color: L_T.muted, letterSpacing: '0.1em' }}>
              $ CENTRAL BANK · RBI HELD REPO @ 5.25% ON 4 APR
            </span>
            <span style={{ color: L_T.ink }}>
              NEXT RBI MEETING 7 JUN · HDFC HL FLOATING RATE TRACKS THIS · IF HELD → SAME · IF −25 BPS → ~8.25%
            </span>
          </div>
        </section>

        {/* RECENT ACTIVITY summary */}
        <section>
          <LSectionHeader right={<LBracket>VIEW ALL →</LBracket>}>RECENT ACTIVITY · LAST 3 · TIMESTAMPED</LSectionHeader>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <tbody>
              {V2.recentActivity.map((a, i) => (
                <tr key={i} style={{ borderBottom: `1px dashed ${L_T.faint}` }}>
                  <td style={{ padding: '8px 12px', color: L_T.muted, width: 80, fontSize: 10, letterSpacing: '0.1em' }}>{a.date}</td>
                  <td style={{ padding: '8px 12px', width: 90, fontSize: 10, color: a.kind === 'PARTIAL' ? L_T.negative : L_T.ink, fontWeight: 700, letterSpacing: '0.1em' }}>{a.kind}</td>
                  <td style={{ padding: '8px 12px' }}>{a.text}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: a.tone === 'pos' ? L_T.positive : a.tone === 'neg' ? L_T.negative : L_T.muted, fontWeight: 700 }}>{a.impact}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', width: 80 }}><LBracket>UNDO</LBracket></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* WHAT-IF sandbox */}
        <section style={{ border: `2px solid ${L_T.ink}`, padding: mobile ? '14px 16px' : '18px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted }}>$ WHAT IF · LIVE ENGINE · SCENARIO SANDBOX</span>
            <span style={{ fontSize: 10, color: L_T.muted, letterSpacing: '0.08em' }}>DRAG A SLIDER → PREVIEW IMPACT → APPLY RECORDS IN ACTIVITY</span>
          </div>
          {[
            { plain: "I'LL CUT MONTHLY EXPENSES BY ₹15,000 STARTING JUNE",       fill: 30, mo: '−6 MO',  int: '−₹28,400', tone: 'pos' },
            { plain: 'IF RATES RISE +150 BPS AT NEXT HDFC HL RESET',              fill: 70, mo: '+4 MO',  int: '+₹19,200', tone: 'neg' },
            { plain: "I'LL PUT A ONE-OFF ₹2,00,000 INTO HDFC HL THIS MONTH",      fill: 40, mo: '−3 MO',  int: '−₹42,800', tone: 'pos' },
            { plain: "I'LL SWITCH TO SNOWBALL ORDER (SMALLEST DEBT FIRST)",       fill: 0,  mo: '+1 MO',  int: '+₹7,200',  tone: 'neg' },
          ].map((s, i) => (
            <div key={i} style={{ padding: '14px 0', borderTop: i > 0 ? `1px dashed ${L_T.faint}` : 'none' }}>
              <div style={{ fontSize: 12, color: L_T.ink, fontWeight: 600, marginBottom: 8, lineHeight: 1.4 }}>{s.plain}</div>
              <div style={{ position: 'relative', height: 6, background: L_T.ruleSoft, margin: '8px 0' }}>
                <div style={{ position: 'absolute', height: '100%', width: s.fill + '%', background: L_T.ink }} />
                <div style={{ position: 'absolute', top: '50%', left: s.fill + '%', width: 12, height: 12, background: L_T.accent, transform: 'translate(-50%, -50%)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                <span style={{ fontSize: 11, color: L_T.muted, display: 'inline-flex', gap: 14, flexWrap: 'wrap' }}>
                  <span>→ DEBT-FREE <span style={{ color: s.tone === 'pos' ? L_T.positive : L_T.negative, fontWeight: 700 }}>{s.mo}</span></span>
                  <span>→ INTEREST <span style={{ color: s.tone === 'pos' ? L_T.positive : L_T.negative, fontWeight: 700 }}>{s.int}</span></span>
                </span>
                <LBracket accent>[ APPLY → ACTIVITY ]</LBracket>
              </div>
            </div>
          ))}
        </section>
      </div>
    </LShell>
  );
};

// Better trajectory chart — area fill, milestone markers, clearer baseline
const LTrajectoryV2 = ({ mobile }) => {
  const w = mobile ? 360 : 1100, h = mobile ? 230 : 300;
  const padL = 60, padR = 24, padT = 28, padB = 38;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  // 18-month horizon — avalanche hits 0 at month 15 (Aug 27)
  const months = [
    { m: 'MAY 26', av: 41.00, mn: 41.00 },
    { m: 'JUN 26', av: 39.85, mn: 40.55 },
    { m: 'JUL 26', av: 38.60, mn: 40.05 },
    { m: 'AUG 26', av: 37.20, mn: 39.55 },
    { m: 'SEP 26', av: 35.65, mn: 39.05 },
    { m: 'OCT 26', av: 34.00, mn: 38.55 },
    { m: 'NOV 26', av: 32.20, mn: 38.05 },
    { m: 'DEC 26', av: 30.25, mn: 37.55 },
    { m: 'JAN 27', av: 28.15, mn: 37.05 },
    { m: 'FEB 27', av: 25.90, mn: 36.55 },
    { m: 'MAR 27', av: 22.95, mn: 36.05 },
    { m: 'APR 27', av: 19.80, mn: 35.55 },
    { m: 'MAY 27', av: 16.45, mn: 35.05 },
    { m: 'JUN 27', av: 12.90, mn: 34.55 },
    { m: 'JUL 27', av:  9.10, mn: 34.05 },
    { m: 'AUG 27', av:  0.00, mn: 33.55 },
    { m: 'SEP 27', av:  0.00, mn: 33.05 },
    { m: 'OCT 27', av:  0.00, mn: 32.55 },
  ];

  const maxY = 42;
  const toX = i => padL + (i / (months.length - 1)) * innerW;
  const toY = v => padT + (1 - v / maxY) * innerH;

  const avPath = months.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.av).toFixed(1)}`).join(' ');
  const mnPath = months.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.mn).toFixed(1)}`).join(' ');
  const avFill = `${avPath} L${toX(months.length - 1).toFixed(1)},${toY(0).toFixed(1)} L${toX(0).toFixed(1)},${toY(0).toFixed(1)} Z`;

  const milestones = [
    { i: 2,  label: 'KOTAK CLEAR · JUL 26',  anchor: 'start' },
    { i: 9,  label: 'HDFC PL CLEAR · FEB 27', anchor: 'middle' },
    { i: 15, label: 'CONSUMER DEBT-FREE · AUG 27', anchor: 'end' },
  ];

  const yTicks = [0, 10, 20, 30, 40];

  return (
    <div style={{ border: `1px solid ${L_T.ink}`, padding: '14px 8px 8px', background: L_T.paper }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="xMidYMid meet">
        {/* y grid + labels */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={padL} x2={w - padR} y1={toY(t)} y2={toY(t)}
              stroke={t === 0 ? L_T.ink : L_T.faint}
              strokeWidth={t === 0 ? 1.2 : 0.6}
              strokeDasharray={t === 0 ? '' : '2 3'}
            />
            <text x={padL - 8} y={toY(t) + 3} fontFamily={L_mono} fontSize="10" fill={L_T.muted} textAnchor="end">₹{t}L</text>
          </g>
        ))}

        {/* min baseline (dashed) */}
        <path d={mnPath} stroke={L_T.muted} strokeWidth="1.4" fill="none" strokeDasharray="5 4" />

        {/* avalanche area + line */}
        <path d={avFill} fill={L_T.highlight} opacity="0.55" />
        <path d={avPath} stroke={L_T.ink} strokeWidth="2.2" fill="none" />

        {/* milestone markers */}
        {milestones.map((m, i) => (
          <g key={i}>
            <line x1={toX(m.i)} x2={toX(m.i)} y1={toY(months[m.i].av)} y2={toY(0) + 4} stroke={L_T.accent} strokeWidth="0.8" strokeDasharray="2 2" />
            <rect x={toX(m.i) - 4} y={toY(months[m.i].av) - 4} width="8" height="8" fill={L_T.accent} />
            <text
              x={toX(m.i)}
              y={toY(months[m.i].av) - 10}
              fontFamily={L_mono} fontSize="9.5" fontWeight="700" fill={L_T.accent}
              textAnchor={m.anchor}
            >{m.label}</text>
          </g>
        ))}

        {/* x labels — every 3rd month */}
        {months.map((p, i) => (i % 3 === 0 || i === months.length - 1) && (
          <text key={i} x={toX(i)} y={h - 16} fontFamily={L_mono} fontSize="9.5" fill={L_T.muted} textAnchor="middle">{p.m}</text>
        ))}
        <text x={(padL + w - padR) / 2} y={h - 2} fontFamily={L_mono} fontSize="9" fill={L_T.muted} textAnchor="middle" letterSpacing="0.12em">MONTH</text>
        <text x={14} y={padT - 6} fontFamily={L_mono} fontSize="9" fill={L_T.muted} letterSpacing="0.12em">OUTSTANDING</text>
      </svg>
    </div>
  );
};

Object.assign(window, { LMastheadV2, LAllocationBar, LMathBlock, LProgressBar, LGoalSlider, LExpandPanel, LOpenPositionsExpandable, LHomeV2, LPlanV2, LTrajectoryV2, V2 });
