/**
 * Cash-vs-debt advisor — pure-function math for Phase 5 of the cash
 * module. Compares the user's idle cash against their loudest debt
 * and recommends a transfer when the math clearly favours it.
 *
 * Sacred floor (never recommend touching)
 *   • checking accounts: 1 month of expenses (operational float)
 *   • savings / HYSA: efund_target across the savings+HYSA pool
 *   • FD / other: assumed locked or opaque — never includes in `excess`
 *
 * Decision rule
 *   • loudest = highest-effective-APR active loan with outstanding > 0
 *   • avgPostTaxApy = balance-weighted APY across non-FD accounts × (1 − marginal_rate)
 *   • excess = max(0, eligibleCash − sacredFloor)
 *   • recommend when excess > minExcess AND loudest.effective > postTaxApy + spreadCutoff
 *
 * Pure functions only — no React, no DOM, no localStorage. The card
 * component takes the result and decides how to render.
 */

import Decimal from 'decimal.js';
import type { CashAccountKind, CashAccountPayload, UserPayload } from './api';
import { deriveMetrics, type LoanWithEffective } from './derived';

/** Default thresholds. Tunable per-locale later. */
const MIN_EXCESS_FOR_RECOMMEND_INR = 5_000;
const MIN_EXCESS_FOR_RECOMMEND_USD = 100;
const MIN_SPREAD_FOR_RECOMMEND = new Decimal('0.02'); // 2 percentage points

export interface CashAdvice {
  /** Loan we'd move money toward. */
  loudest: LoanWithEffective;
  /** Eligible cash above the sacred floor. */
  excess: Decimal;
  /** Balance-weighted post-tax APY of the non-FD pool. */
  postTaxApy: Decimal;
  /** Annual interest saved by moving `excess` from cash → debt. */
  annualSaving: Decimal;
  /** The spread driving the recommendation (debt − cash). */
  spread: Decimal;
  /** Total non-FD cash. */
  eligibleCash: Decimal;
  /** Sacred floor — checking-float + ef-target across savings/HYSA. */
  sacredFloor: Decimal;
}

const NON_FD_KINDS: CashAccountKind[] = ['checking', 'savings', 'hysa', 'other'];

export function computeCashAdvice(
  user: UserPayload,
  marginalRateStr: string,
): CashAdvice | null {
  const accounts = user.cash_accounts ?? [];
  if (accounts.length === 0) return null;

  const marginalRate = new Decimal(marginalRateStr || '0');
  // deriveMetrics wants the full StoredProfile; we hand it a minimal shim
  // with just the fields it actually touches (user + marginalRate).
  const metrics = deriveMetrics({
    user,
    marginalRate: marginalRateStr,
    creditScore: null,
    isLive: true,
  });
  if (!metrics.loudest) return null;
  const loudest = metrics.loudest;
  if (loudest.outstanding.lte(0)) return null;

  const monthlyExpenses = new Decimal(user.fixed_expenses || 0).add(
    new Decimal(user.variable_expenses || 0),
  );
  const checkingFloor = monthlyExpenses; // 1 month
  const efTarget = new Decimal(user.efund_target || 0);

  // Walk accounts, sum eligible cash + balance-weighted APY of the
  // optimisable subset.
  let eligibleCash = new Decimal(0);
  let weightedApySum = new Decimal(0);
  let savingsLikeBalance = new Decimal(0); // for the EF-target floor portion
  let hadCheckingFloor = false;

  for (const a of accounts) {
    if (!NON_FD_KINDS.includes(a.kind)) continue;
    const bal = new Decimal(a.balance || 0);
    eligibleCash = eligibleCash.add(bal);
    weightedApySum = weightedApySum.add(bal.mul(new Decimal(a.apy || 0)));
    if (a.kind === 'checking') hadCheckingFloor = true;
    if (a.kind === 'savings' || a.kind === 'hysa') {
      savingsLikeBalance = savingsLikeBalance.add(bal);
    }
  }
  if (eligibleCash.lte(0)) return null;

  const nominalApy = weightedApySum.div(eligibleCash);
  // Post-tax APY assumes user is at slab-rate on interest income — a
  // reasonable default for India (no general exemption) and the US
  // (federal ordinary income on bank interest).
  const postTaxApy = nominalApy.mul(new Decimal(1).sub(marginalRate));

  // Sacred floor: checking-float (only if there IS a checking account)
  // plus efund target (only the portion that can live in savings-like).
  // If user has no checking, we assume cash sits in savings — checking
  // floor still applies (one month expenses MUST stay liquid somewhere).
  const efFloorContribution = Decimal.min(efTarget, savingsLikeBalance);
  const sacredFloor = checkingFloor.add(efFloorContribution);
  void hadCheckingFloor; // currently informational; reserved for future routing rules

  const excess = Decimal.max(new Decimal(0), eligibleCash.sub(sacredFloor));

  const country = user.country;
  const minExcess = new Decimal(
    country === 'IN' ? MIN_EXCESS_FOR_RECOMMEND_INR : MIN_EXCESS_FOR_RECOMMEND_USD,
  );
  const spread = loudest.effective.sub(postTaxApy);

  if (excess.lt(minExcess) || spread.lt(MIN_SPREAD_FOR_RECOMMEND)) {
    return null;
  }

  // Don't recommend transferring more than the loan's outstanding —
  // anything beyond would be wasted (and the avalanche would naturally
  // cascade, but the user-facing "move $X" should match the obligation).
  // Cash is in the user's currency; so is the balance it's compared with.
  const transferAmount = Decimal.min(excess, metrics.toUserCcy(loudest.outstanding, loudest.loan));
  const annualSaving = transferAmount.mul(spread);

  return {
    loudest,
    excess: transferAmount,
    postTaxApy,
    annualSaving,
    spread,
    eligibleCash,
    sacredFloor,
  };
}

/** Helper for the card to pick the lowest-APY non-FD account — that's
 *  the natural source for the transfer. */
export function lowestApySource(
  accounts: CashAccountPayload[] | undefined,
): CashAccountPayload | null {
  if (!accounts || accounts.length === 0) return null;
  const eligible = accounts.filter((a) => NON_FD_KINDS.includes(a.kind));
  if (eligible.length === 0) return null;
  return eligible.reduce(
    (lo, a) => (Number(a.apy || 0) < Number(lo.apy || 0) ? a : lo),
    eligible[0],
  );
}
