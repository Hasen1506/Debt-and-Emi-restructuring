/**
 * What the plan takes as given (AUDIT §10 M3): the numbers it runs on that
 * nobody chose on Plan's chips. Each says whether the user said it or the
 * app assumed it, flags one worth checking, and names where to change it.
 *
 * The chips above hold the choices (payoff order, total to debts, pay
 * rises, rising costs); this list holds the data and the guesses.
 */
import type { Country, LoanPayload, PlanRunArgs, UserPayload } from './api';
import { formatCurrencyWhole } from './api';
import { loanCurrency } from './currency';
import { LOAN_TYPE_NAME } from './loan-types';
import { explainMinPayment } from './min-payment';
import { likelyRateType } from './rate-type';
import { MONTH_NAMES, MONTH_NAMES_SHORT } from './today';

export type GivenSource = 'YOU SAID' | 'ASSUMED' | 'CHECK';

export interface Given {
  key: string;
  label: string;
  /** One line per loan (or one line). */
  lines: string[];
  source: GivenSource;
  fix?: { href: string; text: string };
}

const loanName = (l: LoanPayload) => {
  const kind = LOAN_TYPE_NAME[l.loan_type];
  return l.bank ? `${l.bank} ${kind}` : kind.charAt(0).toUpperCase() + kind.slice(1);
};

function dayLabel(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTH_NAMES_SHORT[m - 1]} ${y}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86_400_000);
}

/** Worst of the sources: a CHECK anywhere makes the row one to check. */
function worst(sources: GivenSource[]): GivenSource {
  return sources.includes('CHECK') ? 'CHECK' : sources.includes('ASSUMED') ? 'ASSUMED' : 'YOU SAID';
}

