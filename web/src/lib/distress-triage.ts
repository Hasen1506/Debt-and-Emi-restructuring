/**
 * "I can't pay this month" triage (sprint L4; critique #3, add #2).
 *
 * Pure functions, no network: which payment to protect first, what a
 * missed payment costs, how lateness grows, and a hardship-request letter.
 * Every rule cited here was checked against the RBI text on rbi.org.in on
 * 12 Oct 2026 (TRIAGE_RULES carries the link, date and the words relied
 * on). Lender-specific numbers (a penal charge, a bounce charge) are never
 * guessed: the user types them from the KFS or schedule of charges, and a
 * blank one counts as 0 with "check your KFS" beside it.
 */
import type { LoanType } from './api';

export const TRIAGE_VERIFIED_ON = '2026-10-12';

export interface TriageRule {
  id: string;
  title: string;
  /** The rule in plain words, close to the RBI text. */
  plain: string;
  /** The instrument, with its number and date. */
  source: string;
  url: string;
  /** In force from (ISO date). */
  from: string;
}

export const TRIAGE_RULES: Record<string, TriageRule> = {
  penal: {
    id: 'penal',
    title: 'Penal charges, not penal interest',
    plain:
      'A lender may charge a fixed penal charge for a missed payment, but not "penal interest" added to your rate, and no interest on the penal charge itself. It must be reasonable, written in your loan agreement / KFS, and named in any reminder. For a personal (non-business) loan it can be no higher than for a business borrower. Interest on the unpaid EMI at your normal rate still runs. This rule does not cover credit cards.',
    source:
      'RBI, Fair Lending Practice – Penal Charges in Loan Accounts, RBI/2023-24/53, 18 Aug 2023 (paras 3(i)–(vii), 5); in force for new loans from 1 Apr 2024 (RBI/2023-24/102); carried into the Responsible Business Conduct Directions, 2025',
    url: 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12527',
    from: '2024-04-01',
  },
  card_past_due: {
    id: 'card_past_due',
    title: 'Credit cards: 3 days, then reported',
    plain:
      'A card is reported "past due" to the credit bureaus, and a late fee charged, only when it stays unpaid for more than three days after the statement due date. The late fee is on the amount still unpaid after the due date, not the whole bill. Paying at least the minimum due by then avoids both.',
    source: 'RBI (Commercial Banks – Credit Cards and Debit Cards: Issuance and Conduct) Directions, 2025',
    url: 'https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=13155',
    from: '2025-11-28',
  },
  card_overlimit: {
    id: 'card_overlimit',
    title: 'Credit cards: no over-limit without your consent',
    plain:
      'Spending beyond the card limit needs your prior, explicit consent, and you can switch over-limit off in the bank\u2019s app. Without your consent there can be no over-limit and no over-limit charge. Interest and fees don\u2019t count toward the limit for this.',
    source: 'RBI Credit Cards Directions, 2025; RBI FAQ on the card Directions (Query 10–11)',
    url: 'https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=13155',
    from: '2025-11-28',
  },
  sma: {
    id: 'sma',
    title: 'How lateness is tracked',
    plain:
      'From the first day a payment is overdue the lender marks the loan a "special mention account" (SMA): SMA-0 for 1–30 days overdue, SMA-1 for 31–60 days, SMA-2 for 61–90 days.',
    source: 'RBI, Prudential Framework for Resolution of Stressed Assets, 7 Jun 2019, para 6',
    url: 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=11580&Mode=0',
    from: '2019-06-07',
  },
  restructuring: {
    id: 'restructuring',
    title: 'What a formal restructuring means',
    plain:
      'Restructuring is the lender giving you concessions because of financial difficulty: a longer period, a smaller instalment, a lower rate. Each lender decides under its own Board-approved policy; it is not automatic. A loan that is up to date when it is restructured is immediately classed as a non-performing asset (NPA), so ask for a simple pause or a longer tenure first.',
    source: 'RBI, Prudential Framework for Resolution of Stressed Assets, 7 Jun 2019, para 9 and Annex 1 paras 1, 4',
    url: 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=11580&Mode=0',
    from: '2019-06-07',
  },
  reset_choice: {
    id: 'reset_choice',
    title: 'Floating-rate loans: your choice at a rate reset',
    plain:
      'When the rate on a floating-rate EMI loan is reset, you must be given the choice of a higher EMI, a longer tenure, or both, and the option to prepay.',
    source: 'RBI, Reset of Floating Interest Rate on EMI based Personal Loans, 18 Aug 2023',
    url: 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12529',
    from: '2023-08-18',
  },
  recovery: {
    id: 'recovery',
    title: 'Your rights with recovery agents',
    plain:
      'No intimidation or harassment of any kind, no public humiliation, no messages to your family, referees or friends, no threatening or anonymous calls, no repeated calls, no calls before 8:00 a.m. or after 7:00 p.m., and no false or misleading statements.',
    source:
      'RBI, Outsourcing of Financial Services – Responsibilities of regulated entities employing Recovery Agents, RBI/2022-23/108, 12 Aug 2022 (para 2); carried into the Responsible Business Conduct Directions, 2025',
    url: 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12378',
    from: '2022-08-12',
  },
  recovery_2027: {
    id: 'recovery_2027',
    title: 'Stronger recovery rules from 1 January 2027',
    plain:
      'The bank must tell you the recovery agency\u2019s details at least a day before a first visit; agents must show an ID card and an authorisation letter; contact only between 08:00 and 19:00 unless you ask otherwise, and at a place of your choice; no calls or visits at a bereavement, medical emergency or wedding; a receipt for every payment; calls recorded; and every recovery letter must name the bank\u2019s grievance officer. The bank\u2019s policy must include a structured way of handling financial distress before escalating.',
    source:
      'RBI (Commercial Banks – Responsible Business Conduct) Fourth Amendment Directions, 2026, 6 Aug 2026, paras 454D, 454L–454AA (same rules issued for NBFCs, HFCs, co-operative, small finance and regional rural banks)',
    url: 'https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=13665&Mode=0',
    from: '2027-01-01',
  },
  settlement: {
    id: 'settlement',
    title: 'Settlement: what it costs you later',
    plain:
      'A settlement (paying less than you owe to close the loan) is the lender\u2019s choice under its own policy. After one, the same lender must wait at least 12 months before lending to you again, and the account is reported as settled rather than paid in full, which lowers your credit score. Try a pause, a longer tenure or a lower EMI first.',
    source: 'RBI, Framework for Compromise Settlements and Technical Write-offs, RBI/2023-24/40, 8 Jun 2023 (para 11)',
    url: 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12513&Mode=0',
    from: '2023-06-08',
  },
};

