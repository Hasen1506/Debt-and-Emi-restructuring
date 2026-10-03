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
import { afterOneEmi } from './roll-forward';
import { getCountryToday, localIsoDate } from './today';

export type EmiStatus = 'paid' | 'part' | 'missed' | 'due' | 'first';

export interface OwedNow {
  /** This month's EMI, for EMI loans; null for cards and loans without one. */
  status: EmiStatus | null;
  owed: Decimal;
}

export function owedNow(loans: LoanPayload[], entries: ActivityEntry[], month: string): OwedNow[] {
  return loans.map((loan, i) => {
    const owed = new Decimal(Number(loan.outstanding) || 0);
    const emi = Number(loan.scheduled_emi) || 0;
    if (loan.loan_type === 'credit_card' || !(emi > 0) || !owed.gt(0)) return { status: null, owed };
    // Taken this month: nothing due until its first EMI.
    if (loan.first_emi_month && loan.first_emi_month > month) return { status: 'first', owed };
    const mine = entries.filter((e) => e.loanIndex === i && e.date.slice(0, 7) === month);
    if (mine.length === 0) return { status: 'due', owed };
    const paid = mine.reduce((s, e) => s + Number(e.amount || 0), 0);
    if (mine.some((e) => e.kind === 'missed') && paid === 0) return { status: 'missed', owed };
    if (mine.some((e) => e.kind === 'paid_partial' || e.kind === 'missed') && paid < emi) {
      return { status: 'part', owed };
    }
    // The plan's own extra marked paid comes off once the month is over
    // (lib/activity-cookie); any other extra is off the balance already.
    const planned = mine.reduce((s, e) => s + Number(e.plannedExtra || 0), 0);
    return { status: 'paid', owed: Decimal.max(0, afterOneEmi(loan).sub(planned)) };
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
    window.addEventListener('finoptima:profile-changed', read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener('finoptima:profile-changed', read);
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
