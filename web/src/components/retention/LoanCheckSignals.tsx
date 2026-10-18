'use client';

/**
 * Under a Loan Check result (A15, A18): counts that a check finished and,
 * when the finding is worth ₹5,000 or more, counts that too and shows the
 * letter-pack fake door. Counts only; nothing about the loan is sent.
 */
import { useEffect } from 'react';
import type { LoanCheckResponse } from '@/lib/api';
import { FINDING_THRESHOLD_INR, track } from '@/lib/funnel';
import { FakeDoor } from './FakeDoor';

export function findingWorth(r: Pick<LoanCheckResponse, 'status' | 'claim_amount' | 'amount_at_stake_this_year'>): number {
  if (r.status !== 'issues_found') return 0;
  const a = Number(r.claim_amount) || 0;
  const b = Number(r.amount_at_stake_this_year) || 0;
  return Math.max(a, b);
}

export function LoanCheckSignals({ r }: { r: LoanCheckResponse }) {
  const big = findingWorth(r) >= FINDING_THRESHOLD_INR;
  useEffect(() => {
    track('loan_check_result', { country: 'IN' });
    if (big) track('loan_check_finding_5k', { country: 'IN' });
  }, [r, big]);
  return big ? <FakeDoor door="letter" /> : null;
}
