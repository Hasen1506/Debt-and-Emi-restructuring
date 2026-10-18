'use client';

/**
 * Tax sleeve card — reminder + calculator for users with non-TDS
 * income. Phase 4 of the cash module.
 *
 * Render conditions
 *   • income_type === 'business_owner', OR
 *   • income_type === 'salaried' AND user.extra_income_annual_tax > 0
 *   Otherwise renders nothing.
 *
 * Pure calculator + reminder — does NOT move money.
 *
 * D-pilot: themed primitives. Tone goes 'negative' when within 14 days
 * of the deadline or overdue.
 */

import { useEffect, useMemo, useState } from 'react';
import type { UserPayload } from '@/lib/api';
import { formatCurrency } from '@/lib/api';
import { userDefaultCurrency } from '@/lib/currency';
import {
  cycleKey,
  daysUntil,
  installmentSchedule,
  markInstallmentPaid,
  nextInstallment,
  readTaxSleeveClient,
  sleeveAnnualTarget,
  unmarkInstallmentPaid,
  type InstallmentInfo,
  type TaxSleeveSlice,
} from '@/lib/tax-sleeve';
import { InfoTip } from '@/components/ToolPrimitives';
import {
  ThemedContainer,
  ThemedDetail,
  ThemedHeadline,
  ThemedLabel,
} from '@/components/themed/Themed';
import type { ThemedTone } from '@/styles/theme-tokens';

const TAX_SLEEVE_TIP = (
  <>
    <strong>What this is.</strong> A reminder + calculator for advance tax
    (India) or estimated tax (US) — the quarterly self-paid tax you owe on
    income your employer doesn&apos;t withhold (business income, rental,
    capital gains, side work).
    <div style={{ marginTop: 8 }}>
      <strong>Why it lives here.</strong> If you ignore it, the penal interest
      (1%/month in India on the shortfall) silently shows up in March and
      eats your debt-free date. Better to park a fixed monthly amount aside
      now than to scramble at year-end.
    </div>
    <div style={{ marginTop: 8 }}>
      <strong>How the target is calculated.</strong> From the &quot;tax on
      income with no withholding&quot; field (non-TDS income in India) you entered at onboarding (salaried) or
      from your stated annual business income (business owner). The
      installments follow the statutory schedule for your country.
    </div>
    <div style={{ marginTop: 8 }}>
      Not your situation? Clear that field in{' '}
      <a href="/profile?step=income" style={{ color: 'var(--accent)' }}>
        Profile → Income
      </a>{' '}
      and the card goes away.
    </div>
  </>
);

