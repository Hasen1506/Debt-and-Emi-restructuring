import { redirect } from 'next/navigation';

/** Its own tab title (UX50 C-26 / E-15). */
export const metadata = { title: 'Cash yield · RightDue' };

// Cash Yield is part of Spare cash now: one amount, one answer for the
// emergency-fund share, the loan, and where to park the cash.
export default function CashYieldPage() {
  redirect('/tools/windfall');
}
