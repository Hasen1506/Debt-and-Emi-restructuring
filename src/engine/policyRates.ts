import type { Citation, Country, LenderType } from './types';

export interface PolicyRatePoint {
  date: string; // YYYY-MM-DD
  rate: number; // annual fraction
}

export const POLICY_RATES_AS_OF = '2026-10-09';

// Verified against RBI monetary policy statements (2018-08-01 through 2026-10-07 MPC +25 bps to 5.50%)
export const REPO_RATE_IN: PolicyRatePoint[] = [
  { date: '2018-08-01', rate: 0.065 },
  { date: '2019-02-07', rate: 0.0625 },
  { date: '2019-04-04', rate: 0.06 },
  { date: '2019-06-06', rate: 0.0575 },
  { date: '2019-08-07', rate: 0.054 },
  { date: '2019-10-04', rate: 0.0515 },
  { date: '2020-03-27', rate: 0.044 },
  { date: '2020-05-22', rate: 0.04 },
  { date: '2022-05-04', rate: 0.044 },
  { date: '2022-06-08', rate: 0.049 },
  { date: '2022-08-05', rate: 0.054 },
  { date: '2022-09-30', rate: 0.059 },
  { date: '2022-12-07', rate: 0.0625 },
  { date: '2023-02-08', rate: 0.065 },
  { date: '2025-02-07', rate: 0.0625 },
  { date: '2025-04-09', rate: 0.06 },
  { date: '2025-06-06', rate: 0.055 },
  { date: '2025-12-05', rate: 0.0525 },
  { date: '2026-10-07', rate: 0.055 },
];

// Verified against Federal Reserve FOMC statements (upper bound, through 2026-09-16 at 4.00%)
export const FED_FUNDS_US: PolicyRatePoint[] = [
  { date: '2018-12-19', rate: 0.025 },
  { date: '2019-07-31', rate: 0.0225 },
  { date: '2019-09-18', rate: 0.02 },
  { date: '2019-10-30', rate: 0.0175 },
  { date: '2020-03-03', rate: 0.0125 },
  { date: '2020-03-15', rate: 0.0025 },
  { date: '2022-03-16', rate: 0.005 },
  { date: '2022-05-04', rate: 0.01 },
  { date: '2022-06-15', rate: 0.0175 },
  { date: '2022-07-27', rate: 0.025 },
  { date: '2022-09-21', rate: 0.0325 },
  { date: '2022-11-02', rate: 0.04 },
  { date: '2022-12-14', rate: 0.045 },
  { date: '2023-02-01', rate: 0.0475 },
  { date: '2023-03-22', rate: 0.05 },
  { date: '2023-05-03', rate: 0.0525 },
  { date: '2023-07-26', rate: 0.055 },
  { date: '2024-09-18', rate: 0.05 },
  { date: '2024-11-07', rate: 0.0475 },
  { date: '2024-12-18', rate: 0.045 },
  { date: '2025-09-17', rate: 0.0425 },
  { date: '2025-10-29', rate: 0.04 },
  { date: '2025-12-10', rate: 0.0375 },
  { date: '2026-09-16', rate: 0.04 },
];

export const NEXT_POLICY_MEETING: Record<Country, { date: string; label: string }> = {
  IN: { date: '2026-12-04', label: 'RBI MPC (2–4 Dec 2026)' },
  US: { date: '2026-12-09', label: 'FOMC (8–9 Dec 2026)' },
};

export const MARKET_BENCHMARKS = {
  IN: {
    fd1Yr: 0.0625,
    liquidFund: 0.0587,
    gsec1Yr: 0.0664,
    inflation: 0.052,
    gstRate: 0.18,
    asOf: '2026-11-16',
  },
  US: {
    hysa: 0.035,
    treasury1Yr: 0.0465,
    mortgage30Yr: 0.0711,
    inflation: 0.023,
    gstRate: 0,
    asOf: '2026-11-13',
  },
};

export interface LenderDirectoryEntry {
  id: string;
  name: string;
  country: Country;
  type: LenderType;
  homeLoanLow: number | null;
  homeLoanHigh: number | null;
  personalLoanMean: number | null;
  processingFeePct: number;
  grievanceDesk: string;
}

