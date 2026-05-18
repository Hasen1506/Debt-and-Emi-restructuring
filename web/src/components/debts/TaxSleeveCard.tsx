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
 * Each render
 *   • Computes the annual tax target via `sleeveAnnualTarget`.
 *   • Picks the soonest unpaid installment via `nextInstallment`.
 *   • Computes cumulative-due (annualTarget × cumulativePct) and the
 *     gap to current "paid" total (annualTarget × prior-quarter cumPct).
 *   • Shows days-until + amount. Goes red when within 14 days.
 *   • "Mark paid" stores the cycleKey in the tax_sleeve slice so the
 *     card moves to the next installment on next render.
 *
 * Pure calculator + reminder — does NOT move money. Phase 5 cash
 * advisor can wire physical sub-accounts later.
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

type Variant = 'ledger' | 'editorial' | 'existing';

export function TaxSleeveCard({
  user,
  variant,
}: {
  user: UserPayload;
  variant: Variant;
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
  // Walk the full schedule and check which cycle keys are paid.
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
    // All installments paid for the current cycle — congratulate quietly.
    return renderBody(
      variant,
      {
        title: 'Tax sleeve · all clear',
        headline: `Annual target ${formatCurrency(String(annualTarget), currency)} — all 4 installments paid.`,
        urgent: false,
        body: (
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            The next cycle starts on{' '}
            <strong>{country === 'IN' ? 'June 15' : 'April 15'}</strong> next
            fiscal year. We'll surface the reminder then.
          </div>
        ),
      },
    );
  }

  const daysLeft = daysUntil(next.dueDate);
  const cumulativeDue = annualTarget * next.cumulativePct;
  const gap = Math.max(0, cumulativeDue - paidTotal);
  const urgent = daysLeft <= 14 && daysLeft >= 0;
  const overdue = daysLeft < 0;

  // Suggested monthly sequester to cover the gap by the due date.
  // Floor at 0 in case daysLeft <= 0.
  const monthsLeft = Math.max(1, daysLeft / 30);
  const monthlySetAside = gap / monthsLeft;

  // Prior installment (for the "Mark paid" button targeting a recently-missed one)
  const fullList = fullSchedule;
  const nextIdx = fullList.findIndex((i) => cycleKey(i) === cycleKey(next));

  const title = overdue
    ? `Tax sleeve · OVERDUE by ${-daysLeft}d`
    : urgent
      ? `Tax sleeve · ${daysLeft}d to next installment`
      : 'Tax sleeve';

  const headline = (
    <>
      Annual target{' '}
      <strong>{formatCurrency(String(annualTarget), currency)}</strong>.
      {' '}
      {next.label}: <strong>{(next.cumulativePct * 100).toFixed(0)}%</strong>{' '}
      cumulative due ({formatCurrency(String(Math.round(cumulativeDue)), currency)}).
    </>
  );

  const body = (
    <div style={{ fontSize: 13, lineHeight: 1.55, marginTop: 6 }}>
      <div>
        Already paid:{' '}
        <strong>{formatCurrency(String(Math.round(paidTotal)), currency)}</strong>
        {' · '}
        Gap:{' '}
        <strong
          style={{
            color: urgent || overdue ? 'var(--negative)' : 'var(--ink)',
          }}
        >
          {formatCurrency(String(Math.round(gap)), currency)}
        </strong>
      </div>
      {gap > 0 && (
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Set aside{' '}
          <strong style={{ color: 'var(--ink)' }}>
            {formatCurrency(String(Math.round(monthlySetAside)), currency)}
            /mo
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
              const prev = fullList[nextIdx - 1];
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
            {slice.paidInstallments.includes(cycleKey(fullList[nextIdx - 1]))
              ? `Unmark ${fullList[nextIdx - 1].label}`
              : `Mark ${fullList[nextIdx - 1].label} paid`}
          </button>
        )}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        India advance tax: 15% by Jun 15, 45% by Sep 15, 75% by Dec 15, 100%
        by Mar 15. Missing an installment costs 1%/month penal interest on the
        shortfall.
      </div>
    </div>
  );

  return renderBody(variant, { title, headline, urgent: urgent || overdue, body });
}

// ─── Shared render shell ──────────────────────────────────────────────────

function renderBody(
  variant: Variant,
  {
    title,
    headline,
    urgent,
    body,
  }: {
    title: string;
    headline: React.ReactNode;
    urgent: boolean;
    body: React.ReactNode;
  },
): React.ReactElement {
  const accent = urgent ? 'var(--negative)' : 'var(--accent)';
  if (variant === 'ledger') {
    return (
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          lineHeight: 1.55,
          borderLeft: `3px solid ${accent}`,
          paddingLeft: 12,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: accent,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
          }}
        >
          $ {title}
        </div>
        <div style={{ marginTop: 6 }}>{headline}</div>
        {body}
      </div>
    );
  }
  if (variant === 'editorial') {
    return (
      <div
        style={{
          margin: '14px 0 18px',
          paddingLeft: 14,
          borderLeft: `3px solid ${accent}`,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 11,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: accent,
          }}
        >
          {title}
        </div>
        <div style={{ marginTop: 6, fontSize: 14 }}>{headline}</div>
        {body}
      </div>
    );
  }
  return (
    <div
      style={{
        padding: 12,
        marginBottom: 14,
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${accent}`,
        borderRadius: 6,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: accent }}>{title}</div>
      <div style={{ marginTop: 4, fontSize: 13 }}>{headline}</div>
      {body}
    </div>
  );
}