export function planGivens(
  user: UserPayload,
  opts: { today: string; inflation: { on: boolean; rate: number }; hike: { on: boolean; rate: number; month: number }; runArgs?: PlanRunArgs | null },
): Given[] {
  const country: Country = user.country;
  const loans = (user.loans ?? []).filter((l) => Number(l.outstanding) > 0);
  const money = (v: string | number, l?: LoanPayload) =>
    formatCurrencyWhole(String(v), l ? loanCurrency(l, country) : country === 'IN' ? 'INR' : 'USD');
  const out: Given[] = [];
  const thisMonth = MONTH_NAMES[Number(opts.today.slice(5, 7)) - 1];

  // ── Balances: when each was entered, and which side of its EMI ──
  if (loans.length > 0) {
    const src: GivenSource[] = [];
    const lines = loans.map((l) => {
      const card = l.loan_type === 'credit_card';
      if (!l.balance_as_of) {
        src.push('CHECK');
        return `${loanName(l)}: ${money(l.outstanding, l)}, date not recorded`;
      }
      const age = daysBetween(l.balance_as_of, opts.today);
      // A card's balance doesn't move on by itself, so an old one is stale;
      // a loan's moves on by its EMIs but misses anything unlogged.
      const stale = age > (card ? 45 : 120);
      src.push(stale ? 'CHECK' : 'YOU SAID');
      const side =
        card || l.balance_after_emi === undefined
          ? ''
          : l.balance_after_emi
            ? `, after that month's EMI`
            : `, before that month's EMI`;
      return `${loanName(l)}: ${money(l.outstanding, l)} on ${dayLabel(l.balance_as_of)}${side}${stale ? ` (${Math.round(age / 30)} months ago: check a statement)` : ''}`;
    });
    out.push({
      key: 'balances',
      label: 'Balances',
      lines: [...lines, 'Loans move on by their EMIs since; a missed or extra payment counts once logged in Activity.'],
      source: worst(src),
      fix: { href: '/profile?step=loans', text: 'UPDATE A BALANCE' },
    });
  }

  // ── Fixed or floating ──
  const emiLoans = loans.filter((l) => l.loan_type !== 'credit_card');
  if (emiLoans.length > 0) {
    const src: GivenSource[] = [];
    const lines = emiLoans.map((l) => {
      const usual = likelyRateType(l.loan_type, country, l.currency);
      if (l.rate_type_assumed === true) {
        src.push('ASSUMED');
        return `${loanName(l)}: ${l.rate_type}, the usual for this kind of loan (you weren't sure)`;
      }
      if (l.rate_type_assumed === undefined && l.rate_type !== usual) {
        src.push('CHECK');
        return `${loanName(l)}: ${l.rate_type}, the old starting choice; loans like this are usually ${usual}`;
      }
      src.push('YOU SAID');
      return `${loanName(l)}: ${l.rate_type}`;
    });
    out.push({
      key: 'rate-type',
      label: 'Fixed or floating',
      lines: [
        ...lines,
        country === 'US'
          ? 'Page 1 of your Closing Disclosure or loan agreement says which.'
          : 'The line "Rate of interest and type" on your KFS says which.',
      ],
      source: worst(src),
      fix: { href: '/profile?step=loans', text: 'SET IT IN PROFILE' },
    });
  }

  // ── Interest rates over time ──
  if (loans.length > 0) {
    const modeledLoans = opts.runArgs?.user.loans ?? loans;
    const drifts = modeledLoans.filter(l => l.rate_type === 'floating' && Number(l.rate_drift_annualized));
    const resets = opts.runArgs?.lifecycle_events?.filter(e => e.kind === 'floating_rate_reset') ?? [];
    const modeled = drifts.length > 0 || resets.length > 0;
    out.push({
      key: 'rates', label: 'Interest rates',
      lines: [
        modeled ? 'The plan includes your saved rate changes; other rate moves are not guessed.' : "Every loan keeps today's rate to the end.",
        ...emiLoans.filter(l => l.rate_type === 'floating').map(l => `${loanName(l)} is floating: its benchmark can change, but the plan only applies saved rate changes.`),
        ...drifts.map(l => `${loanName(l)}: rate changes by ${(Number(l.rate_drift_annualized) * 100).toFixed(2)} percentage points a year, at its reset dates.`),
        ...resets.map(e => `${modeledLoans[e.loan_index ?? -1] ? loanName(modeledLoans[e.loan_index!]) : 'Loan'}: rate set to ${(Number(e.new_rate) * 100).toFixed(2)}% in plan month ${e.effective_month}.`),
        ...(emiLoans.some(l => l.rate_type === 'floating') ? [] : ["Fixed loans keep their rate; a card's rate can still change."]),
      ],
      source: modeled ? 'YOU SAID' : 'ASSUMED',
      fix: { href: '#rate-decisions', text: 'SEE WHAT THE NEXT DECISION DOES' },
    });
  }

  // ── Cards: new spending and the minimum ──
  const cards = loans.filter((l) => l.loan_type === 'credit_card');
  if (cards.length > 0) {
    const src: GivenSource[] = [];
    const lines = cards.flatMap((l) => {
      const spend = Number(l.expected_monthly_spend || 0);
      src.push(spend > 0 ? 'YOU SAID' : 'ASSUMED');
      const min = explainMinPayment(l, country);
      const own = Number(l.min_payment_override || 0) > 0;
      src.push(own ? 'YOU SAID' : 'ASSUMED');
      return [
        spend > 0
          ? `${loanName(l)}: ${money(spend, l)} of new spending a month, not cleared`
          : `${loanName(l)}: nothing new goes on it until it's cleared`,
        own
          ? `${loanName(l)}: minimum ${money(l.min_payment_override!, l)}, from your statement`
          : `${loanName(l)}: minimum by the usual rule (${min?.formula ?? 'bank rule'})`,
      ];
    });
    out.push({
      key: 'cards',
      label: 'Cards',
      lines,
      source: worst(src),
      fix: { href: '/profile?step=loans', text: 'SET THEM IN PROFILE' },
    });
  }

  // ── Spending and income ──
  const spend = Number(user.fixed_expenses || 0) + Number(user.variable_expenses || 0);
  out.push({
    key: 'spending',
    label: 'Spending',
    lines: [
      `${money(spend)} a month${opts.inflation.on ? `, rising ${(opts.inflation.rate * 100).toFixed(1)}% a year` : ', the same every month'}.`,
      'Real months vary. What moves the date is what reaches your debts: log what you pay, and "What you\'ve paid" under the date sets your last three months beside the plan.',
    ],
    source: 'YOU SAID',
    fix: { href: '/profile?step=income', text: 'CHANGE IT' },
  });
  const hikeMonth = MONTH_NAMES[Math.max(0, Math.min(11, opts.hike.month - 1))];
  const phases = opts.hike.on ? (opts.runArgs?.user.hike_schedule ?? user.hike_schedule ?? []) : [];
  const salaries = opts.runArgs?.lifecycle_events?.filter(e => e.kind === 'salary_reset') ?? [];
  out.push({
    key: 'income',
    label: 'Take-home',
    lines: [
      `${money(user.monthly_income)} a month${opts.hike.on && opts.hike.rate > 0 ? `, rising ${(opts.hike.rate * 100).toFixed(0)}% each ${hikeMonth}` : phases.length || salaries.length ? '' : ', with no pay rise'}.`,
      ...phases.map(([start, end, rate]) => `Saved pay-rise phase: ${(Number(rate) * 100).toFixed(1)}% a year in years ${start}–${end}.`),
      ...salaries.map(e => `Saved salary change in plan month ${e.effective_month}${e.new_monthly_take_home ? `: ${money(e.new_monthly_take_home)} take-home a month` : ''}.`),
    ],
    source: 'YOU SAID',
    fix: { href: '/profile?step=income', text: 'CHANGE IT' },
  });

  // ── Nothing else happens ──
  out.push({
    key: 'events',
    label: 'Life events',
    lines: [(opts.runArgs?.lifecycle_events?.length || opts.runArgs?.reinvest_events?.length) ? 'Your saved life events are included. No other new loans, big costs or windfalls are assumed.' : `No new loans, big costs or windfalls after ${thisMonth}, unless added as life events.`],
    source: 'ASSUMED',
    fix: { href: '#life-events', text: 'ADD AN EVENT' },
  });

  return out;
}
