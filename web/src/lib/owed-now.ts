'use client';
/**
 * What's owed now, after the EMIs already paid this month. The plan's
 * balances are the start of the month, before this month's EMIs (it pays
 * them). Once Activity says an EMI has gone out, Home shows the balance
 * after it, and says, loan by loan, which of this month's EMIs are paid
 * and which are still to go.
 *
 * Cards aren't changed (their balance is the statement's, or the one
 * reported in Activity). A part-paid or missed EMI keeps the balance as
 * the plan has it: Activity already adds what's overdue.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import type { Country, LoanPayload } from './api';
import { readActivityClient, type ActivityEntry } from './activity';
import { refreshActivityCookieClient } from './activity-cookie';
import { alignToLoans } from './loan-ids';
import { emiStateThisMonth, owedNowLoans, paidThisMonth } from './owed-now-core';
import { getCountryToday, localIsoDate } from './today';

export type EmiStatus = 'paid' | 'part' | 'missed' | 'due' | 'first';

export interface OwedNow {
  /** This month's EMI, for EMI loans; null for cards and loans without one. */
  status: EmiStatus | null;
  owed: Decimal;
  /** UX50 B-12: a card paid this month (marked in Activity after its balance
   *  was entered): the entered balance, and `owed` is it less what was paid,
   *  "about", until the next statement is entered. */
  cardBefore?: Decimal;
}

/** Home's rows, from the one owed-now helper (lib/owed-now-core). */
export function owedNow(loans: LoanPayload[], entries: ActivityEntry[], month: string): OwedNow[] {
  const paid = paidThisMonth(loans, entries, month);
  const owedLoans = owedNowLoans(loans, paid);
  return loans.map((loan, i) => {
    const owed = new Decimal(Number(loan.outstanding) || 0);
    const now = new Decimal(Number(owedLoans[i].outstanding) || 0);
    const emi = Number(loan.scheduled_emi) || 0;
    if (loan.loan_type === 'credit_card' && owed.gt(0)) {
      // "WAS" is the entered balance: the plan's opening balance plus any part
      // of this month's payments Activity already took off it.
      const o = paid.off.find((x) => x.index === i);
      return o ? { status: null, owed: now, cardBefore: owed.add(Math.max(0, o.paid - o.amount)) } : { status: null, owed };
    }
    if (loan.loan_type === 'credit_card' || !(emi > 0) || !owed.gt(0)) return { status: null, owed };
    // Taken this month: nothing due until its first EMI.
    if (loan.first_emi_month && loan.first_emi_month > month) return { status: 'first', owed };
    const mine = entries.filter((e) => e.loanIndex === i && e.date.slice(0, 7) === month);
    const state = emiStateThisMonth(loan, mine);
    if (state === 'due' || state === 'missed' || state === 'part') return { status: state, owed };
    return { status: 'paid', owed: now };
  });
}

/** `owedNow` for these loans, from this browser's Activity. Before it's
 *  read (and on the server) every balance is the plan's and no status is
 *  known. */
export function useOwedNow(loans: LoanPayload[], country: Country): { rows: OwedNow[]; ready: boolean } {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const router = useRouter();
  useEffect(() => {
    const read = () => setEntries(readActivityClient());
    read();
    // First visit after the month turns: the plan's pace (lib/pace) moves
    // on to the months just gone, and the page is fetched again once it has
    // streamed in. Not cancelled with the effect: the cookie is already
    // rewritten, so a remount wouldn't ask again.
    if (refreshActivityCookieClient(loans, country)) window.setTimeout(() => router.refresh(), 1500);
    window.addEventListener('rightdue:profile-changed', read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener('rightdue:profile-changed', read);
      window.removeEventListener('storage', read);
    };
    // Once, on mount: the loans are the page's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (entries === null) {
    return { rows: loans.map((l) => ({ status: null, owed: new Decimal(Number(l.outstanding) || 0) })), ready: false };
  }
  const month = localIsoDate(getCountryToday(country)).slice(0, 7);
  return { rows: owedNow(loans, alignToLoans(entries, loans), month), ready: true };
}
