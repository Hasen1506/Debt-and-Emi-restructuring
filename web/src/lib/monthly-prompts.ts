/**
 * Monthly prompts (grill #9: "persistent state + monthly prompts"): the
 * few things worth doing once a month, worked out from what the app
 * already holds. At most three at a time; each can be put off until next
 * month ("Hide until next month" hides it on this device; A12: it is not a
 * reminder). Nothing here is sent anywhere.
 */
import type { PendingUpi } from './upi-confirm';
import { MONTH_NAMES } from './today';

export type PromptKey = 'log_last_month' | 'upi_check' | 'regime_check' | 'ask_assistant' | 'debt_free_moved';

export interface Prompt {
  key: PromptKey;
  text: string;
  href?: string;
  action?: 'copy_plan' | 'check_advice' | 'upi_check';
}

export interface PromptInput {
  today: Date;
  country: 'IN' | 'US';
  /** Loans with a payment due each month (EMI or card minimum). */
  loansWithPayments: number;
  /** Activity entry dates ("YYYY-MM-DD"). */
  activityDates: string[];
  pendingUpi: PendingUpi[];
  /** Keys put off this month: "2026-10|regime_check". */
  snoozed: string[];
  /** True once the debt-free date has moved since the last visit. */
  debtFreeMoved?: boolean;
  /** "YYYY-MM" of the earliest balance on file (UX walkthrough fix 13): a
   *  plan started this month has no last month to log. */
  firstBalanceYm?: string | null;
}

export const PROMPTS_SNOOZE_KEY = 'rightdue_prompts_snoozed';

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export function lastMonthYm(today: Date): string {
  return ym(new Date(today.getFullYear(), today.getMonth() - 1, 1));
}

export function monthlyPrompts(i: PromptInput): Prompt[] {
  const thisYm = ym(i.today);
  const snoozed = new Set(i.snoozed.filter((s) => s.startsWith(`${thisYm}|`)).map((s) => s.slice(8)));
  const out: Prompt[] = [];
  const add = (p: Prompt) => { if (!snoozed.has(p.key)) out.push(p); };

  if (i.pendingUpi.length > 0) {
    const p = i.pendingUpi[0];
    add({
      key: 'upi_check',
      action: 'upi_check',
      text: `Did the UPI payment to ${p.name} go through? Check your UPI app’s history or the bank SMS, then mark it below.`,
    });
  }
  // Early in the month: last month's payments, if none were logged.
  const last = lastMonthYm(i.today);
  // Not in the plan's first month: there is no "last month" yet (fix 13).
  const newPlan = !!i.firstBalanceYm && i.firstBalanceYm >= thisYm;
  if (!newPlan && i.today.getDate() <= 10 && i.loansWithPayments > 0 && !i.activityDates.some((d) => d.startsWith(last))) {
    const lastName = MONTH_NAMES[(i.today.getMonth() + 11) % 12];
    add({ key: 'log_last_month', text: `Did ${lastName}’s payments go out as planned? Tick them in Activity so this month starts from the right balances.`, href: '/activity#activity-ledger' });
  }
  if (i.debtFreeMoved) {
    add({ key: 'debt_free_moved', text: 'Your debt-free date moved since your last visit. See why on Plan.', href: '/plan' });
  }
  // India's financial year ends 31 March: the regime for next year is
  // chosen when filing (salaried) or by the return's due date (business).
  const m = i.today.getMonth();
  if (i.country === 'IN' && (m === 0 || m === 1 || m === 2)) {
    add({ key: 'regime_check', text: 'Before 31 March: compare the old and new tax regimes with your loans for next year.', href: '/profile#pf-tax' });
  }
  // A8: RightDue is the checker, not the exit door. Copy my plan stays (with a
  // link back); the paste box checks the answer against your loans and RBI rules.
  // UX walkthrough fix 5: RBI and a bank RM are India's.
  add({
    key: 'ask_assistant',
    action: 'check_advice',
    text: i.country === 'US'
      ? 'Got advice from an assistant or a lender? Paste it and we’ll check it against your loans.'
      : 'Got advice from an assistant or a bank RM? Paste it and we’ll check it against your loans and RBI rules.',
  });
  return out.slice(0, 3);
}

export function snooze(list: string[], key: PromptKey, today: Date): string[] {
  const k = `${ym(today)}|${key}`;
  return [...list.filter((s) => s.startsWith(ym(today))), ...(list.includes(k) ? [] : [k])];
}