/** Which group a loan's payment falls in, most protected first. */
export type ProtectTier = 'secured' | 'card_minimum' | 'unsecured';

const TIER_OF: Record<LoanType, ProtectTier> = {
  home_loan: 'secured',
  auto_loan: 'secured',
  gold_loan: 'secured',
  credit_card: 'card_minimum',
  personal_loan: 'unsecured',
  education_loan: 'unsecured',
  bnpl: 'unsecured',
  loan_against_property: 'secured',
  home_topup: 'secured',
  two_wheeler_loan: 'secured',
  medical_loan: 'unsecured',
  people_loan: 'unsecured',
};
const TIER_RANK: Record<ProtectTier, number> = { secured: 0, card_minimum: 1, unsecured: 2 };
/** Inside the secured group: the home before the car before the gold. */
const SECURED_RANK: Partial<Record<LoanType, number>> = { home_loan: 0, home_topup: 0, loan_against_property: 0, auto_loan: 1, two_wheeler_loan: 1, gold_loan: 2 };

export const TIER_REASON: Record<ProtectTier, string> = {
  secured:
    'Secured: the lender can take the asset (your home, car or gold) if this goes unpaid. Protect it first.',
  card_minimum:
    'Pay at least the minimum due: more than 3 days late and the card is reported past due and a late fee is charged. Keep spending inside the limit.',
  unsecured:
    'Unsecured: no asset at risk. If something has to wait, it is safer here, but tell the lender before the due date.',
};

export interface TriageLoanIn {
  key: string;
  label: string;
  loan_type: LoanType;
  /** This month's required payment (EMI, or the card's minimum due), in the user's currency. */
  required: number;
  /** Annual rate, percent. */
  ratePct: number;
}

