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
import type { Country, LoanPayload, LoanType } from './api';
import { userDefaultCurrency, type CurrencyCode } from './currency';

export interface AddLoanInput {
  loan_type: LoanType;
  bank: string;
  outstanding: string;
  nominal_rate: string;
  tenure_months_remaining: number;
  scheduled_emi: string;
  rate_type?: 'floating' | 'fixed';
  processing_fee_amortised?: string;
  /** Currency the amounts above are in. Omit for the profile's own. */
  currency?: string;
  /** For a foreign loan: profile-currency units per 1 loan-currency unit
   *  (₹ loan, $ profile: ~0.0104). Used only when the profile has no rate
   *  saved for that currency; a saved rate is what every page uses. */
  fx_to_user?: string;
}

/** Why a loan can't be added as it stands, or null when it can. A profile
 *  holds loans in INR and USD only, and a foreign one needs a rate: without
 *  one, ₹20 lakh would be read as $20 lakh. */
export function addLoanBlocker(
  input: Pick<AddLoanInput, 'currency' | 'fx_to_user'>,
  user: { country: Country; fx_to_user_currency?: Record<string, string> },
): string | null {
  const own = userDefaultCurrency(user.country);
  const ccy = input.currency ?? own;
  if (ccy === own) return null;
  if (ccy !== 'INR' && ccy !== 'USD') {
    return `Your profile holds loans in INR and USD only, so a ${ccy} loan can't be tracked there yet.`;
  }
  const saved = user.fx_to_user_currency?.[ccy];
  if (saved && Number(saved) > 0) return null;
  if (input.fx_to_user && Number(input.fx_to_user) > 0) return null;
  return `Enter the ${ccy}–${own} exchange rate first, so the loan isn't read as ${own}.`;
}

/** Adds the loan to the user's profile cookie. Returns the new loan count,
 *  or null when the loan can't be represented (see `addLoanBlocker`) or the
 *  profile didn't save. */
export function addLoanToProfile(input: AddLoanInput): number | null {
  const profile = loadProfileClient();
  if (addLoanBlocker(input, profile.user)) return null;
  const own = userDefaultCurrency(profile.user.country);
  const foreign = input.currency && input.currency !== own ? (input.currency as CurrencyCode) : null;
  const newLoan: LoanPayload = {
    loan_type: input.loan_type,
    bank: input.bank,
    outstanding: input.outstanding,
    nominal_rate: input.nominal_rate,
    rate_type: input.rate_type ?? 'fixed',
    tenure_months_remaining: input.tenure_months_remaining,
    scheduled_emi: input.scheduled_emi,
    ...(foreign ? { currency: foreign } : {}),
    ...(input.processing_fee_amortised
      ? { processing_fee_amortised: input.processing_fee_amortised }
      : {}),
  };
  const fx = { ...(profile.user.fx_to_user_currency ?? {}) };
  if (foreign && !(Number(fx[foreign]) > 0)) fx[foreign] = input.fx_to_user!;
  const nextUser = {
    ...profile.user,
    loans: [...profile.user.loans, newLoan],
    ...(foreign ? { fx_to_user_currency: fx } : {}),
  };
  const ok = saveProfileClient({
    user: nextUser,
    marginalRate: profile.marginalRate,
    creditScore: profile.creditScore,
  });
  return ok ? nextUser.loans.length : null;
}
