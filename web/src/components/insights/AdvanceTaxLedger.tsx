'use client';

/**
 * Read-only advance-tax summary in /insights.
 *
 * Surfaces the schedule that lives in `finoptima_advance_tax` cookie (set
 * by /plan when an SE user with sufficient gross income lands there).
 * Insights doesn't own the schedule — it just reflects whatever /plan
 * generated and the user has interacted with so far. "Mark paid" lives
 * on /plan; here we just list the status + accrued penalty for visibility
 * alongside the loan-event activity log.
 *
 * Renders nothing when no schedule has been generated yet (user hasn't
 * visited /plan, or isn't SE / threshold-eligible).
 */
import { useEffect, useState } from 'react';
import { formatCurrency, type Country, type UserPayload } from '@/lib/api';
import type { CurrencyCode } from '@/lib/currency';
import { userDefaultCurrency } from '@/lib/currency';
import { accruedPenalty, type AdvanceTaxSchedule } from '@/lib/advance-tax';
import { readScheduleClient } from '@/lib/advance-tax-cookie';

export function AdvanceTaxLedger({
  user,
  variant,
}: {
  user: UserPayload;
  variant: 'existing' | 'editorial' | 'ledger';
}) {
  // Hydrate from cookie on mount; null until ready so SSR renders empty.
  const [schedule, setSchedule] = useState<AdvanceTaxSchedule | null>(null);
  useEffect(() => {
    setSchedule(readScheduleClient());
  }, []);

  if (!schedule) return null;
  const country: Country = user.country;
  const ccy: CurrencyCode = userDefaultCurrency(country);
  const penalty = accruedPenalty(schedule, new Date());
  const totalPenalty = Number(penalty.total);
  const totalDue = schedule.instalments.reduce(
    (s, i) => s + Number(i.amountDue),
    0,
  );
  const totalPaid = schedule.instalments.reduce(
    (s, i) => s + Number(i.paidAmount ?? '0'),
    0,
  );
  const headline =
    country === 'IN' ? 'Section 208 advance tax' : 'Form 1040-ES estimated tax';

  if (variant === 'ledger') {
    return (
      <section style={{ marginTop: 16 }}>
        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            letterSpacing: '0.18em',
            marginBottom: 6,
            fontFamily: 'var(--font-mono)',
          }}
        >
          $ ADVANCE TAX · {schedule.fiscalYearLabel.toUpperCase()}
        </div>
        <div
          style={{
            border: '1px dashed var(--border)',
            padding: '10px 12px',
            background: 'var(--card)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {schedule.instalments.map((inst) => {
            const due = Number(inst.amountDue);
            const paid = Number(inst.paidAmount ?? '0');
            const tag =
              inst.status === 'paid'
                ? '[PAID]'
                : inst.status === 'missed'
                  ? '[MISSED]'
                  : '[PENDING]';
            const color =
              inst.status === 'paid'
                ? 'var(--positive)'
                : inst.status === 'missed'
                  ? 'var(--negative)'
                  : 'var(--ink)';
            return (
              <div key={inst.ordinal} style={{ color }}>
                Q{inst.ordinal} · {inst.dueDate} · {formatCurrency(String(due), ccy)} {tag}
                {paid > 0 && paid < due && (
                  <span style={{ color: 'var(--muted)' }}>
                    {' '}({formatCurrency(String(paid), ccy)} paid)
                  </span>
                )}
              </div>
            );
          })}
          {totalPenalty > 0 && (
            <div style={{ marginTop: 6, color: 'var(--negative)' }}>
              Penalty accrued: {formatCurrency(penalty.total, ccy)}
            </div>
          )}
          <div style={{ marginTop: 6, color: 'var(--muted)' }}>
            Paid {formatCurrency(String(totalPaid), ccy)} of {formatCurrency(String(totalDue), ccy)} ·
            <a href="/plan" style={{ color: 'var(--ink)', marginLeft: 6 }}>
              manage on /plan
            </a>
          </div>
        </div>
      </section>
    );
  }

  // 'existing' / 'editorial' — a softer card layout.
  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--warning, #c97800)',
        padding: 14,
        borderRadius: 8,
        marginTop: 16,
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        {headline} · {schedule.fiscalYearLabel}
      </div>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          fontSize: 12,
        }}
      >
        {schedule.instalments.map((inst) => {
          const due = Number(inst.amountDue);
          const paid = Number(inst.paidAmount ?? '0');
          const color =
            inst.status === 'paid'
              ? 'var(--positive)'
              : inst.status === 'missed'
                ? 'var(--negative)'
                : 'var(--ink)';
          return (
            <li
              key={inst.ordinal}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
            >
              <span style={{ color }}>
                Q{inst.ordinal} · {inst.dueDate} · {inst.status}
              </span>
              <span className="num">
                {formatCurrency(String(due), ccy)}
                {paid > 0 && paid < due && ` (${formatCurrency(String(paid), ccy)} paid)`}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        {totalPenalty > 0 && (
          <>
            <strong style={{ color: 'var(--negative)' }}>
              Penalty accrued: {formatCurrency(penalty.total, ccy)}
            </strong>
            {' · '}
          </>
        )}
        Paid {formatCurrency(String(totalPaid), ccy)} of {formatCurrency(String(totalDue), ccy)}.{' '}
        <a href="/plan">Manage on /plan</a>.
      </div>
    </div>
  );
}