export interface TriageLine extends TriageLoanIn {
  tier: ProtectTier;
  reason: string;
  /** Whether it fits in the money available, taken in protect order. */
  covered: 'full' | 'part' | 'none';
  /** How much of `required` the available money covers. */
  pay: number;
  short: number;
}

/**
 * Orders this month's payments by what to protect first, then fills them
 * from `available` in that order. Secured (home, car, gold) first; then
 * card minimums; then other unsecured loans. Inside a tier, the larger
 * monthly interest cost (required × rate) goes first, the cheaper one is
 * the one to let wait. Ties keep the input order.
 */
export function protectOrder<T extends TriageLoanIn>(loans: T[], available: number): Array<T & TriageLine> {
  const ordered = loans
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.required > 0)
    .sort((a, b) => {
      const ta = TIER_OF[a.l.loan_type];
      const tb = TIER_OF[b.l.loan_type];
      if (TIER_RANK[ta] !== TIER_RANK[tb]) return TIER_RANK[ta] - TIER_RANK[tb];
      if (ta === 'secured') {
        const sa = SECURED_RANK[a.l.loan_type] ?? 9;
        const sb = SECURED_RANK[b.l.loan_type] ?? 9;
        if (sa !== sb) return sa - sb;
      }
      const ca = a.l.ratePct;
      const cb = b.l.ratePct;
      if (ca !== cb) return cb - ca;
      return a.i - b.i;
    });
  let left = Math.max(0, available);
  return ordered.map(({ l }) => {
    const pay = Math.min(left, l.required);
    left -= pay;
    const tier = TIER_OF[l.loan_type];
    return {
      ...l,
      tier,
      reason: TIER_REASON[tier],
      pay: round2(pay),
      short: round2(l.required - pay),
      covered: pay >= l.required ? 'full' : pay > 0 ? 'part' : 'none',
    };
  });
}

/** Months unpaid this page will count (UX50 R5-1: any number used to give a
 *  16-digit figure). Past 3 months the account is an NPA (over 90 days),
 *  and two years is already far past any sensible what-if. */
export const MAX_MONTHS_UNPAID = 24;

/** Read "Months unpaid": a whole number 0–MAX_MONTHS_UNPAID, else an error to show. */
export function readMonthsUnpaid(raw: string): { months: number | null; error: string | null } {
  const t = String(raw ?? '').trim();
  if (t === '') return { months: null, error: 'Enter how many months, 0 to ' + MAX_MONTHS_UNPAID + '.' };
  if (!/^\d+$/.test(t)) return { months: null, error: 'Use a whole number of months, 0 to ' + MAX_MONTHS_UNPAID + '.' };
  const n = Number(t);
  if (n > MAX_MONTHS_UNPAID) return { months: null, error: 'Up to ' + MAX_MONTHS_UNPAID + ' months. After 3 unpaid months the loan is already a default (NPA).' };
  return { months: n, error: null };
}

/** R6-4: the line under the cost block. At 0 months nothing has been missed,
 *  so there is no cost and nothing goes on the credit report. */
export const NOTHING_UNPAID_LINE = 'Nothing is unpaid yet: pay by the due date and there\u2019s no extra cost.';
export function missedCostClosing(months: number, totalText: string): string {
  if (months <= 0) return NOTHING_UNPAID_LINE;
  return `Adds about ${totalText}, plus ${months === 1 ? 'a missed payment' : 'missed payments'} on your credit report${months >= 3 ? '. After 90 days unpaid the loan is classed a default (NPA).' : '.'}`;
}

/** Read a lender charge typed by the user: blank is null (unknown), else a non-negative amount. */
export function readCharge(raw: string): { value: number | null; error: string | null } {
  const t = String(raw ?? '').trim().replace(/^(₹|rs\.?)\s*/i, '').replace(/[,\s]/g, '');
  if (t === '') return { value: null, error: null };
  if (!/^\d*\.?\d+$/.test(t)) return { value: null, error: 'Type the amount in rupees, like 590.' };
  const n = Number(t);
  if (n > 1_000_000) return { value: null, error: 'That is more than ₹10 lakh for one charge. Check the amount.' };
  return { value: n, error: null };
}

