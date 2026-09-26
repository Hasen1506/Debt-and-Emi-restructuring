import { redirect } from 'next/navigation';

// Cash Yield is part of Spare cash now: one amount, one answer for the
// emergency-fund share, the loan, and where to park the cash.
export default function CashYieldPage() {
  redirect('/tools/windfall');
}
