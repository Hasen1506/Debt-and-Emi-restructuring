'use client';
/**
 * Owed-fix: under a loan's entered balance in Profile, the owed-now figure
 * Home, Plan and the tools show when payments logged this month have
 * brought it down (lib/owed-now-core). Nothing when the two agree.
 */
import type { Country, LoanPayload } from '@/lib/api';
import { formatCurrencyWhole } from '@/lib/api';
import { loanCurrency } from '@/lib/currency';
import { useOwedTodayProfile, useStoredProfile } from '@/lib/use-profile';

export function OwedNowHint({ loan, country }: { loan: LoanPayload; country: Country }) {
  const stored = useStoredProfile().user.loans;
  const owed = useOwedTodayProfile().user.loans;
  const i = loan.id ? stored.findIndex((l) => l.id === loan.id) : -1;
  const saved = i >= 0 ? stored[i] : null;
  const now = i >= 0 ? owed[i] : null;
  // Only for the balance as saved: an edit in progress isn't owed-now yet.
  if (!saved || !now || Number(saved.outstanding) !== Number(loan.outstanding)) return null;
  const was = Number(saved.outstanding) || 0;
  const is = Number(now.outstanding) || 0;
  if (Math.abs(was - is) < 1) return null;
  const ccy = loanCurrency(loan, country);
  return (
    <p data-testid="profile-owed-now" style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
      Owed now: {formatCurrencyWhole(Math.round(is), ccy)}, after this month&apos;s payments logged since this balance. Home,
      Plan and the tools use this figure; keep the balance above as entered until the next statement.
    </p>
  );
}