export interface MissCostIn {
  /** The amount not paid each month (the EMI, or the part of it not paid). */
  unpaid: number;
  /** The loan's own annual rate, percent. */
  ratePct: number;
  /** Months in a row it stays unpaid: one missed instalment per month. */
  months: number;
  /** The lender's penal charge per missed instalment, from the KFS; null if not known. */
  penalCharge: number | null;
  /** The bank's charge for a returned NACH / auto-debit, from its schedule of charges; null if not known. */
  bounceCharge: number | null;
  /** Whether the EMI is collected by auto-debit (NACH / ECS / standing instruction). */
  autoDebit: boolean;
}

export interface MissCost {
  /** Instalments missed in all (unpaid × months). */
  arrears: number;
  /** Interest on the overdue instalments at the loan's own rate (simple, month by month). */
  interest: number;
  penal: number;
  bounce: number;
  total: number;
  /** Which lender figures the user hasn't given (counted as 0). */
  unknown: Array<'penal' | 'bounce'>;
}

/**
 * What missing payments adds, by the RBI penal-charges rule: interest on the
 * overdue instalments at the contracted rate (never a penal rate), plus a
 * flat penal charge per missed instalment (no interest on it), plus a bounce
 * charge for each auto-debit that fails. Penal and bounce amounts are the
 * user's, from the KFS; unknown ones are 0 and named in `unknown`.
 *
 * Missing N months in a row means N instalments are overdue, not one (UX50
 * O-3). The first has been overdue N months by then, the last one month, so
 * the interest is unpaid × monthly rate × (N + N−1 + … + 1) = × N(N+1)/2.
 * One month is the same as before: one month's interest on one EMI.
 */
export function missedPaymentCost(i: MissCostIn): MissCost {
  const raw = Number.isFinite(i.months) ? Math.floor(i.months) : 0;
  const months = Math.min(MAX_MONTHS_UNPAID, Math.max(0, raw));
  const unpaid = Number.isFinite(i.unpaid) ? Math.max(0, i.unpaid) : 0;
  const monthly = Math.max(0, Number.isFinite(i.ratePct) ? i.ratePct : 0) / 100 / 12;
  const monthsOverdue = (months * (months + 1)) / 2;
  // No compounding, and no interest on penal charges (RBI 3(i)).
  const interest = unpaid * monthly * monthsOverdue;
  const unknown: MissCost['unknown'] = [];
  if (i.penalCharge == null) unknown.push('penal');
  if (i.autoDebit && i.bounceCharge == null) unknown.push('bounce');
  const penal = Math.max(0, i.penalCharge ?? 0) * months;
  const bounce = i.autoDebit ? Math.max(0, i.bounceCharge ?? 0) * months : 0;
  return {
    arrears: round2(unpaid * months),
    interest: round2(interest),
    penal: round2(penal),
    bounce: round2(bounce),
    total: round2(interest + penal + bounce),
    unknown,
  };
}

/** The SMA stage for a number of days overdue (RBI Prudential Framework, para 6). */
export function smaStage(daysOverdue: number): 'current' | 'SMA-0' | 'SMA-1' | 'SMA-2' | 'over 90 days' {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return 'SMA-0';
  if (daysOverdue <= 60) return 'SMA-1';
  if (daysOverdue <= 90) return 'SMA-2';
  return 'over 90 days';
}

export type HardshipAsk = 'pause' | 'lower_emi' | 'longer_tenure' | 'waive_penal' | 'restructure';

export const HARDSHIP_ASK_TEXT: Record<HardshipAsk, string> = {
  pause: 'a short pause (moratorium) of the EMI for the next one to three months, with the instalments added at the end',
  lower_emi: 'a lower EMI for the next few months',
  longer_tenure: 'a longer tenure so that the EMI comes down',
  waive_penal: 'a waiver of any penal charges for this period',
  restructure: 'a formal restructuring under your Board-approved policy (I understand this is reported to credit bureaus and can change how the loan is classified)',
};

export interface HardshipLetterIn {
  name: string;
  lender: string;
  loanLabel: string;
  accountRef: string;
  reason: string;
  /** What the user can pay a month for now. */
  canPay: string;
  asks: HardshipAsk[];
  floating: boolean;
  dateText: string;
  /** Whose rules the letter cites (A17/B12). Default 'IN'. A US letter cites no RBI rule. */
  country?: 'IN' | 'US';
}

