import type {
  AuditFinding,
  BorrowerIdentity,
  Country,
  FormalLetter,
  LetterKind,
  LoanAuditInput,
  LoanAuditResult,
  OverchargeMonth,
  RateMoveImpact,
} from './types';
import {
  CITATIONS,
  findLender,
  MARKET_BENCHMARKS,
  NEXT_POLICY_MEETING,
  POLICY_RATES_AS_OF,
  policyRatesBetween,
} from './policyRates';
import { computeEmi, computeMonthsRemaining, formatMoney, formatPct } from './math';

function shiftMonths(isoMonth: string, delta: number): string {
  const [y, m] = isoMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addBusinessDaysIso(isoDate: string, businessDays: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  let added = 0;
  while (added < businessDays) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return d.toISOString().slice(0, 10);
}

export function computeRateMoveImpact(
  outstanding: number,
  oldRate: number,
  newRate: number,
  monthsRemaining: number,
  currentEmiInput?: number,
): RateMoveImpact {
  const currentEmi =
    currentEmiInput && currentEmiInput > 0 ? currentEmiInput : computeEmi(outstanding, oldRate, monthsRemaining);
  const newEmiSameTenure = computeEmi(outstanding, newRate, monthsRemaining);
  const newMonthsRaw = computeMonthsRemaining(outstanding, newRate, currentEmi);
  const negativeAmortization = !Number.isFinite(newMonthsRaw);
  const newMonthsSameEmi = negativeAmortization ? monthsRemaining + 120 : Math.min(480, newMonthsRaw);

  const baselineTotalInt = Math.max(0, currentEmi * monthsRemaining - outstanding);
  const raisedEmiTotalInt = Math.max(0, newEmiSameTenure * monthsRemaining - outstanding);
  const extendedTenureTotalInt = Math.max(0, currentEmi * newMonthsSameEmi - outstanding);

  return {
    oldRate,
    newRate,
    currentEmi: Math.round(currentEmi),
    newEmiSameTenure: Math.round(newEmiSameTenure),
    emiDelta: Math.round(newEmiSameTenure - currentEmi),
    currentMonths: monthsRemaining,
    newMonthsSameEmi,
    extraMonths: Math.max(0, newMonthsSameEmi - monthsRemaining),
    extraInterestIfTenureExtended: Math.max(0, Math.round(extendedTenureTotalInt - baselineTotalInt)),
    extraInterestIfEmiRaised: Math.max(0, Math.round(raisedEmiTotalInt - baselineTotalInt)),
    interestSavedByPayingDelta: Math.max(0, Math.round(extendedTenureTotalInt - raisedEmiTotalInt)),
    negativeAmortization,
  };
}

/**
 * Core Loan Shield Audit:
 * Conservative, legally defensible audit against RBI EBLR / Conduct Directions 2025 or US RESPA/Fed benchmarks.
 */
export function auditLoan(input: LoanAuditInput): LoanAuditResult {
  const asOf = input.asOfDate || '2026-11-20';
  const asOfMonth = asOf.slice(0, 7);
  const eblrBound = input.lenderType === 'commercial_bank' || input.lenderType === 'small_finance_bank';
  const matchedLender = findLender(input.lenderName, input.country);

  // Conservative sanction-lag window: lowest policy rate in [start - 2m, start]
  const startWindowFrom = `${shiftMonths(input.startMonth, -2)}-01`;
  const startWindowTo = `${input.startMonth}-28`;
  const startRates = policyRatesBetween(input.country, startWindowFrom, startWindowTo);
  const repoAtStart = Math.min(...startRates);

  // Conservative reset window: highest policy rate in last 3 months
  const resetWindowFrom = `${shiftMonths(asOfMonth, -3)}-01`;
  const recentRates = policyRatesBetween(input.country, resetWindowFrom, asOf);
  const repoNow = Math.max(...recentRates);

  const spreadAtStart = input.startRate - repoAtStart;
  const spreadAdj = input.spreadChanged === 'yes' ? input.spreadDelta : 0;
  const expectedRateNow = Math.max(0.01, spreadAtStart + repoNow + spreadAdj);
  const rateGap = input.currentRate - expectedRateNow;

  const findings: AuditFinding[] = [];
  let totalClaimableRefund = 0;
  let totalAnnualOverpay = 0;

  // 1. India MCLR / Base Rate old benchmark finding
  if (input.country === 'IN' && (input.benchmark === 'mclr' || input.benchmark === 'base_rate')) {
    const newBorrower = matchedLender?.homeLoanLow ?? 0.0825;
    const switchGap = Math.max(0, input.currentRate - (newBorrower + 0.0025));
    const annualSave = Math.round(input.outstanding * switchGap);
    totalAnnualOverpay += annualSave;
    findings.push({
      kind: 'old_benchmark',
      claimable: false,
      headline: `Loan is stuck on ${input.benchmark === 'mclr' ? 'MCLR' : 'Base Rate'} — switch to repo-linked EBLR`,
      detail: `Loans on MCLR or Base Rate do not track RBI repo cuts automatically. Under RBI Directions 2025 para 41, individual floating-rate borrowers can switch to an external benchmark without prepayment fees (paying only a modest administrative conversion fee).`,
      rateGap: switchGap,
      amountThisYear: annualSave,
      overchargedSoFar: 0,
      monthsOvercharged: 0,
      nextStep: `Request a written MCLR-to-EBLR conversion quote from ${input.lenderName} and compare it in the Offer Comparator below.`,
      citations: [CITATIONS.EBLR_SWITCH, CITATIONS.EBLR_MANDATE],
    });
  } else if (input.country === 'IN' && !eblrBound) {
    // HFC or NBFC — outside EBLR mandate
    const refGap = Math.max(0, rateGap);
    const annualDiff = Math.round(input.outstanding * refGap);
    findings.push({
      kind: 'rule_not_binding',
      claimable: false,
      headline: `${input.lenderName} is an HFC/NBFC — RBI's external-benchmark repo mandate does not bind it`,
      detail: `Housing Finance Companies and NBFCs price off their own Board-approved Prime Lending Rate rather than the RBI repo rate. However, they still cannot charge floating-rate foreclosure penalties (HFC Directions para 163(1)) and must offer an EMI vs Tenure choice on hikes.`,
      rateGap: refGap,
      amountThisYear: annualDiff,
      overchargedSoFar: 0,
      monthsOvercharged: 0,
      nextStep: `Ask ${input.lenderName} for an internal rate rewrite first; if refused, you have a zero-penalty right to transfer to an EBLR commercial bank.`,
      citations: [CITATIONS.HFC_RATE_POLICY, CITATIONS.PREPAYMENT_NO_CHARGE],
    });
  } else if (input.country === 'IN' && rateGap > 0.0005) {
    // Missed rate cut — claimable refund with conservative month-by-month annexure!
    // Count whole months overcharged conservatively (up to 12 months since Dec 2025 cut / reset window)
    const monthsOvercharged = 9;
    const annexure: OverchargeMonth[] = [];
    let sumRefund = 0;
    for (let i = monthsOvercharged; i >= 1; i -= 1) {
      const mStr = shiftMonths(asOfMonth, -i);
      const excess = Math.floor((input.outstanding * rateGap) / 12);
      sumRefund += excess;
      annexure.push({
        month: mStr,
        expectedRate: expectedRateNow,
        chargedRate: input.currentRate,
        excessAmount: excess,
      });
    }
    const annualOverpay = Math.round(input.outstanding * rateGap);
    totalClaimableRefund = sumRefund;
    totalAnnualOverpay += annualOverpay;

    findings.push({
      kind: 'missed_rate_cut',
      claimable: true,
      headline: `${formatPct(rateGap)} missed rate reset — estimated ${formatMoney(sumRefund, 'IN')} overcharged`,
      detail: `Based on starting rate ${formatPct(input.startRate)} (repo ${formatPct(repoAtStart)}) and current repo ${formatPct(repoNow)}, the rate should be ${formatPct(expectedRateNow)} rather than ${formatPct(input.currentRate)}. Commercial banks must reset external-benchmark loans at least once every 3 months.`,
      rateGap,
      amountThisYear: annualOverpay,
      overchargedSoFar: sumRefund,
      monthsOvercharged,
      nextStep: `Send the pre-filled Grievance Letter to ${input.lenderName}'s Principal Nodal Officer claiming only the verified missed reset (${formatMoney(sumRefund, 'IN')}).`,
      citations: [CITATIONS.EBLR_MANDATE, CITATIONS.EBLR_RESET, CITATIONS.EBLR_SPREAD],
      annexure,
    });
  }

  // 2. Oct 2026 Hike Cycle Impact (+25 bps on 7 Oct 2026 for IN, +25 bps on 16 Sep 2026 for US)
  const hikeDelta = 0.0025;
  const hikeImpact =
    input.outstanding > 0 && input.monthsRemaining > 0
      ? computeRateMoveImpact(
          input.outstanding,
          input.currentRate,
          input.currentRate + hikeDelta,
          input.monthsRemaining,
          input.emi,
        )
      : null;

  if (input.country === 'IN' && hikeImpact) {
    findings.push({
      kind: 'rate_rise',
      claimable: false,
      headline: `Oct 2026 RBI +0.25% hike: paying +${formatMoney(hikeImpact.emiDelta, 'IN')}/mo saves ${formatMoney(hikeImpact.interestSavedByPayingDelta, 'IN')}`,
      detail: `When RBI raised the repo rate from 5.25% to 5.50% on 7 Oct 2026, banks typically stretch your tenure by +${hikeImpact.extraMonths} months (costing ${formatMoney(hikeImpact.extraInterestIfTenureExtended, 'IN')} extra interest) unless you act. Keep the lower mandatory EMI for safety, and voluntarily prepay the ${formatMoney(hikeImpact.emiDelta, 'IN')}/mo difference.`,
      rateGap: hikeDelta,
      amountThisYear: hikeImpact.emiDelta * 12,
      overchargedSoFar: 0,
      monthsOvercharged: 0,
      nextStep: `Verify whether ${input.lenderName} gave you a written choice of Higher EMI, Longer Tenure, or Part-Prepayment.`,
      citations: [CITATIONS.RESET_CHOICES_BANK],
    });
  }

  // 3. Choice not offered violation
  if (
    input.country === 'IN' &&
    input.choiceOffered === 'no' &&
    (input.bankActionAfterHike === 'emi_raised' ||
      input.bankActionAfterHike === 'tenure_extended' ||
      input.bankActionAfterHike === 'both')
  ) {
    findings.push({
      kind: 'choice_not_offered',
      claimable: false,
      headline: `Statutory violation: ${input.lenderName} altered your EMI/tenure without offering the mandatory choice`,
      detail: `Under RBI Responsible Business Conduct Directions 2025 para 349(3), lenders must explicitly offer (i) higher EMI, (ii) elongated tenure, or (iii) part/full prepayment before applying a benchmark hike reset.`,
      rateGap: 0,
      amountThisYear: 0,
      overchargedSoFar: 0,
      monthsOvercharged: 0,
      nextStep: `Use the "Reset Choice Demand" letter template below to formally record the violation and elect your preferred structure.`,
      citations: [CITATIONS.RESET_CHOICES_BANK, CITATIONS.IO_ESCALATION],
    });
  }

  // 4. Pricing gap (informational only — never claimed as refund!)
  const newBorrowerLow = matchedLender?.homeLoanLow ?? null;
  const effectiveAfterFix = rateGap > 0.0005 && eblrBound ? expectedRateNow : input.currentRate;
  if (newBorrowerLow !== null && effectiveAfterFix - newBorrowerLow >= 0.0025) {
    const pricingGap = effectiveAfterFix - newBorrowerLow;
    const annualGapCost = Math.round(input.outstanding * pricingGap);
    findings.push({
      kind: 'pricing_gap',
      claimable: false,
      headline: `New borrowers at ${input.lenderName} get from ${formatPct(newBorrowerLow)} (${formatPct(pricingGap)} lower)`,
      detail: `This is informational only — banks are not legally required to refund a new-borrower pricing gap, so never include it in a formal complaint. Instead, use it as leverage for an internal spread-conversion request.`,
      rateGap: pricingGap,
      amountThisYear: annualGapCost,
      overchargedSoFar: 0,
      monthsOvercharged: 0,
      nextStep: `Call ${input.lenderName} and ask for their internal spread-reduction fee before entertaining a third-party balance transfer.`,
      citations: [],
    });
  }

  if (findings.length === 0) {
    findings.push({
      kind: 'on_track',
      claimable: false,
      headline: `Your rate (${formatPct(input.currentRate)}) tracks the policy benchmark cleanly`,
      detail: `No missed reset or excess spread detected as of ${POLICY_RATES_AS_OF}. RightDue will watch the next ${NEXT_POLICY_MEETING[input.country].label} decision.`,
      rateGap: 0,
      amountThisYear: 0,
      overchargedSoFar: 0,
      monthsOvercharged: 0,
      nextStep: `Keep your current EMI running and route spare monthly cash per the Command Center.`,
      citations: input.country === 'IN' ? [CITATIONS.EBLR_RESET] : [CITATIONS.US_RESPA_REG_X],
    });
  }

  return {
    lenderName: input.lenderName,
    eblrBound,
    repoAtStart,
    repoNow,
    expectedRateNow,
    rateAsOf: POLICY_RATES_AS_OF,
    nextPolicyMeeting: NEXT_POLICY_MEETING[input.country].label,
    findings,
    hikeImpact,
    totalClaimableRefund,
    totalAnnualOverpay,
    newBorrowerRateLow: newBorrowerLow,
  };
}

/**
 * Compare "Ask Your Own Bank First" (Conversion Fee) vs Balance Transfer Elsewhere vs Keep
 */
export function compareBankRewriteOffer(params: {
  country: Country;
  outstanding: number;
  currentRate: number;
  monthsRemaining: number;
  expectedKeepYears: number;
  owedCutRate?: number | null;
  conversionRate: number;
  conversionFee: number;
  transferRate: number;
  transferCosts: number;
  oldForeclosureFee: number;
  isFloatingIndividualIN: boolean;
}) {
  const gst = params.country === 'IN' ? 1 + MARKET_BENCHMARKS.IN.gstRate : 1;
  const baselineRate =
    params.owedCutRate && params.owedCutRate < params.currentRate ? params.owedCutRate : params.currentRate;
  const horizonMonths = Math.min(params.monthsRemaining, Math.max(12, Math.round(params.expectedKeepYears * 12)));

  const totalInterestAt = (rate: number) => {
    const emi = computeEmi(params.outstanding, rate, params.monthsRemaining);
    let bal = params.outstanding;
    let intSum = 0;
    for (let m = 0; m < horizonMonths && bal > 0.5; m += 1) {
      const i = bal * (rate / 12);
      intSum += i;
      bal = Math.max(0, bal + i - emi);
    }
    return Math.round(intSum);
  };

  const keepInt = totalInterestAt(baselineRate);
  const convInt = totalInterestAt(params.conversionRate);
  const convFeeTotal = Math.round(params.conversionFee * gst);
  const convNetSavings = keepInt - convInt - convFeeTotal;
  const convMonthlySaving = Math.max(1, (keepInt - convInt) / horizonMonths);
  const convBreakEven = keepInt > convInt ? Math.ceil(convFeeTotal / convMonthlySaving) : null;

  const btInt = totalInterestAt(params.transferRate);
  const btFeeTotal = Math.round(params.transferCosts + (params.isFloatingIndividualIN ? 0 : params.oldForeclosureFee));
  const btNetSavings = keepInt - btInt - btFeeTotal;
  const btMonthlySaving = Math.max(1, (keepInt - btInt) / horizonMonths);
  const btBreakEven = keepInt > btInt ? Math.ceil(btFeeTotal / btMonthlySaving) : null;

  const illegalForeclosureFlag = params.isFloatingIndividualIN && params.oldForeclosureFee > 0;
  const minSwitchEdge = params.country === 'IN' ? 10000 : 1000;

  let winner: 'press_owed_cut' | 'stay_convert' | 'transfer' | 'keep' = 'keep';
  let verdictText = 'Stay on your current terms — switching costs outweigh interest saved over your holding period.';

  if (params.owedCutRate && params.owedCutRate <= params.conversionRate && params.owedCutRate < params.currentRate) {
    winner = 'press_owed_cut';
    verdictText = `Do not pay ${formatMoney(convFeeTotal, params.country)} for a conversion — your bank already owes you ${formatPct(params.owedCutRate)} under RBI reset rules for ₹0.`;
  } else if (btNetSavings > Math.max(0, convNetSavings) + minSwitchEdge && (btBreakEven ?? 999) <= horizonMonths) {
    winner = 'transfer';
    verdictText = `Balance transfer wins by ${formatMoney(btNetSavings - Math.max(0, convNetSavings), params.country)} net over ${params.expectedKeepYears} years (breaks even in ${btBreakEven} months).`;
  } else if (convNetSavings > 0 && (convBreakEven ?? 999) <= horizonMonths) {
    winner = 'stay_convert';
    verdictText = `Ask your own bank first: paying the ${formatMoney(convFeeTotal, params.country)} conversion fee saves ${formatMoney(convNetSavings, params.country)} net with zero re-documentation (breaks even in ${convBreakEven} months).`;
  }

  return {
    baselineRate,
    convFeeTotal,
    convNetSavings,
    convBreakEven,
    btFeeTotal,
    btNetSavings,
    btBreakEven,
    illegalForeclosureFlag,
    winner,
    verdictText,
  };
}

const SECOND_PERSON_REGEX = /\byou(r|rs|rself|'re|'ve|'ll|'d)?\b/i;

export function hasStraySecondPerson(text: string): boolean {
  const cleaned = text.replace(/Yours faithfully,/gi, '').replace(/Sincerely,/gi, '');
  return SECOND_PERSON_REGEX.test(cleaned);
}

/**
 * Generates legally structured, third-person statutory letters (zero stray "you").
 */
export function generateFormalLetter(
  kind: LetterKind,
  audit: LoanAuditResult,
  borrower: BorrowerIdentity,
  loanDetails: { outstanding: number; currentRate: number; startMonth: string; startRate: number; emi: number },
): FormalLetter {
  const name = borrower.name.trim() || '[Full Name]';
  const account = borrower.accountNumber.trim() || '[Loan Account Number]';
  const sent = borrower.sentDate || '2026-11-20';
  const lender = findLender(audit.lenderName, kind.startsWith('us_') || kind === 'hardship_us' ? 'US' : 'IN');
  const recipient = lender?.grievanceDesk || `Principal Nodal Officer / Grievance Redressal Desk, ${audit.lenderName}`;

  const missed = audit.findings.find((f) => f.kind === 'missed_rate_cut');
  const claimAmt = missed?.overchargedSoFar ?? 0;

  if (kind === 'in_grievance') {
    const annexLines = (missed?.annexure ?? [])
      .map(
        (r) =>
          `${r.month.padEnd(10)}  ${formatPct(r.expectedRate).padEnd(12)}  ${formatPct(r.chargedRate).padEnd(10)}  ${formatMoney(r.excessAmount, 'IN')}`,
      )
      .join('\n');

    const body = `${recipient}

Date: ${sent}

Subject: Formal Grievance — Non-Transmission of RBI External Benchmark Rate Reset on Loan Account ${account}

Dear Sir or Madam,

The undersigned borrower holds a floating-rate retail loan with ${audit.lenderName} bearing Account Number ${account}, originated in ${loanDetails.startMonth} at a starting rate of ${formatPct(loanDetails.startRate)} (outstanding principal approximately ${formatMoney(loanDetails.outstanding, 'IN')}).

Under paragraphs 25, 33, and 38 of the Reserve Bank of India (Commercial Banks – Interest Rates on Advances) Directions, 2025, a floating-rate retail loan linked to an external benchmark must be reset at least once in three months in line with RBI repo rate changes, and the credit-risk spread may not be increased absent a substantial contractual change in credit assessment.

While the RBI repo rate moved from ${formatPct(audit.repoAtStart)} at origination to ${formatPct(audit.repoNow)}, the loan account continues to be billed at ${formatPct(loanDetails.currentRate)} instead of the expected benchmark-aligned rate of ${formatPct(audit.expectedRateNow)}.

The Bank is requested to:
1. Reset the interest rate on Account ${account} immediately to ${formatPct(audit.expectedRateNow)} in compliance with RBI Directions, 2025.
2. Refund or adjust against principal the conservative excess interest charged of ${formatMoney(claimAmt, 'IN')} (detailed in the annexure below).
3. Provide a written rate-reset sheet showing the external benchmark, spread breakdown, and effective reset dates.

Please treat this communication as a formal grievance registered under the Bank's Grievance Redressal Policy. Pursuant to the RBI (Commercial Banks – Internal Ombudsman) Directions, 2026 and the Reserve Bank – Integrated Ombudsman Scheme, 2026, a complete resolution is requested within 30 calendar days, failing which the matter will be escalated to the RBI Ombudsman.

Yours faithfully,

${name}
Account: ${account}${borrower.phone ? `\nPhone: ${borrower.phone}` : ''}${borrower.email ? `\nEmail: ${borrower.email}` : ''}${
      annexLines
        ? `\n\n--- ANNEXURE: CONSERVATIVE EXCESS INTEREST SCHEDULE ---\nMonth       Expected      Charged     Excess\n${annexLines}\nTotal Claimable Excess: ${formatMoney(claimAmt, 'IN')}`
        : ''
    }`;

    const replyDue = addDaysIso(sent, 30);
    const rbiDeadline = addDaysIso(replyDue, 90);
    return {
      kind,
      title: 'Bank Grievance Letter (Principal Nodal Officer)',
      recipient,
      subject: `Formal Grievance — Non-Transmission of RBI External Benchmark Rate Reset (${account})`,
      body,
      statutoryDeadlines: [
        { label: 'Bank 30-day statutory reply deadline', date: replyDue, note: 'Auto-escalation to Internal Ombudsman required before any rejection.' },
        { label: 'RBI Ombudsman window opens', date: replyDue, note: 'File free at cms.rbi.org.in if unresolved.' },
        { label: 'RBI Ombudsman 90-day cutoff (RB-IOS 2026)', date: rbiDeadline, note: 'Strict 90-day filing limit from expiry of 30 days or last reply.' },
      ],
      citations: [CITATIONS.EBLR_MANDATE, CITATIONS.EBLR_RESET, CITATIONS.IO_ESCALATION, CITATIONS.RBIOS_2026],
      selfCheck: [
        'Bank name, account number, and borrower contact details match the latest statement.',
        'Starting rate and origination month match the sanction letter or Key Facts Statement (KFS).',
        'No written notice of a credit-risk spread revision was received from the bank.',
      ],
      hasStraySecondPerson: hasStraySecondPerson(body),
    };
  }

  if (kind === 'in_rbi_ombudsman') {
    const replyDue = addDaysIso(sent, 30);
    const rbiDeadline = addDaysIso(borrower.bankReplyDate || replyDue, 90);
    const body = `RESERVE BANK – INTEGRATED OMBUDSMAN SCHEME, 2026 (CMS PORTAL FILING PACK: https://cms.rbi.org.in)

Regulated Entity: ${audit.lenderName}
Loan Account Number: ${account}
Complainant Name: ${name}
Date of Initial Bank Grievance: ${sent}

SUMMARY OF FACTS (FOR CMS DESCRIPTION BOX):
The complainant holds a floating-rate loan (Account ${account}) with ${audit.lenderName}, sanctioned in ${loanDetails.startMonth} at ${formatPct(loanDetails.startRate)}. Despite RBI repo rate reductions and the mandatory three-month external benchmark reset rule under paragraphs 25 and 38 of the RBI (Commercial Banks – Interest Rates on Advances) Directions, 2025, the regulated entity continued charging ${formatPct(loanDetails.currentRate)} against an expected rate of ${formatPct(audit.expectedRateNow)}. A formal grievance was submitted on ${sent}; more than 30 days have elapsed without satisfactory resolution or mandatory Internal Ombudsman review under the Internal Ombudsman Directions, 2026.

RELIEF SOUGHT:
1. Direction to ${audit.lenderName} to immediately align Account ${account} to ${formatPct(audit.expectedRateNow)}.
2. Refund / principal credit of excess interest conservatively quantified at ${formatMoney(claimAmt, 'IN')}.
3. Appropriate compensation for time, expenses, and mental anguish as permitted under RB-IOS 2026 (up to ₹3,00,000 alongside consequential loss).

ENCLOSURES TO UPLOAD:
- Sanction letter / Key Facts Statement (KFS)
- Latest loan account statement showing current rate ${formatPct(loanDetails.currentRate)}
- Copy of grievance sent on ${sent} and bank acknowledgement / reply (if any)`;

    return {
      kind,
      title: 'RBI Ombudsman CMS Filing Pack (RB-IOS 2026)',
      recipient: 'RBI Integrated Ombudsman — https://cms.rbi.org.in',
      subject: `RBI Ombudsman Complaint — ${audit.lenderName} (${account})`,
      body,
      portalUrl: 'https://cms.rbi.org.in',
      statutoryDeadlines: [
        { label: 'Strict 90-day filing cutoff', date: rbiDeadline, note: 'RB-IOS 2026 shortened the window from 1 year to 90 days.' },
      ],
      citations: [CITATIONS.RBIOS_2026, CITATIONS.IO_ESCALATION],
      selfCheck: [
        'At least 30 days have passed since the bank received the written grievance, OR a final unsatisfactory reply was received.',
        'Complaint is being filed within 90 days of the reply or expiry of the 30-day period.',
      ],
      hasStraySecondPerson: hasStraySecondPerson(body),
    };
  }

  if (kind === 'in_noc_closure') {
    const releaseDue = addDaysIso(sent, 30);
    const body = `${recipient}

Date: ${sent}

Subject: Demand for Original Property Documents, No-Dues Certificate (NOC), and Charge Removal — Account ${account}

Dear Sir or Madam,

Loan Account ${account} held by ${name} with ${audit.lenderName} has been repaid in full on ${sent}.

Pursuant to the Reserve Bank of India (Responsible Business Conduct) Directions, 2025 (carrying forward circular RBI/2023-24/60 dated 13 September 2023), a regulated entity must release all original movable/immovable property title documents and remove all charges registered with CERSAI / Sub-Registrar registries within 30 calendar days of full repayment.

Where delay beyond 30 days is attributable to the lender, the Directions mandate compensation to the borrower at the rate of ₹5,000 for each day of delay.

The Lender is requested to:
1. Issue the formal Loan Closure / No-Dues Certificate (NOC) and confirm zero outstanding balance.
2. Hand over all original title deeds and security documents on or before ${releaseDue} at the home servicing branch.
3. File charge satisfaction / CERSAI removal and provide written acknowledgement.
4. State in writing if any administrative courier or duplicate-copy fee is claimed, noting that standard NOC and document release are normally free.

Yours faithfully,

${name}
Account: ${account}`;

    return {
      kind,
      title: 'Loan Closure & NOC Demand (₹5,000/day RBI Rule)',
      recipient,
      subject: `Release of Original Title Documents & NOC within 30 Days (${account})`,
      body,
      statutoryDeadlines: [
        { label: '30-day statutory release deadline', date: releaseDue, note: '₹5,000/day penalty accrues automatically after this date if lender is at fault.' },
      ],
      citations: [CITATIONS.NOC_RELEASE_30D],
      selfCheck: [
        'Full and final settlement payment receipt / closure reference is attached.',
        'List of original title documents deposited at sanction is verified.',
      ],
      hasStraySecondPerson: hasStraySecondPerson(body),
    };
  }

  if (kind === 'us_respa_noe') {
    const ackDue = addBusinessDaysIso(sent, 5);
    const resDue = addBusinessDaysIso(sent, 30);
    const body = `${recipient}

Date: ${sent}

NOTICE OF ERROR PURSUANT TO 12 CFR § 1024.35 (RESPA REGULATION X)
Borrower: ${name}
Loan Account Number: ${account}

Dear Sir or Madam,

Please treat this correspondence as a formal written Notice of Error under Regulation X, 12 CFR § 1024.35, concerning Loan Account ${account} (current balance ${formatMoney(loanDetails.outstanding, 'US')}, stated rate ${formatPct(loanDetails.currentRate)}).

The borrower identifies a servicing and interest-rate calculation error on the account and requests a full audit of the interest accrual, index-plus-margin adjustment schedule, and payment application history since ${loanDetails.startMonth}.

Pursuant to 12 CFR § 1024.35(d)–(e), the servicer is required to:
1. Provide written acknowledgment of receipt of this Notice of Error within five (5) business days (by ${ackDue}).
2. Conduct a reasonable investigation, make any required account corrections and fee/interest refunds, or provide a written explanation with supporting documentation within thirty (30) business days (by ${resDue}).
3. Refrain from furnishing adverse credit information regarding any disputed payment for 60 days pursuant to 12 CFR § 1024.35(i).

Sincerely,

${name}
Account: ${account}`;

    return {
      kind,
      title: 'US Mortgage Notice of Error (RESPA Reg X)',
      recipient,
      subject: `RESPA Notice of Error — Loan Account ${account}`,
      body,
      portalUrl: 'https://www.consumerfinance.gov/complaint/',
      statutoryDeadlines: [
        { label: '5-business-day written acknowledgment due', date: ackDue, note: 'Required under 12 CFR § 1024.35(d).' },
        { label: '30-business-day substantive resolution due', date: resDue, note: 'Escalate to CFPB if missed or unresolved.' },
      ],
      citations: [CITATIONS.US_RESPA_REG_X],
      selfCheck: [
        'Letter is addressed to the servicer’s designated Notice of Error / QWR address (not the payment lockbox).',
        'Sent via Certified Mail with Return Receipt Requested.',
      ],
      hasStraySecondPerson: hasStraySecondPerson(body),
    };
  }

  if (kind === 'us_fcba_dispute') {
    const ackDue = addDaysIso(sent, 30);
    const resDue = addDaysIso(sent, 90);
    const body = `${recipient}

Date: ${sent}

WRITTEN BILLING ERROR NOTICE PURSUANT TO 12 CFR § 1026.13 (FAIR CREDIT BILLING ACT)
Cardholder: ${name}
Account Ending: ${account}

Dear Sir or Madam,

This letter serves as a formal Billing Error Notice under the Fair Credit Billing Act and Regulation Z (12 CFR § 1026.13) regarding Account ${account}.

The cardholder disputes finance charges and/or billing entries reflected on the latest statement dated prior to ${sent} on the current balance of ${formatMoney(loanDetails.outstanding, 'US')}.

Pursuant to 12 CFR § 1026.13(c)–(d), the issuer is requested to:
1. Acknowledge receipt of this billing-error notice in writing within 30 days (by ${ackDue}).
2. Investigate and resolve the dispute within two complete billing cycles and no later than 90 days (by ${resDue}).
3. Suspend collection activity and adverse credit bureau reporting on the disputed amount while the investigation is pending.

Sincerely,

${name}
Account: ${account}`;

    return {
      kind,
      title: 'US Credit Card Billing Dispute (FCBA Reg Z)',
      recipient,
      subject: `Fair Credit Billing Act Dispute — Account ${account}`,
      body,
      portalUrl: 'https://www.consumerfinance.gov/complaint/',
      statutoryDeadlines: [
        { label: '30-day issuer acknowledgment', date: ackDue, note: '12 CFR § 1026.13(c)(1).' },
        { label: '90-day outer resolution limit', date: resDue, note: 'Two billing cycles maximum.' },
      ],
      citations: [CITATIONS.US_FCBA_REG_Z],
      selfCheck: [
        'Sent within 60 days of the first statement showing the billing error.',
        'Addressed to the issuer’s Billing Inquiries address (not the payment remittance address).',
      ],
      hasStraySecondPerson: hasStraySecondPerson(body),
    };
  }

  // Default / Reset Choice / Hardship letter
  const isUS = kind === 'hardship_us';
  const isHardship = kind === 'hardship_in' || kind === 'hardship_us';
  const replyDue = addDaysIso(sent, 30);
  const body = isHardship
    ? `${recipient}

Date: ${sent}

Subject: Proactive Request for Temporary Repayment Restructuring / Hardship Accommodation — Account ${account}

Dear Sir or Madam,

The undersigned borrower (${name}, Account ${account}) writes proactively ahead of the upcoming due date to inform ${audit.lenderName} of a temporary cash-flow constraint affecting the scheduled payment of ${formatMoney(loanDetails.emi, isUS ? 'US' : 'IN')}.

The borrower remains committed to full repayment and requests a written temporary accommodation (such as a short-term EMI reduction, tenure extension, or interest-only bridge for 3 months) so the account stays regular without default or avoidable bounce penalties.

The borrower is able to remit a partial commitment immediately while formal restructuring terms are finalized in writing. Please confirm available hardship options and applicable terms in writing before the next billing cycle.

Yours faithfully,

${name}
Account: ${account}`
    : `${recipient}

Date: ${sent}

Subject: Exercise of Mandatory Rate-Reset Choice under RBI Responsible Business Conduct Directions, 2025 — Account ${account}

Dear Sir or Madam,

The undersigned borrower holds floating-rate Loan Account ${account} with ${audit.lenderName}. Following the recent benchmark interest rate increase, the EMI/tenor on the account was revised without providing the borrower an explicit written election among the mandatory options under paragraph 349(3) of the RBI (Commercial Banks – Responsible Business Conduct) Directions, 2025.

The Bank is requested to:
1. Provide a complete reset communication detailing the revised rate, residual tenor, and impact on total interest.
2. Confirm that no negative amortisation occurs under paragraph 349(5).
3. Record the borrower's formal choice regarding EMI enhancement, tenor elongation, or part-prepayment without penalty.

Yours faithfully,

${name}
Account: ${account}`;

  return {
    kind,
    title: isHardship ? 'Proactive Hardship Restructuring Letter' : 'RBI Rate-Reset Choice Demand (Para 349)',
    recipient,
    subject: isHardship ? `Hardship Restructuring Request (${account})` : `Mandatory Rate-Reset Choice Demand (${account})`,
    body,
    statutoryDeadlines: [
      { label: 'Lender written response target', date: replyDue, note: 'Keep written proof of proactive contact before any missed due date.' },
    ],
    citations: isUS ? [CITATIONS.US_RESPA_REG_X] : [CITATIONS.RESET_CHOICES_BANK, CITATIONS.IO_ESCALATION],
    selfCheck: [
      'Account number and realistic affordable monthly figure are confirmed.',
      'Sent via written email / grievance portal before the scheduled due date.',
    ],
    hasStraySecondPerson: hasStraySecondPerson(body),
  };
}