export function TaxSleeveCard({
  user,
}: {
  user: UserPayload;
}) {
  const [slice, setSlice] = useState<TaxSleeveSlice>({ paidInstallments: [] });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSlice(readTaxSleeveClient());
    setReady(true);
  }, []);

  const annualTarget = useMemo(() => sleeveAnnualTarget(user), [user]);

  if (!ready) return null;
  if (annualTarget == null || annualTarget <= 0) return null;

  const country = user.country;
  const currency = userDefaultCurrency(country);
  const next = nextInstallment(slice, country);

  // Cumulative-paid total = sum of cumPct deltas for paid quarters.
  const fullSchedule = installmentSchedule(country);
  const paidTotal = fullSchedule.reduce((sum, inst, idx) => {
    if (!slice.paidInstallments.includes(cycleKey(inst))) return sum;
    const priorPct = idx === 0 ? 0 : fullSchedule[idx - 1].cumulativePct;
    return sum + (inst.cumulativePct - priorPct) * annualTarget;
  }, 0);

  function handlePaid(inst: InstallmentInfo) {
    setSlice((cur) => markInstallmentPaid(cur, cycleKey(inst)));
  }
  function handleUnpaid(inst: InstallmentInfo) {
    setSlice((cur) => unmarkInstallmentPaid(cur, cycleKey(inst)));
  }

  if (!next) {
    return (
      <Shell tone="accent" title="Advance tax set-aside · all clear">
        <ThemedHeadline>
          Annual target {formatCurrency(String(annualTarget), currency)} — all 4
          installments paid.
        </ThemedHeadline>
        <ThemedDetail>
          The next cycle starts on{' '}
          <strong>{country === 'IN' ? 'June 15' : 'April 15'}</strong> next
          fiscal year. We&apos;ll surface the reminder then.
        </ThemedDetail>
      </Shell>
    );
  }

  const daysLeft = daysUntil(next.dueDate);
  const cumulativeDue = annualTarget * next.cumulativePct;
  const gap = Math.max(0, cumulativeDue - paidTotal);
  const urgent = daysLeft <= 14 && daysLeft >= 0;
  const overdue = daysLeft < 0;
  const tone: ThemedTone = urgent || overdue ? 'negative' : 'accent';

  const monthsLeft = Math.max(1, daysLeft / 30);
  const monthlySetAside = gap / monthsLeft;

  const nextIdx = fullSchedule.findIndex((i) => cycleKey(i) === cycleKey(next));
  const title = overdue
    ? `Advance tax set-aside · OVERDUE by ${-daysLeft}d`
    : urgent
      ? `Advance tax set-aside · ${daysLeft}d to next instalment`
      : 'Advance tax set-aside';

  return (
    <Shell tone={tone} title={title}>
      <ThemedHeadline>
        Annual target{' '}
        <strong>{formatCurrency(String(annualTarget), currency)}</strong>.{' '}
        {next.label}:{' '}
        <strong>{(next.cumulativePct * 100).toFixed(0)}%</strong> cumulative
        due ({formatCurrency(String(Math.round(cumulativeDue)), currency)}).
      </ThemedHeadline>
      <ThemedDetail>
        <div>
          Already paid:{' '}
          <strong>
            {formatCurrency(String(Math.round(paidTotal)), currency)}
          </strong>
          {' · '}Gap:{' '}
          <strong style={{ color: urgent || overdue ? 'var(--negative)' : 'var(--ink)' }}>
            {formatCurrency(String(Math.round(gap)), currency)}
          </strong>
        </div>
        {gap > 0 && (
          <div style={{ marginTop: 4 }}>
            Set aside{' '}
            <strong style={{ color: 'var(--ink)' }}>
              {formatCurrency(String(Math.round(monthlySetAside)), currency)}/mo
            </strong>{' '}
            to land on target by {next.label}.
          </div>
        )}
        <div
          style={{
            marginTop: 10,
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <button
            type="button"
            onClick={() => handlePaid(next)}
            style={{
              background: 'var(--accent)',
              color: 'var(--canvas)',
              border: 'none',
              borderRadius: 4,
              padding: '5px 10px',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Mark {next.label} paid
          </button>
          {nextIdx > 0 && (
            <button
              type="button"
              onClick={() => {
                const prev = fullSchedule[nextIdx - 1];
                if (slice.paidInstallments.includes(cycleKey(prev))) {
                  handleUnpaid(prev);
                } else {
                  handlePaid(prev);
                }
              }}
              style={{
                background: 'transparent',
                color: 'var(--accent)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '5px 10px',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {slice.paidInstallments.includes(cycleKey(fullSchedule[nextIdx - 1]))
                ? `Unmark ${fullSchedule[nextIdx - 1].label}`
                : `Mark ${fullSchedule[nextIdx - 1].label} paid`}
            </button>
          )}
        </div>
        <div style={{ marginTop: 6 }}>
          India advance tax: 15% by Jun 15, 45% by Sep 15, 75% by Dec 15, 100%
          by Mar 15. Missing an installment costs 1%/month penal interest on the
          shortfall.
        </div>
        <div style={{ marginTop: 4, fontStyle: 'italic' }}>
          Annual target of{' '}
          <strong style={{ color: 'var(--ink)' }}>
            {formatCurrency(String(annualTarget), currency)}
          </strong>{' '}
          comes from{' '}
          {user.income_type === 'business_owner' ? (
            <>
              the tax on your stated <strong>annual business income</strong>.
              Edit in{' '}
              <a href="/profile?step=income" style={{ color: 'var(--accent)' }}>
                Profile → Income
              </a>
              .
            </>
          ) : (
            <>
              the <strong>&quot;{country === 'IN' ? 'tax on non-TDS income' : 'tax on income with no withholding'}&quot;</strong> field you
              entered. Edit or clear it in{' '}
              <a href="/profile?step=income" style={{ color: 'var(--accent)' }}>
                Profile → Income
              </a>{' '}
              to make this card go away.
            </>
          )}
        </div>
      </ThemedDetail>
    </Shell>
  );
}

function Shell({
  tone,
  title,
  children,
}: {
  tone: ThemedTone;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <ThemedContainer tone={tone} style={{ marginBottom: 14 }}>
      <ThemedLabel
        tone={tone}
        trailing={<InfoTip>{TAX_SLEEVE_TIP}</InfoTip>}
      >
        {title.toUpperCase()}
      </ThemedLabel>
      {children}
    </ThemedContainer>
  );
}
