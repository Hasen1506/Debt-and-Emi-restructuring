'use client';

/**
 * Quarterly advance-tax obligations panel on /plan.
 *
 * Shown when the user has provided gross income that triggers Sec 208
 * (India) or 1040-ES (US) — i.e. annual tax > ₹10k (IN, SE only) or > $1k
 * (US, SE only). Salaried users don't see this (their TDS / W-2
 * withholding covers it). Caller decides whether to render this; the
 * component just gates on `schedule` being non-null.
 *
 * Each instalment row shows due date, amount due, status, and a
 * "Mark paid" affordance. Partial payments are supported via an input
 * for amount (defaults to amountDue). Past-due unpaid rows render in
 * warning style with the accrued 234C / 2210 penalty inline.
 *
 * Three layout variants mirror the Plan themes; chrome lives in PanelShell.
 * Editorial/aside variant is intentionally read-only.
 */
import { localIsoDate } from '@/lib/today';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrency, type Country } from '@/lib/api';
import type { CurrencyCode } from '@/lib/currency';
import type { AdvanceTaxSchedule } from '@/lib/advance-tax';
import { accruedPenalty } from '@/lib/advance-tax';
import { markPaid, writeScheduleClient } from '@/lib/advance-tax-cookie';
import { PanelShell } from '@/components/themed/PanelShell';