export const LENDER_DIRECTORY: LenderDirectoryEntry[] = [
  {
    id: 'IN_SBI',
    name: 'State Bank of India (SBI)',
    country: 'IN',
    type: 'commercial_bank',
    homeLoanLow: 0.075,
    homeLoanHigh: 0.087,
    personalLoanMean: 0.118,
    processingFeePct: 0.005,
    grievanceDesk: 'Principal Nodal Officer, State Bank of India, Customer Service Dept, Mumbai',
  },
  {
    id: 'IN_HDFC',
    name: 'HDFC Bank',
    country: 'IN',
    type: 'commercial_bank',
    homeLoanLow: 0.08,
    homeLoanHigh: 0.094,
    personalLoanMean: 0.125,
    processingFeePct: 0.005,
    grievanceDesk: 'Principal Nodal Officer, HDFC Bank Ltd., Grievance Redressal Cell, Mumbai',
  },
  {
    id: 'IN_ICICI',
    name: 'ICICI Bank',
    country: 'IN',
    type: 'commercial_bank',
    homeLoanLow: 0.085,
    homeLoanHigh: 0.099,
    personalLoanMean: 0.1275,
    processingFeePct: 0.005,
    grievanceDesk: 'Principal Nodal Officer, ICICI Bank Ltd., Bandra Kurla Complex, Mumbai',
  },
  {
    id: 'IN_AXIS',
    name: 'Axis Bank',
    country: 'IN',
    type: 'commercial_bank',
    homeLoanLow: 0.0825,
    homeLoanHigh: 0.0935,
    personalLoanMean: 0.132,
    processingFeePct: 0.005,
    grievanceDesk: 'Principal Nodal Officer, Axis Bank Ltd., NPC1, Worli, Mumbai',
  },
  {
    id: 'IN_KOTAK',
    name: 'Kotak Mahindra Bank',
    country: 'IN',
    type: 'commercial_bank',
    homeLoanLow: 0.083,
    homeLoanHigh: 0.094,
    personalLoanMean: 0.129,
    processingFeePct: 0.005,
    grievanceDesk: 'Principal Nodal Officer, Kotak Mahindra Bank Ltd., Mumbai',
  },
  {
    id: 'IN_BOB',
    name: 'Bank of Baroda',
    country: 'IN',
    type: 'commercial_bank',
    homeLoanLow: 0.079,
    homeLoanHigh: 0.091,
    personalLoanMean: 0.122,
    processingFeePct: 0.005,
    grievanceDesk: 'Principal Nodal Officer, Bank of Baroda, Baroda Corporate Centre, Mumbai',
  },
  {
    id: 'IN_LICHFL',
    name: 'LIC Housing Finance',
    country: 'IN',
    type: 'hfc',
    homeLoanLow: 0.0835,
    homeLoanHigh: 0.096,
    personalLoanMean: null,
    processingFeePct: 0.005,
    grievanceDesk: 'Grievance Redressal Officer, LIC Housing Finance Ltd., Mumbai',
  },
  {
    id: 'IN_BAJAJ_HFC',
    name: 'Bajaj Housing Finance',
    country: 'IN',
    type: 'hfc',
    homeLoanLow: 0.084,
    homeLoanHigh: 0.098,
    personalLoanMean: 0.145,
    processingFeePct: 0.005,
    grievanceDesk: 'Grievance Redressal Officer, Bajaj Housing Finance Ltd., Pune',
  },
  {
    id: 'US_CHASE',
    name: 'Chase',
    country: 'US',
    type: 'us_bank',
    homeLoanLow: 0.0685,
    homeLoanHigh: 0.0735,
    personalLoanMean: 0.109,
    processingFeePct: 0.01,
    grievanceDesk: 'JPMorgan Chase Bank, N.A. — Notice of Error / Qualified Written Request Desk, Columbus, OH',
  },
  {
    id: 'US_AMEX',
    name: 'American Express',
    country: 'US',
    type: 'us_bank',
    homeLoanLow: null,
    homeLoanHigh: null,
    personalLoanMean: 0.104,
    processingFeePct: 0,
    grievanceDesk: 'American Express Billing Inquiries, PO Box 981535, El Paso, TX 79998',
  },
  {
    id: 'US_WELLS',
    name: 'Wells Fargo',
    country: 'US',
    type: 'us_servicer',
    homeLoanLow: 0.069,
    homeLoanHigh: 0.074,
    personalLoanMean: 0.114,
    processingFeePct: 0.01,
    grievanceDesk: 'Wells Fargo Home Mortgage — Written Notice of Error, MAC F2302-04C, Des Moines, IA',
  },
  {
    id: 'US_BOFA',
    name: 'Bank of America',
    country: 'US',
    type: 'us_bank',
    homeLoanLow: 0.068,
    homeLoanHigh: 0.073,
    personalLoanMean: 0.109,
    processingFeePct: 0.01,
    grievanceDesk: 'Bank of America, N.A. — Notice of Error Department, Simi Valley, CA',
  },
];