/**
 * RBI Integrated Ombudsman: a complaint lies only after a written complaint
 * to the lender got no reply in 30 days or an unsatisfactory one. RB-IOS 2021
 * cl. 10(2)(a) (https://rbidocs.rbi.org.in/rdocs/content/pdfs/RBIOS2021_121121.pdf);
 * the same 30 days in RBI's FAQ on the scheme as revised in 2026
 * (https://www.rbi.org.in/commonman/English/Scripts/FAQs.aspx?Id=3407), both
 * read 14 Oct 2026. Named without a year so a revision doesn't date the letter.
 */
export const OMBUDSMAN_LINE =
  'If I do not get a reply within 30 days, I may take this to the RBI Ombudsman under the Reserve Bank \u2013 Integrated Ombudsman Scheme (cms.rbi.org.in).';

/**
 * US collectors: no contact before 8 a.m. or after 9 p.m. local time unless
 * the consumer agrees, and none at a time the consumer says is inconvenient.
 * 12 CFR 1006.6(b)(1)(i), Regulation F
 * (https://www.consumerfinance.gov/rules-policy/regulations/1006/6/, read 14 Oct 2026).
 */
export const US_COLLECTOR_RULE: TriageRule = {
  id: 'us_collector',
  title: 'Your rights with debt collectors (USA)',
  plain:
    'A debt collector must not contact you before 8 a.m. or after 9 p.m. your local time, or at any time or place you tell them is inconvenient, and must not discuss your debt with your family, employer or friends. You can tell a collector in writing to stop contacting you. These federal rules cover collection agencies; your own lender\u2019s calls are covered by state law and its own policies. Complaints go to the CFPB (consumerfinance.gov/complaint).',
  source: 'CFPB, Regulation F (12 CFR 1006.6), Fair Debt Collection Practices Act',
  url: 'https://www.consumerfinance.gov/rules-policy/regulations/1006/6/',
  from: '2021-11-30',
};

export const LETTER_SELF_CHECK = [
  'The loan account number and your name match the lender\u2019s records.',
  'The reason is true and short; attach proof if you have it (a termination letter, a hospital bill).',
  'The amount you say you can pay is one you can really keep paying.',
  'You keep a copy, and send it by email or through the lender\u2019s complaint / service channel so there is a dated record.',
  'You don\u2019t sign any new agreement until you have read the changed terms in writing.',
];

/** UX fix 12: the caution sits beside the letter, never in it: a copied or
 *  emailed letter would carry it to the bank. */
export const DRAFT_MARK = 'Check it before sending. Not legal advice; RightDue drafts it from what you typed.';

/** The letter as it goes out (copy, email, share, download): any leading
 *  draft line (an older draft, or one typed back in) taken off. */
export function forSending(letter: string): string {
  const lines = letter.split('\n');
  while (lines.length && (/^\s*DRAFT\b/i.test(lines[0]) || /CHECK BEFORE SENDING/i.test(lines[0]) || (lines[0].trim() === '' && lines.length > 1))) lines.shift();
  return lines.join('\n');
}

/** A plain hardship / restructuring request. Marked as a draft. */
export function hardshipLetter(i: HardshipLetterIn): string {
  if (i.country === 'US') return usHardshipLetter(i);
  const asks = i.asks.length ? i.asks : (['pause', 'longer_tenure'] as HardshipAsk[]);
  const lines = [
    i.dateText,
    '',
    `To: ${i.lender || '[lender]'}, loan servicing / grievance redressal officer`,
    `Subject: Request for hardship relief on my ${i.loanLabel}${i.accountRef ? `, account ${i.accountRef}` : ''}`,
    '',
    'Dear Sir / Madam,',
    '',
    `I am writing before my next due date because I am unable to pay the full instalment on this loan for now. The reason: ${i.reason || '[a short, true reason]'}.`,
    '',
    `I want to keep this loan in good standing. I can pay ${i.canPay || '[amount]'} a month for now. I request:`,
    ...asks.map((a, n) => `  ${n + 1}. ${HARDSHIP_ASK_TEXT[a]}`),
    '',
  ];
  if (i.floating) {
    lines.push(
      'As this is a floating-rate loan, I also note that at a rate reset RBI requires that I be given the choice of a higher EMI, a longer tenure or both (RBI, Reset of Floating Interest Rate on EMI based Personal Loans, 18 Aug 2023).',
      '',
    );
  }
  lines.push(
    'If any penal charge is levied in the meantime, please tell me the amount and the reason, as required by RBI\u2019s circular on Penal Charges in Loan Accounts (18 Aug 2023).',
    '',
    'Please acknowledge this request with a reference number, and reply in writing with the options available to me and their effect on my EMI, tenure and credit report. Until then, please contact me (and have any recovery agent contact me) only between 8 a.m. and 7 p.m., and not my family, referees or workplace, as RBI\u2019s rules on recovery agents require (RBI/2022-23/108, 12 Aug 2022).',
    '',
    OMBUDSMAN_LINE,
    '',
    'Yours faithfully,',
    i.name || '[your name]',
  );
  return lines.join('\n');
}

