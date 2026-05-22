'use client';

/**
 * Today card — the answer to "I just opened the app, what do I need to
 * know right now?". Replaces the user's mental model of "scroll across
 * 4 cash cards and stitch the picture together" with one strip:
 *
 *   You have       — total liquid balance
 *   Due soon       — total EMI burden + earliest scheduled date
 *   Free cash      — balance minus EF reserve minus EMIs not yet paid
 *
 * D-pilot conversion: this component is the proof-of-concept for the
 * theme-token system. One render path covers all three themes via
 * `@/components/themed/Themed`. Visual differences (font, radius,
 * border treatment, label letter-spacing) are encoded in
 * `@/styles/theme-tokens` — no per-variant duplicated JSX.
 */

import Decimal from 'decimal.js';
import type { LoanPayload, UserPayload } from '@/lib/api';
import { formatCurrency } from '@/lib/api';
import { userDefaultCurrency } from '@/lib/currency';
import {
  ThemedContainer,
  ThemedKpi,
  ThemedKpiGrid,
  ThemedLabel,
} from '@/components/themed/Themed';
import type { ThemeName } from '@/lib/theme';

function todayLabel(country: 'IN' | 'US'): string {
  const d = new Date();
  return d.toLocaleDateString(country === 'IN' ? 'en-IN' : 'en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function nextEmiDueLabel(loans: LoanPayload[]): string | null {
  // We don't store a per-loan due-day yet, so the best we can do is "this
  // month" — which is still more concrete than no date. When per-loan due
  // dates land in the data model, this becomes "by the 28th" etc.
  const open = loans.filter((l) => Number(l.outstanding || 0) > 0);
  if (open.length === 0) return null;
  return new Date().toLocaleDateString('en-US', { month: 'short' });
}

export function TodayCard({
  user,
  variant,
}: {
  user: UserPayload;
  variant: ThemeName;
}) {
  const accounts = user.cash_accounts ?? [];
  const loans = user.loans ?? [];
  const currency = userDefaultCurrency(user.country);

  // Total balance across every cash account (checking + savings + HYSA + FD).
  // FD is included because it's still your money — the user just can't deploy
  // it without breaking. The Free cash row subtracts FD-locked balances
  // separately so users know the deployable portion.
  const totalBalance = accounts.reduce(
    (s, a) => s.add(new Decimal(a.balance || 0)),
    new Decimal(0),
  );
  const lockedFd = accounts
    .filter((a) => a.kind === 'fd')
    .reduce((s, a) => s.add(new Decimal(a.balance || 0)), new Decimal(0));

  const totalScheduledEmi = loans
    .filter((l) => Number(l.outstanding || 0) > 0)
    .reduce((s, l) => s.add(new Decimal(l.scheduled_emi || 0)), new Decimal(0));

  const efReserve = new Decimal(user.efund_target || user.efund_balance || 0);

  // Free cash = total liquid (ex-FD) minus EF reserve minus full month of EMIs.
  // Floor at zero — a negative "free cash" is signalled via the muted note.
  const freeCash = Decimal.max(
    0,
    totalBalance.sub(lockedFd).sub(efReserve).sub(totalScheduledEmi),
  );
  const tight = totalBalance
    .sub(lockedFd)
    .sub(efReserve)
    .sub(totalScheduledEmi)
    .lt(0);

  // Nothing useful to show if the user hasn't entered balances yet.
  if (accounts.length === 0 && totalScheduledEmi.eq(0)) return null;

  const dueLabel = nextEmiDueLabel(loans);
  const ccyFmt = (v: Decimal) => formatCurrency(v.toString(), currency);
  const accountsLabel = `${accounts.length} account${accounts.length === 1 ? '' : 's'}${lockedFd.gt(0) ? ` · ${ccyFmt(lockedFd)} in FD` : ''}`;
  const date = todayLabel(user.country);
  const upper = variant === 'ledger';

  return (
    <ThemedContainer variant={variant} style={{ marginBottom: 18 }}>
      <ThemedLabel variant={variant}>
        {upper ? `TODAY · ${date.toUpperCase()}` : `Today · ${date}`}
      </ThemedLabel>
      <ThemedKpiGrid>
        <ThemedKpi
          variant={variant}
          label={upper ? 'YOU HAVE' : 'You have'}
          value={ccyFmt(totalBalance)}
          detail={accountsLabel}
        />
        <ThemedKpi
          variant={variant}
          label={upper ? 'DUE SOON' : 'Due soon'}
          value={totalScheduledEmi.gt(0) ? `${ccyFmt(totalScheduledEmi)}/mo` : '—'}
          detail={
            dueLabel
              ? upper
                ? `EMIS THIS MONTH (${dueLabel.toUpperCase()})`
                : `EMIs this month (${dueLabel})`
              : upper
                ? 'NO ACTIVE EMIS'
                : 'no active EMIs'
          }
          valueColor={
            totalScheduledEmi.gt(0) ? 'var(--negative)' : 'var(--muted)'
          }
        />
        <ThemedKpi
          variant={variant}
          label={upper ? 'FREE CASH' : 'Free cash'}
          value={ccyFmt(freeCash)}
          detail={
            tight
              ? upper
                ? 'TIGHT — EF + EMIS EXCEED BALANCE'
                : 'Tight — EF + EMIs exceed balance'
              : upper
                ? 'AFTER EF RESERVE + THIS MONTH’S EMIS'
                : "After EF reserve + this month's EMIs"
          }
          valueColor={tight ? 'var(--negative)' : 'var(--positive)'}
        />
      </ThemedKpiGrid>
    </ThemedContainer>
  );
}
