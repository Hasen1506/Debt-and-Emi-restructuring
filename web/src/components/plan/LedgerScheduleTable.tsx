'use client';

/**
 * Ledger Plan · monthly schedule.
 *
 * Renders the trajectory (avalanche vs minimums) as a dense per-month table
 * in the statement aesthetic. Long horizons (up to 240 months) would blow
 * out page height, so the component has three states:
 *   1. Collapsed — first 12 months only, footer offers expand.
 *   2. Expanded — full schedule inside a fixed-height scroll region with
 *      a sticky table header. Page scroll stays put.
 *   3. CSV export — always available, dumps the whole schedule.
 *
 * Each row can also be expanded inline to show the per-bank cash flow that
 * the engine recommends for that month — "this is exactly what to pay
 * which lender", sourced from MonthRow.payments_by_loan_index.
 */

import { useMemo, useState } from 'react';
import { formatINR, type Country, type LoanPayload } from '@/lib/api';
import { getCountryToday } from '@/lib/today';
import type { TrajectoryPoint } from '@/lib/mock-data';
import type { MonthlyPaymentBreakdown } from './PlanData';

const VISIBLE_DEFAULT = 12;
const SCROLL_HEIGHT = 360;

function monthLabel(monthIndex: number, start: Date, country: Country): string {
  const d = new Date(start.getFullYear(), start.getMonth() + monthIndex, 1);
  const locale = country === 'IN' ? 'en-IN' : 'en-US';
  return d
    .toLocaleDateString(locale, { month: 'short', year: '2-digit' })
    .toUpperCase()
    .replace(' ', " '");
}

function toCSV(rows: TrajectoryPoint[], start: Date): string {
  const header = 'month,date,avalanche_balance,minimums_balance,delta\n';
  const body = rows
    .map((r) => {
      const d = new Date(start.getFullYear(), start.getMonth() + r.month, 1);
      const date = d.toISOString().slice(0, 7);
      const delta = r.minimums - r.avalanche;
      return `${r.month},${date},${Math.round(r.avalanche)},${Math.round(r.minimums)},${Math.round(delta)}`;
    })
    .join('\n');
  return header + body + '\n';
}