export function AdvanceTaxPanel({
  schedule,
  country,
  displayCurrency,
  monthlyPenaltyCost,
  variant,
}: {
  schedule: AdvanceTaxSchedule;
  country: Country;
  displayCurrency: CurrencyCode;
  /** Per-month surplus reduction the penalty causes. Driven by the server
   *  component which folds it into fixed_expenses for the simulation. */
  monthlyPenaltyCost: number;
  variant: 'ledger' | 'inline' | 'aside';
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const today = new Date();
  const todayIso = localIsoDate(today);
  const penalty = accruedPenalty(schedule, today);
  const totalPenalty = Number(penalty.total);

  function payOrdinal(ordinal: number, amountStr: string) {
    if (!amountStr || Number(amountStr) <= 0) return;
    const next = markPaid(schedule, ordinal, amountStr, todayIso);
    writeScheduleClient(next);
    setDrafts((d) => ({ ...d, [ordinal]: '' }));
    startTransition(() => router.refresh());
  }

  const rows = schedule.instalments.map((inst) => {
    const dueDate = new Date(inst.dueDate + 'T00:00:00');
    const isPast = inst.dueDate < todayIso;
    const isPaid = inst.status === 'paid';
    const isMissed = inst.status === 'missed' || (isPast && !isPaid);
    const paid = Number(inst.paidAmount ?? '0');
    const due = Number(inst.amountDue);
    const shortfall = Math.max(0, due - paid);
    return {
      ordinal: inst.ordinal,
      dueLabel: dueDate.toLocaleDateString(country === 'IN' ? 'en-IN' : 'en-US', {
        day: 'numeric', month: 'short', year: 'numeric',
      }),
      isPast,
      isPaid,
      isMissed,
      due,
      paid,
      shortfall,
      cumulativePct: inst.cumulativePct,
    };
  });

  const headline =
    country === 'IN'
      ? `${schedule.fiscalYearLabel} · Section 208 advance tax`
      : `${schedule.fiscalYearLabel} · Form 1040-ES estimated tax`;
  const baseCaveat =
    country === 'IN'
      ? 'Default schedule assumes you pay on time. Missing an instalment accrues Sec 234C at ~1%/month on the shortfall; year-end balance accrues Sec 234B in addition.'
      : 'Default schedule assumes you pay on time. Missing payments accrue Form 2210 underpayment penalty (~8% APR) on the shortfall.';

  const penaltyLine = totalPenalty > 0 ? (
    <>
      {country === 'IN' ? '234C ' : 'Form 2210 '}
      {formatCurrency(penalty.sec234C, displayCurrency)}
      {country === 'IN' && Number(penalty.sec234B) > 0
        ? ` · 234B ${formatCurrency(penalty.sec234B, displayCurrency)}`
        : ''}
    </>
  ) : null;

  if (variant === 'ledger') {
    return (
      <PanelShell
        variant="ledger"
        tone="warning"
        border="dashed"
        eyebrow={`ADVANCE TAX · ${headline.toUpperCase()}`}
        caveat={baseCaveat}
      >
        {rows.map((r) => (
          <RowLedger
            key={r.ordinal}
            row={r}
            displayCurrency={displayCurrency}
            draft={drafts[r.ordinal] ?? ''}
            onDraft={(v) => setDrafts((d) => ({ ...d, [r.ordinal]: v }))}
            onPay={(amount) => payOrdinal(r.ordinal, amount)}
            pending={pending}
          />
        ))}
        {totalPenalty > 0 && (
          <div style={{ marginTop: 8, color: 'var(--negative)' }}>
            Penalty accrued: {formatCurrency(penalty.total, displayCurrency)}{' '}
            <span style={{ color: 'var(--muted)' }}>({penaltyLine})</span>
          </div>
        )}
        {monthlyPenaltyCost > 0 && (
          <div style={{ marginTop: 4, color: 'var(--negative)', fontSize: 11 }}>
            → reducing surplus by{' '}
            {formatCurrency(monthlyPenaltyCost.toFixed(0), displayCurrency)}/mo
            · pushing debt-free month out
          </div>
        )}
      </PanelShell>
    );
  }

  if (variant === 'inline') {
    return (
      <PanelShell
        variant="inline"
        tone="warning"
        eyebrow={headline}
        caveat={baseCaveat}
      >
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            fontSize: 12,
          }}
        >
          {rows.map((r) => (
            <RowInline
              key={r.ordinal}
              row={r}
              displayCurrency={displayCurrency}
              draft={drafts[r.ordinal] ?? ''}
              onDraft={(v) => setDrafts((d) => ({ ...d, [r.ordinal]: v }))}
              onPay={(amount) => payOrdinal(r.ordinal, amount)}
              pending={pending}
            />
          ))}
        </ul>
        {totalPenalty > 0 && (
          <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            <strong style={{ color: 'var(--negative)' }}>
              Penalty accrued: {formatCurrency(penalty.total, displayCurrency)}
            </strong>{' '}
            ({country === 'IN' ? 'Sec 234C ' : 'Form 2210 '}
            {formatCurrency(penalty.sec234C, displayCurrency)}
            {country === 'IN' && Number(penalty.sec234B) > 0
              ? ` · 234B ${formatCurrency(penalty.sec234B, displayCurrency)}`
              : ''}
            )
          </div>
        )}
        {monthlyPenaltyCost > 0 && (
          <div style={{ marginTop: 4, color: 'var(--negative)', fontSize: 12 }}>
            → Reducing your monthly surplus by{' '}
            <strong>
              {formatCurrency(monthlyPenaltyCost.toFixed(0), displayCurrency)}
            </strong>
            , pushing your debt-free month later.
          </div>
        )}
      </PanelShell>
    );
  }

  // aside / editorial — read-only summary, no action buttons.
  return (
    <PanelShell
      variant="aside"
      eyebrow={`Quarterly advance tax · ${schedule.fiscalYearLabel}`}
      caveat={`${baseCaveat} Switch to the ledger or existing theme to mark instalments paid.`}
    >
      <div style={{ fontSize: 14, fontFamily: 'var(--font-sans)', lineHeight: 1.7 }}>
        {rows.map((r) => (
          <div
            key={r.ordinal}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 16,
              paddingBottom: 6,
              color:
                r.isMissed
                  ? 'var(--negative)'
                  : r.isPaid
                    ? 'var(--positive)'
                    : 'var(--ink)',
            }}
          >
            <span>
              <strong>Q{r.ordinal}</strong> · {r.dueLabel}
              {r.isPaid && ' · paid'}
              {r.isMissed && ' · missed'}
            </span>
            <span className="num">
              {formatCurrency(String(r.due), displayCurrency)}
            </span>
          </div>
        ))}
        {totalPenalty > 0 && (
          <p style={{ marginTop: 12, color: 'var(--negative)', fontSize: 13 }}>
            Penalty: {formatCurrency(penalty.total, displayCurrency)} accrued so far.
          </p>
        )}
      </div>
    </PanelShell>
  );
}

