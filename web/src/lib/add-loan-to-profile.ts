/**
 * Helper for tools whose recommendation is "take this loan" — writes the
 * loan straight into the user's local profile cookie so the next /plan
 * render picks it up. Mirrors `applyToolResult`: one-click, no setup
 * navigation needed.
 *
 * Callers stay responsible for any other state (activity entries, cookies
 * for projection deltas) — this only touches the profile.
 */
import { loadProfileClient, saveProfileClient } from './user-store';
import type { LoanPayload, LoanType } from './api';

export interface AddLoanInput {
  loan_type: LoanType;
  bank: string;
  outstanding: string;
  nominal_rate: string;
  tenure_months_remaining: number;
  scheduled_emi: string;
  rate_type?: 'floating' | 'fixed';
  processing_fee_amortised?: string;
}

/** Adds the loan to the user's profile cookie. Returns the new loan count. */
export function addLoanToProfile(input: AddLoanInput): number {
  const profile = loadProfileClient();
  const newLoan: LoanPayload = {
    loan_type: input.loan_type,
    bank: input.bank,
    outstanding: input.outstanding,
    nominal_rate: input.nominal_rate,
    rate_type: input.rate_type ?? 'fixed',
    tenure_months_remaining: input.tenure_months_remaining,
    scheduled_emi: input.scheduled_emi,
    ...(input.processing_fee_amortised
      ? { processing_fee_amortised: input.processing_fee_amortised }
      : {}),
  };
  const nextUser = {
    ...profile.user,
    loans: [...profile.user.loans, newLoan],
  };
  saveProfileClient({
    user: nextUser,
    marginalRate: profile.marginalRate,
    creditScore: profile.creditScore,
  });
  return nextUser.loans.length;
}