function downloadCSV(rows: TrajectoryPoint[], start: Date) {
  const blob = new Blob([toCSV(rows, start)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `finoptima-schedule-${start.toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function LedgerScheduleTable({
  data,
  monthlyPayments = [],
  loans = [],
  country = 'IN',
}: {
  data: TrajectoryPoint[];
  /** Per-month per-loan payment dict from the engine. Empty in offline mode. */
  monthlyPayments?: MonthlyPaymentBreakdown[];
  /** User's loans in the order the engine sees them, for bank labels. */
  loans?: LoanPayload[];
  /** Country drives the date locale + the calendar "today" for month 1. */
  country?: Country;
}) {
  const [expanded, setExpanded] = useState(false);
  // Which month row has its per-bank breakdown unfolded. Single-open so the
  // table never grows beyond what's visible (no nested-row scroll mess).
  const [openMonth, setOpenMonth] = useState<number | null>(null);
  const start = useMemo(() => getCountryToday(country), [country]);

  // Trim trailing rows where both series have cleared — no signal past that.
  const rows = useMemo(() => {
    let lastSignal = -1;
    for (let i = 0; i < data.length; i++) {
      if (data[i].avalanche > 1 || data[i].minimums > 1) lastSignal = i;
    }
    return data.slice(0, lastSignal + 1);
  }, [data]);

  // Index payments by month for O(1) row lookups.
  const paymentsByMonth = useMemo(() => {
    const m = new Map<number, Record<number, string>>();
    for (const p of monthlyPayments) m.set(p.month, p.perLoan);
    return m;
  }, [monthlyPayments]);

  const total = rows.length;
  const visible = expanded ? rows : rows.slice(0, VISIBLE_DEFAULT);
  const remaining = Math.max(0, total - VISIBLE_DEFAULT);
  const canExpand = remaining > 0;
  const hasPerBankData = monthlyPayments.length > 0 && loans.length > 0;

  return (
    <section>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          fontSize: 11,
          color: 'var(--muted)',
          letterSpacing: '0.18em',
          marginBottom: 6,
          fontFamily: 'var(--font-mono)',
        }}
      >
        <span>
          $ SCHEDULE · {expanded ? `ALL ${total}` : `MONTHS 1-${Math.min(VISIBLE_DEFAULT, total)}`} OF {total}
        </span>
        <span style={{ display: 'inline-flex', gap: 14 }}>
          {canExpand && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--ink)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.12em',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {expanded ? '[COLLAPSE]' : `[EXPAND +${remaining}]`}
            </button>
          )}
          <button
            type="button"
            onClick={() => downloadCSV(rows, start)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--ink)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.12em',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            [EXPORT CSV]
          </button>
        </span>
      </div>

      <div
        style={{
          fontSize: 11,
          color: 'var(--muted)',
          letterSpacing: '0.04em',
          lineHeight: 1.6,
          marginBottom: 8,
          fontFamily: 'var(--font-mono)',
        }}
      >
        Outstanding balance month-by-month under your plan vs paying only the
        minimums. <strong style={{ color: 'var(--ink)' }}>BALANCE (PLAN)</strong>{' '}
        = what you&apos;ll owe at month-end.{' '}
        <strong style={{ color: 'var(--ink)' }}>IF MINIMUMS ONLY</strong> = same
        month if you paid bank-required minimums and nothing more.{' '}
        <strong style={{ color: 'var(--ink)' }}>AHEAD BY</strong> = how much
        sooner your principal falls.
        {hasPerBankData && (
          <>
            {' '}
            <strong style={{ color: 'var(--ink)' }}>Click any month</strong> to
            see exactly how much to send each bank.
          </>
        )}
      </div>
      <div
        style={{
          border: '1px solid var(--ink)',
          background: 'var(--card)',
          maxHeight: expanded ? SCROLL_HEIGHT : undefined,
          overflowY: expanded ? 'auto' : 'visible',
        }}
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: '1px solid var(--ink)',
                background: 'var(--card)',
                position: expanded ? 'sticky' : 'static',
                top: 0,
                zIndex: 1,
              }}
            >
              {['MO', 'DATE', 'BALANCE (PLAN)', 'IF MINIMUMS ONLY', 'AHEAD BY'].map((h, i) => (
                <th
                  key={h}
                  style={{
                    padding: '8px 12px',
                    textAlign: i > 1 ? 'right' : 'left',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    fontSize: 10,
                    color: 'var(--muted)',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const delta = r.minimums - r.avalanche;
              const cleared = r.avalanche <= 1;
              const perLoan = paymentsByMonth.get(r.month);
              const isOpen = openMonth === r.month;
              const canOpen = hasPerBankData && perLoan != null && !cleared;
              return (
                <RowGroup
                  key={r.month}
                  monthLabel={monthLabel(r.month, start, country)}
                  month={r.month}
                  avalanche={r.avalanche}
                  minimums={r.minimums}
                  delta={delta}
                  cleared={cleared}
                  canOpen={canOpen}
                  isOpen={isOpen}
                  onToggle={() => setOpenMonth(isOpen ? null : r.month)}
                  perLoan={perLoan}
                  loans={loans}
                />
              );
            })}
          </tbody>
        </table>
      </div>

    </section>
  );
}

const LOAN_TYPE_SHORT: Record<string, string> = {
  home_loan: 'HOME',
  auto_loan: 'AUTO',
  personal_loan: 'PERSONAL',
  credit_card: 'CARD',
  education_loan: 'EDUCATION',
  gold_loan: 'GOLD',
  bnpl: 'BNPL',
};

function RowGroup({
  monthLabel,
  month,
  avalanche,
  minimums,
  delta,
  cleared,
  canOpen,
  isOpen,
  onToggle,
  perLoan,
  loans,
}: {
  monthLabel: string;
  month: number;
  avalanche: number;
  minimums: number;
  delta: number;
  cleared: boolean;
  canOpen: boolean;
  isOpen: boolean;
  onToggle: () => void;
  perLoan: Record<number, string> | undefined;
  loans: LoanPayload[];
}) {
  const tdStyle = { padding: '8px 12px' } as const;
  return (
    <>
      <tr
        onClick={canOpen ? onToggle : undefined}
        style={{
          borderBottom: isOpen ? 'none' : '1px dashed var(--dash)',
          opacity: cleared ? 0.65 : 1,
          cursor: canOpen ? 'pointer' : 'default',
          background: isOpen ? 'var(--soft-bg)' : 'transparent',
        }}
      >
        <td style={{ ...tdStyle, color: 'var(--muted)' }}>
          {canOpen && (
            <span
              aria-hidden
              style={{
                display: 'inline-block',
                width: 12,
                color: 'var(--muted)',
                fontWeight: 700,
              }}
            >
              {isOpen ? '▾' : '▸'}
            </span>
          )}
          {String(month).padStart(3, '0')}
        </td>
        <td style={{ ...tdStyle, color: 'var(--muted)' }}>{monthLabel}</td>
        <td
          style={{
            ...tdStyle,
            textAlign: 'right',
            fontWeight: cleared ? 400 : 600,
          }}
        >
          {cleared ? 'CLEARED' : formatINR(avalanche)}
        </td>
        <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--muted)' }}>
          {minimums <= 1 ? 'CLEARED' : formatINR(minimums)}
        </td>
        <td
          style={{
            ...tdStyle,
            textAlign: 'right',
            color: delta > 0 ? 'var(--positive)' : 'var(--muted)',
            fontWeight: delta > 0 ? 600 : 400,
          }}
        >
          {delta > 0 ? formatINR(delta) : '—'}
        </td>
      </tr>
      {isOpen && perLoan && (
        <tr
          style={{
            borderBottom: '1px solid var(--ink)',
            background: 'var(--soft-bg)',
          }}
        >
          <td colSpan={5} style={{ padding: '6px 12px 12px 36px' }}>
            <div
              style={{
                fontSize: 10,
                color: 'var(--muted)',
                letterSpacing: '0.12em',
                marginBottom: 6,
              }}
            >
              PAY THIS MONTH ({monthLabel})
            </div>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
              }}
            >
              <tbody>
                {Object.entries(perLoan)
                  .map(([idx, amount]) => ({
                    idx: Number(idx),
                    amount: Number(amount),
                  }))
                  .sort((a, b) => b.amount - a.amount)
                  .map(({ idx, amount }) => {
                    const loan = loans[idx];
                    if (!loan) return null;
                    const tag =
                      LOAN_TYPE_SHORT[loan.loan_type] ?? loan.loan_type;
                    return (
                      <tr key={idx}>
                        <td
                          style={{
                            padding: '4px 0',
                            color: 'var(--ink)',
                            width: '60%',
                          }}
                        >
                          → {loan.bank || 'Unnamed lender'}{' '}
                          <span style={{ color: 'var(--muted)' }}>· {tag}</span>
                        </td>
                        <td
                          style={{
                            padding: '4px 0',
                            textAlign: 'right',
                            color: 'var(--ink)',
                            fontWeight: 600,
                          }}
                        >
                          {formatINR(amount)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <div
              style={{
                fontSize: 10,
                color: 'var(--muted)',
                marginTop: 6,
                letterSpacing: '0.04em',
                lineHeight: 1.5,
              }}
            >
              Total includes minimums + any surplus routed to the highest-priority
              loan. Cascade amounts (freed when a loan clears mid-month) are
              folded into the next loan&apos;s row.
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