// ─── Row renderers ─────────────────────────────────────────────────────────

type RowVm = {
  ordinal: number;
  dueLabel: string;
  isPast: boolean;
  isPaid: boolean;
  isMissed: boolean;
  due: number;
  paid: number;
  shortfall: number;
  cumulativePct: number;
};

function RowLedger({
  row, displayCurrency, draft, onDraft, onPay, pending,
}: {
  row: RowVm;
  displayCurrency: CurrencyCode;
  draft: string;
  onDraft: (v: string) => void;
  onPay: (amount: string) => void;
  pending: boolean;
}) {
  const due = formatCurrency(String(row.due), displayCurrency);
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'center' }}>
      <span style={{ width: 28, color: 'var(--muted)' }}>Q{row.ordinal}</span>
      <span style={{ flex: 1 }}>
        {row.dueLabel} · {due}
        {row.isPaid && <span style={{ color: 'var(--positive)' }}> [PAID]</span>}
        {row.isMissed && (
          <span style={{ color: 'var(--negative)' }}>
            {' '}[MISSED · {formatCurrency(String(row.shortfall), displayCurrency)} short]
          </span>
        )}
      </span>
      {!row.isPaid && (
        <>
          <input
            type="text"
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            placeholder={String(Math.max(0, row.shortfall || row.due))}
            style={{
              width: 90,
              padding: '2px 6px',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              border: '1px solid var(--border)',
              background: 'var(--canvas)',
            }}
          />
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              onPay(draft || String(Math.max(0, row.shortfall || row.due)))
            }
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              padding: '2px 8px',
              fontSize: 11,
              cursor: pending ? 'wait' : 'pointer',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.04em',
            }}
          >
            [MARK PAID]
          </button>
        </>
      )}
    </div>
  );
}

function RowInline({
  row, displayCurrency, draft, onDraft, onPay, pending,
}: {
  row: RowVm;
  displayCurrency: CurrencyCode;
  draft: string;
  onDraft: (v: string) => void;
  onPay: (amount: string) => void;
  pending: boolean;
}) {
  const due = formatCurrency(String(row.due), displayCurrency);
  const labelColor = row.isMissed
    ? 'var(--negative)'
    : row.isPaid
      ? 'var(--positive)'
      : 'var(--ink)';
  return (
    <li
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        border: '1px solid var(--border)',
        borderRadius: 4,
      }}
    >
      <span style={{ width: 24, fontWeight: 600, color: 'var(--muted)' }}>
        Q{row.ordinal}
      </span>
      <span style={{ flex: 1, minWidth: 180, color: labelColor }}>
        {row.dueLabel} · {due} due
        {row.isPaid && ' · paid'}
        {row.isMissed && ` · ${formatCurrency(String(row.shortfall), displayCurrency)} short`}
      </span>
      {!row.isPaid && (
        <>
          <input
            type="text"
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            placeholder={String(Math.max(0, row.shortfall || row.due))}
            style={{
              width: 100,
              padding: '4px 6px',
              fontSize: 12,
              border: '1px solid var(--border)',
              borderRadius: 4,
            }}
          />
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              onPay(draft || String(Math.max(0, row.shortfall || row.due)))
            }
            style={{
              padding: '4px 10px',
              fontSize: 11,
              background: 'var(--accent)',
              color: 'var(--canvas)',
              border: 'none',
              borderRadius: 4,
              cursor: pending ? 'wait' : 'pointer',
              fontWeight: 600,
            }}
          >
            Mark paid
          </button>
        </>
      )}
    </li>
  );
}