/** US asks, in US words (no EMI, no RBI). */
export const US_ASK_TEXT: Record<HardshipAsk, string> = {
  pause: 'a short forbearance or skip-a-payment for the next one to three months',
  lower_emi: 'a lower monthly payment for the next few months (a hardship program)',
  longer_tenure: 'a longer term so that the monthly payment comes down',
  waive_penal: 'a waiver of late fees for this period',
  restructure: 'a loan modification or workout plan (please tell me how it would be reported to the credit bureaus)',
};

/** A US hardship request: same structure, no Indian rules cited (B12). */
function usHardshipLetter(i: HardshipLetterIn): string {
  const asks = i.asks.length ? i.asks : (['pause', 'longer_tenure'] as HardshipAsk[]);
  return [
    i.dateText,
    '',
    `To: ${i.lender || '[lender]'}, hardship / customer assistance department`,
    `Re: Hardship assistance request, ${i.loanLabel}${i.accountRef ? `, account ${i.accountRef}` : ''}`,
    '',
    'To whom it may concern,',
    '',
    `I am writing before my next due date because I can\u2019t make the full payment on this account for now. The reason: ${i.reason || '[a short, true reason]'}.`,
    '',
    `I want to keep this account in good standing. I can pay ${i.canPay || '[amount]'} a month for now. I am asking for:`,
    ...asks.map((a, n) => `  ${n + 1}. ${US_ASK_TEXT[a]}`),
    '',
    'Please reply in writing with the options available, their cost, and how each would be reported to the credit bureaus. Please contact me by email or mail; phone calls before 8 a.m. or after 9 p.m. my local time are inconvenient for me.',
    '',
    'Sincerely,',
    i.name || '[your name]',
  ].join('\n');
}

/** A complaint about a recovery agent, to the lender's grievance officer (A17: the second letter Vijay asked about). */
export interface AgentComplaintIn {
  name: string;
  lender: string;
  loanLabel: string;
  accountRef: string;
  /** When it happened, as the user writes it ("12 Oct, 9:40 p.m."). */
  when: string;
  /** What the agent did, short and factual. */
  what: string;
  agent: string;
  dateText: string;
}

export function agentComplaintLetter(i: AgentComplaintIn): string {
  return [
    i.dateText,
    '',
    `To: The Grievance Redressal Officer, ${i.lender || '[lender]'}`,
    `Subject: Complaint about recovery agent conduct on my ${i.loanLabel}${i.accountRef ? `, account ${i.accountRef}` : ''}`,
    '',
    'Dear Sir / Madam,',
    '',
    `On ${i.when || '[date and time]'}, ${i.agent ? `${i.agent}, ` : ''}a person collecting on this loan for you ${i.what || '[what happened, in one or two factual sentences]'}.`,
    '',
    'RBI\u2019s rules on recovery agents (RBI/2022-23/108, 12 Aug 2022) say agents must not intimidate or harass borrowers, must not contact family, referees or friends, must not make threatening, anonymous or repeated calls, and must not call before 8 a.m. or after 7 p.m. The lender is responsible for its agents\u2019 conduct.',
    '',
    'I request that you: (1) stop this conduct, (2) give me the name and authorisation of the agency acting on this account, (3) contact me only in writing or between 8 a.m. and 7 p.m., and (4) acknowledge this complaint with a reference number and reply in writing.',
    '',
    OMBUDSMAN_LINE,
    '',
    'Yours faithfully,',
    i.name || '[your name]',
  ].join('\n');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
