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
 * Rendered above everything else on /debts. CashAdvisor, TaxSleeve,
 * MonthlyRecap, CashSummary remain below — but the day-1 question is
 * answered by this card alone.
 *
 * The "Free cash" number is conservative on purpose: it subtracts the
 * full EF target (not just the gap), so a user who's already at target
 * doesn't get told to spend more, and a user under target sees the
 * shortfall implicitly. Anything labeled "free" should be money the
 * user can actually deploy without making a tradeoff.
 */

import Decimal from 'decimal.js';
import Link from 'next/link';
import type { LoanPayload, UserPayload } from '@/lib/api';
import { formatCurrency } from '@/lib/api';
import { userDefaultCurrency } from '@/lib/currency';

type Variant = 'ledger' | 'editorial' | 'existing';

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
  variant: Variant;
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

  const ccyFmt = (v: Decimal | string | number) =>
    formatCurrency(typeof v === 'object' ? v.toString() : String(v), currency);

  const date = todayLabel(user.country);

  if (variant === 'ledger') {
    return (
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          lineHeight: 1.6,
          border: '1px solid var(--ink)',
          padding: '12px 14px',
          marginBottom: 18,
          background: 'var(--card)',
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}
        >
          $ TODAY · {date.toUpperCase()}
        </div>
        <TodayRows
          rows={[
            {
              label: 'YOU HAVE',
              value: ccyFmt(totalBalance),
              detail: `${accounts.length} account${accounts.length === 1 ? '' : 's'}${lockedFd.gt(0) ? ` · ${ccyFmt(lockedFd)} in FD` : ''}`,
              color: 'var(--ink)',
            },
            {
              label: 'DUE SOON',
              value: totalScheduledEmi.gt(0)
                ? `${ccyFmt(totalScheduledEmi)}/MO`
                : '—',
              detail: dueLabel
                ? `EMIS THIS MONTH (${dueLabel.toUpperCase()})`
                : 'NO ACTIVE EMIS',
              color: totalScheduledEmi.gt(0) ? 'var(--negative)' : 'var(--muted)',
            },
            {
              label: 'FREE CASH',
              value: ccyFmt(freeCash),
              detail: tight
                ? 'TIGHT — EF + EMIS EXCEED BALANCE'
                : 'AFTER EF RESERVE + THIS MONTH’S EMIS',
              color: tight ? 'var(--negative)' : 'var(--positive)',
            },
          ]}
          mono
        />
      </div>
    );
  }

  if (variant === 'editorial') {
    return (
      <div
        style={{
          margin: '14px 0 22px',
          paddingLeft: 14,
          borderLeft: '3px solid var(--accent)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 11,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--accent)',
            marginBottom: 6,
          }}
        >
          Today · {date}
        </div>
        <TodayRows
          rows={[
            {
              label: 'You have',
              value: ccyFmt(totalBalance),
              detail: `${accounts.length} account${accounts.length === 1 ? '' : 's'}${lockedFd.gt(0) ? `, ${ccyFmt(lockedFd)} in FD` : ''}`,
            },
            {
              label: 'Due soon',
              value: totalScheduledEmi.gt(0) ? `${ccyFmt(totalScheduledEmi)}/mo` : '—',
              detail: dueLabel ? `EMIs this month (${dueLabel})` : 'no active EMIs',
            },
            {
              label: 'Free cash',
              value: ccyFmt(freeCash),
              detail: tight
                ? 'Tight — EF + EMIs exceed balance'
                : "After EF reserve + this month's EMIs",
            },
          ]}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 14,
        marginBottom: 16,
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--muted)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 8,
        }}
      >
        Today · {date}
      </div>
      <TodayRows
        rows={[
          {
            label: 'You have',
            value: ccyFmt(totalBalance),
            detail: `${accounts.length} account${accounts.length === 1 ? '' : 's'}${lockedFd.gt(0) ? `, ${ccyFmt(lockedFd)} in FD` : ''}`,
          },
          {
            label: 'Due soon',
            value: totalScheduledEmi.gt(0) ? `${ccyFmt(totalScheduledEmi)}/mo` : '—',
            detail: dueLabel ? `EMIs this month (${dueLabel})` : 'no active EMIs',
          },
          {
            label: 'Free cash',
            value: ccyFmt(freeCash),
            detail: tight
              ? 'Tight — EF + EMIs exceed balance'
              : "After EF reserve + this month's EMIs",
          },
        ]}
      />
      <div style={{ marginTop: 10, fontSize: 12 }}>
        <Link
          href="/plan"
          style={{ color: 'var(--accent)', textDecoration: 'none' }}
        >
          See full plan →
        </Link>
      </div>
    </div>
  );
}

function TodayRows({
  rows,
  mono = false,
}: {
  rows: Array<{ label: string; value: string; detail: string; color?: string }>;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 12,
        fontFamily: mono ? 'inherit' : undefined,
      }}
    >
      {rows.map((r) => (
        <div key={r.label}>
          <div
            style={{
              fontSize: 10,
              color: 'var(--muted)',
              letterSpacing: mono ? '0.12em' : '0.04em',
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            {r.label}
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: r.color ?? 'var(--ink)',
            }}
          >
            {r.value}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {r.detail}
          </div>
        </div>
      ))}
    </div>
  );
}