export const CITATIONS: Record<string, Citation> = {
  EBLR_MANDATE: {
    id: 'EBLR_MANDATE',
    rule: 'RBI (Commercial Banks – Interest Rates on Advances) Directions, 2025, para 25; DBR.DIR.BC.No.14/13.03.00/2019-20',
    requirement:
      'All floating-rate retail loans from commercial banks since 1 Oct 2019 must link to an external benchmark (usually RBI repo rate).',
    clause:
      '25. All floating rate personal or retail loans (housing, auto, etc.) extended by banks shall be benchmarked to an External Benchmark Rate.',
    url: 'https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=13149',
    checkedOn: '2026-10-12',
  },
  EBLR_RESET: {
    id: 'EBLR_RESET',
    rule: 'RBI (Commercial Banks – Interest Rates on Advances) Directions, 2025, para 38',
    requirement: 'The interest rate under an external benchmark must be reset at least once every three months.',
    clause: '38. The interest rate under external benchmark shall be reset at least once in three months.',
    url: 'https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=13149',
    checkedOn: '2026-10-12',
  },
  EBLR_SPREAD: {
    id: 'EBLR_SPREAD',
    rule: 'RBI (Commercial Banks – Interest Rates on Advances) Directions, 2025, para 33',
    requirement:
      'Credit risk spread may change only if the borrower’s credit profile undergoes a substantial contractual change; other spread parts only once in 3 years.',
    clause:
      '33. Credit risk premium may undergo change only when borrower’s credit assessment undergoes a substantial change, as agreed upon in the loan contract.',
    url: 'https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=13149',
    checkedOn: '2026-10-12',
  },
  EBLR_SWITCH: {
    id: 'EBLR_SWITCH',
    rule: 'RBI (Commercial Banks – Interest Rates on Advances) Directions, 2025, para 41',
    requirement:
      'Individual floating-rate MCLR/base-rate borrowers may switch to the external benchmark without prepayment fees, paying only reasonable administrative costs.',
    clause:
      'Floating rate term loans eligible to prepay without pre-payment charges shall be eligible for switchover to External Benchmark without any charges / fees, except reasonable administrative / legal costs.',
    url: 'https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=13149',
    checkedOn: '2026-10-12',
  },
  RESET_CHOICES_BANK: {
    id: 'RESET_CHOICES_BANK',
    rule: 'RBI (Commercial Banks – Responsible Business Conduct) Directions, 2025, para 349 (updated 1 Oct 2026)',
    requirement:
      'At any benchmark rate rise, the bank must offer higher EMI, elongated tenor, or a combination, plus part/full prepayment, and must prevent negative amortisation.',
    clause:
      'The borrower shall be given the choice to opt for (i) enhancement in EMI or elongation of tenor or for a combination of both options; and (ii) to prepay, either in part or in full. Elongation shall not result in negative amortisation.',
    url: 'https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=13140',
    checkedOn: '2026-10-12',
  },
  PREPAYMENT_NO_CHARGE: {
    id: 'PREPAYMENT_NO_CHARGE',
    rule: 'RBI (Pre-payment Charges on Loans) Directions, 2025 (2 July 2025)',
    requirement:
      'No prepayment or foreclosure penalty may be charged on floating-rate loans to individuals for non-business purposes, regardless of funding source.',
    clause:
      'No pre-payment or foreclosure charge may be levied on a floating-rate loan taken by an individual for a non-business purpose from any source of funds.',
    url: 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12878&Mode=0',
    checkedOn: '2026-10-12',
  },
  IO_ESCALATION: {
    id: 'IO_ESCALATION',
    rule: 'RBI (Commercial Banks – Internal Ombudsman) Directions, 2026, cl. 14(1) & 14(9) (14 Jan 2026)',
    requirement:
      'Every partially resolved or rejected grievance must auto-escalate to the Internal Ombudsman with a final decision within 30 days of receipt.',
    clause:
      'All complaints that are partially resolved or wholly rejected by the bank’s internal grievance redress mechanism shall be auto escalated to the office of the IO for review; final decision within 30 days.',
    url: 'https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=13271',
    checkedOn: '2026-10-12',
  },
  RBIOS_2026: {
    id: 'RBIOS_2026',
    rule: 'Reserve Bank – Integrated Ombudsman Scheme, 2026 (effective 1 Jul 2026), cl. 10',
    requirement:
      'Free filing at cms.rbi.org.in after 30 days of no reply or unsatisfactory reply; must be filed within 90 days. Awards up to ₹30 lakh + ₹3 lakh harassment compensation.',
    clause:
      'The complaint must be made to the RBI Ombudsman within 90 days from expiry of 30 days or date of last communication. Compensation up to Rs 30 lakh plus Rs 3 lakh for mental anguish/time.',
    url: 'https://cms.rbi.org.in',
    checkedOn: '2026-10-12',
  },
  NOC_RELEASE_30D: {
    id: 'NOC_RELEASE_30D',
    rule: 'RBI Responsible Business Conduct Directions, 2025 (carrying forward RBI/2023-24/60, 13 Sep 2023)',
    requirement:
      'Lenders must release all original property documents and remove registered charges within 30 days of full repayment, or pay ₹5,000 per day of delay.',
    clause:
      'Regulated Entities shall release all original movable / immovable property documents and remove charges registered within 30 days after full repayment, failing which compensation of ₹5,000 for each day of delay shall be paid.',
    url: 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12535',
    checkedOn: '2026-10-12',
  },
  HFC_RATE_POLICY: {
    id: 'HFC_RATE_POLICY',
    rule: 'RBI (Housing Finance Companies) Directions, 2025, paras 137, 146, 163(1) & 176(3)',
    requirement:
      'HFCs set rates under a Board-approved model (not bound to RBI repo), must give EMI/tenor choice on resets, cannot charge floating-rate foreclosure fees, and complaints go to NHB GRIDS.',
    clause:
      'The HFC shall not charge pre-payment levy on floating rate housing loans pre-closed from any source; changes apply prospectively; complaints escalate to National Housing Bank (GRIDS).',
    url: 'https://www.nhb.org.in/en/grievance-redressal-officer/',
    checkedOn: '2026-10-12',
  },
  US_RESPA_REG_X: {
    id: 'US_RESPA_REG_X',
    rule: 'RESPA Regulation X, 12 CFR § 1024.35 (Error Resolution Procedures)',
    requirement:
      'Mortgage servicer must acknowledge a written Notice of Error within 5 business days and conduct an investigation and respond within 30 business days.',
    clause:
      'Within five days (excluding legal public holidays, Saturdays, and Sundays) of a servicer receiving a notice of error, the servicer shall provide a written response acknowledging receipt, and resolve within 30 business days.',
    url: 'https://www.consumerfinance.gov/rules-policy/regulations/1024/35/',
    checkedOn: '2026-10-12',
  },
  US_FCBA_REG_Z: {
    id: 'US_FCBA_REG_Z',
    rule: 'Fair Credit Billing Act / Truth in Lending Regulation Z, 12 CFR § 1026.13',
    requirement:
      'Written billing-error notice sent within 60 days of statement triggers mandatory 30-day acknowledgment and resolution within two billing cycles (max 90 days); no collection on disputed amount.',
    clause:
      'The creditor shall mail or deliver written acknowledgment within 30 days and resolve the dispute within two complete billing cycles (not exceeding 90 days) without reporting the disputed amount delinquent.',
    url: 'https://www.consumerfinance.gov/rules-policy/regulations/1026/13/',
    checkedOn: '2026-10-12',
  },
};

export function policyRateOn(country: Country, isoDate: string): number {
  const series = country === 'IN' ? REPO_RATE_IN : FED_FUNDS_US;
  let result = series[0].rate;
  for (const pt of series) {
    if (pt.date <= isoDate) {
      result = pt.rate;
    } else {
      break;
    }
  }
  return result;
}

export function policyRatesBetween(country: Country, startIso: string, endIso: string): number[] {
  const series = country === 'IN' ? REPO_RATE_IN : FED_FUNDS_US;
  const out = [policyRateOn(country, startIso)];
  for (const pt of series) {
    if (pt.date > startIso && pt.date <= endIso) {
      out.push(pt.rate);
    }
  }
  return out;
}

export function findLender(name: string, country: Country): LenderDirectoryEntry | null {
  const q = name.trim().toLowerCase();
  if (!q) return null;
  const candidates = LENDER_DIRECTORY.filter((l) => l.country === country);
  return (
    candidates.find((l) => l.name.toLowerCase() === q) ||
    candidates.find((l) => l.name.toLowerCase().includes(q) || q.includes(l.name.toLowerCase().split(' ')[0])) ||
    null
  );
}
