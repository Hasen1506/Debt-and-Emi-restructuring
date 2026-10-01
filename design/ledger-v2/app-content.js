// Shared data for all three direction skins.
// Numbers + copy live here so the three canvases stay in sync.
// Each direction renders this data with its own visual language.

window.APP = {
  // ────── User snapshot ──────
  user: {
    name: 'Hasen',
    country: 'IN',
    today: 'Thu, 14 May 2026',
    incomeMonthly: 150000,
    fixedExpenses: 45000,
    surplus: 105000,
    primaryBank: 'HDFC Bank',
    marginalRate: 0.30,
    taxRegime: 'new',
    creditScore: 742,
    incomeType: 'salaried',
    annualHikeRate: 0.08,
    efundBalance: 150000,
    efundTarget: 300000,
    savingsBalance: 300000,
  },

  // ────── Plan summary ──────
  plan: {
    strategy: 'avalanche',
    debtFreeMonth: 'Aug 2027',
    debtFreeRange: 'Jul – Oct 2027',
    debtFreeConfidence: 80,
    debtFreeCentral: 'Aug 14, 2027',
    monthsRemaining: 17,
    horizonMonths: 240,
    totalOutstanding: '₹41,80,000',
    totalOutstandingMTD: '−₹2,40,000',
    monthlyOutlay: '₹56,100',
    totalInterestAvalanche: '₹2,40,000',
    totalInterestMinimums: '₹4,10,000',
    monthsSaved: 14,
    weightedAPR: '11.94%',
    interestSaved: '₹2,18,400',
    confidenceStars: 4,
  },

  // ────── Debt portfolio (sorted by effective rate desc — avalanche order) ──────
  debts: [
    {
      rank: 1,
      bank: 'Kotak',
      product: 'Credit Card',
      type: 'CARD',
      typeLabel: 'multi-tier · cash adv. 48%',
      nominal: '36.00%',
      effective: '42.48%',
      effectivePostTax: '42.48%',
      outstanding: '₹1,00,000',
      outstandingShort: '₹1L',
      emi: '—',
      tenure: '—',
      nextResetDays: null,
      shieldNote: null,
      next: 'PAY ₹18,500',
      isCard: true,
      isHighest: true,
    },
    {
      rank: 2,
      bank: 'HDFC',
      product: 'Personal Loan',
      type: 'PERS LOAN',
      typeLabel: 'fixed · 18 mo left',
      nominal: '14.50%',
      effective: '14.50%',
      effectivePostTax: '14.50%',
      outstanding: '₹1,80,000',
      outstandingShort: '₹1.8L',
      emi: '₹11,400',
      tenure: '18 mo',
      nextResetDays: null,
      shieldNote: null,
      next: 'AUTO',
      isCard: false,
      isHighest: false,
    },
    {
      rank: 3,
      bank: 'SBI',
      product: 'Auto Loan',
      type: 'AUTO · FLT',
      typeLabel: 'floating · last RBI ↓ applied',
      nominal: '10.20%',
      effective: '10.20%',
      effectivePostTax: '10.20%',
      outstanding: '₹2,40,000',
      outstandingShort: '₹2.4L',
      emi: '₹5,200',
      tenure: '48 mo',
      nextResetDays: 92,
      shieldNote: null,
      next: 'AUTO · RESET 92d',
      isCard: false,
      isHighest: false,
    },
    {
      rank: 4,
      bank: 'HDFC',
      product: 'Home Loan',
      type: 'HOME · FLT',
      typeLabel: 'floating · Sec 24 shield active',
      nominal: '8.50%',
      effective: '8.50%',
      effectivePostTax: '7.30%',
      outstanding: '₹36,60,000',
      outstandingShort: '₹36.6L',
      emi: '₹35,200',
      tenure: '180 mo',
      nextResetDays: 47,
      shieldNote: '−120 bps from Sec 24',
      next: 'AUTO · RESET 47d',
      isCard: false,
      isHighest: false,
    },
  ],

  // ────── The one thing to do this month ──────
  thisMonth: {
    action: 'Pay ₹18,500 extra to Kotak credit card',
    actionShort: 'Pay ₹18,500 → Kotak CC',
    amount: '₹18,500',
    target: 'Kotak Credit Card',
    reason: 'Highest effective APR in your portfolio (42.48%). Every rupee here saves more than anywhere else.',
    savesThisCycle: '₹3,200',
    savesAnnual: '₹31,400',
    momDelta: '−2.1 mo',
    dueLabel: 'Due 1 Jun',
  },

  // ────── Restructure opportunities ──────
  opportunities: [
    {
      kind: 'BALANCE TRANSFER',
      headline: 'Move Kotak card balance to HDFC at 16% for 9 months',
      rationale: '26pp spread once the BT processing fee is amortised. Fee recovered in 7 weeks.',
      from: '42.48%',
      to: '16.00%',
      savesAnnual: '₹31,400',
      breakevenWeeks: 7,
      status: 'EXPLORE',
    },
    {
      kind: 'REFINANCE',
      headline: 'Refinance HDFC home loan to ICICI at 8.05%',
      rationale: '45 bps floating spread · processing fee recovered in 11 months.',
      from: '8.50%',
      to: '8.05%',
      savesAnnual: '₹17,320',
      breakevenWeeks: 47,
      status: 'EXPLORE',
    },
  ],
  totalAnnualSaving: '₹48,720',

  // ────── Sensitivity / plan diagnostics ──────
  diagnostics: [
    { label: 'Rate +1%', delta: '+3 mo', interest: '+₹19,200', tone: 'neg' },
    { label: 'Surplus −10%', delta: '+5 mo', interest: '+₹28,400', tone: 'neg' },
    { label: 'Job loss 3 mo', delta: '+9 mo', interest: '+₹62,000', tone: 'neg' },
    { label: 'Lump sum ₹2L → HDFC', delta: '−3 mo', interest: '−₹42,800', tone: 'pos' },
  ],

  // ────── Insights feed ──────
  insights: [
    {
      date: 'Apr 7, 2026',
      eyebrow: 'RATES',
      title: 'RBI held repo at 5.25%',
      body: 'Your floating home loan is unaffected at its next reset 47 days from today. The MCLR-linked spread will requote at the same level.',
      tags: ['repo', 'floating', 'reset'],
    },
    {
      date: 'Apr 2, 2026',
      eyebrow: 'MILESTONE',
      title: 'Your home loan crossed the halfway mark',
      body: 'Principal paid since 2018 now exceeds remaining. From here, every EMI shifts more to principal than interest. Sec 24 shield still active.',
      tags: ['home loan', 'milestone'],
    },
    {
      date: 'Mar 28, 2026',
      eyebrow: 'KNOW THIS',
      title: '"No-cost EMI" rarely is',
      body: 'The real APR is typically 14–18% once the processing-cum-handling fee is amortised. The "interest" gets repackaged as a one-shot charge so the brochure can say 0%.',
      tags: ['credit', 'fees'],
    },
    {
      date: 'Mar 20, 2026',
      eyebrow: 'TAX',
      title: 'Your Sec 24 shield is worth ₹47k/yr',
      body: 'At your 30% marginal rate, the interest deduction on your home loan brings the after-tax cost from 8.50% down to roughly 7.30%. Factored into avalanche ordering.',
      tags: ['Sec 24', 'tax'],
    },
  ],

  // ────── 7 tools ──────
  tools: [
    { id: 'windfall',   tag: '8a', name: 'Windfall',         q: 'Got a bonus?',           sub: 'Where should it go — debt, EF, or invested?' },
    { id: 'new-debt',   tag: '8b', name: 'New debt check',   q: 'Should I take this EMI?', sub: 'Tells you, before signing, if it breaks the plan.' },
    { id: 'liquidate',  tag: '8c', name: 'Liquidate',        q: 'Sell an asset to clear debt?', sub: 'After-tax yield vs highest effective APR.' },
    { id: 'recompute',  tag: '8d', name: 'Recompute',        q: 'I just paid extra — now what?', sub: 'Rebuilds the plan in under a second.' },
    { id: 'cash-yield', tag: '8e', name: 'Cash yield',       q: 'Where is your idle cash?', sub: 'Savings drag vs sweep / FD / HYSA.' },
    { id: 'right-time', tag: '8f', name: 'Right-time',       q: 'Wait or borrow now?',     sub: 'Reads RBI / Fed path. Is your rate likely to fall?' },
    { id: 'nri-prepay', tag: 'FX', name: 'NRI prepay',       q: 'Loan abroad, savings here?', sub: 'Adjusts for FX drift, repatriation, tax both sides.' },
  ],

  // ────── Sample tool: Windfall result ──────
  windfall: {
    input: '₹1,00,000',
    sliceEF:  { amount: '₹0',          why: 'EF already at 50% of target, no shortfall' },
    sliceCard:{ amount: '₹1,00,000',   why: 'Kotak card at 42.48% — clear in one shot' },
    sliceInvest: { amount: '₹0',       why: 'No surplus left after the card; recheck in 30d' },
    debtFreeAfter: 'Jul 2027',
    debtFreeDelta: '−1 month',
    interestAvoided: '₹31,400',
    scoreImpact: '+18 to +28 pts (90d)',
    nextAction: 'Recompute plan',
  },

  // ────── Onboarding wizard ──────
  onboarding: {
    steps: [
      { n: 1, label: 'Country',    title: 'Where do you live?',         desc: 'Switches tax engine, currency, credit-bureau model.' },
      { n: 2, label: 'Income',     title: 'How much comes in each month?', desc: 'Take-home, after EPF + TDS. No bonuses — those go to Tools › Windfall.' },
      { n: 3, label: 'Loans',      title: 'List every active loan',     desc: 'Outstanding, rate, EMI, tenure. The engine asks the rest.' },
      { n: 4, label: 'Savings',    title: 'Where does cash sit?',       desc: 'Balance + emergency fund current / target.' },
      { n: 5, label: 'Credit',     title: 'Latest credit score?',       desc: 'CIBIL / Experian, 300–900. Skip if unknown.' },
      { n: 6, label: 'Review',     title: 'Look it over, then save.',   desc: 'Saved as a cookie on this device. No upload, no account.' },
    ],
    currentStep: 3, // we render step 3 (Loans) as the showcase
  },

  // ────── Trajectory data for mini SVG charts (37 points, normalized 0–1) ──────
  trajectoryPath: (function () {
    const pts = [];
    for (let i = 0; i < 37; i++) {
      const av  = Math.max(0, 1 - i / 28 + 0.018 * Math.sin(i / 3));
      const min = Math.max(0, 1 - i / 50);
      pts.push({ t: i / 36, av, min });
    }
    return pts;
  })(),
};
