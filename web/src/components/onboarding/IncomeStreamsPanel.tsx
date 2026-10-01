'use client';

/**
 * Income streams management panel.
 *
 * Captures concurrent income sources (salary + side gig) AND historical
 * transitions (salaried-to-freelance switch). Sits below the main income
 * fields in onboarding step 2; collapsed by default so users with a
 * single primary income don't see clutter.
 *
 * When at least one active stream is present, the derived monthly_income
 * (sum of active streams / 12) takes priority at save time. The legacy
 * monthly_income field stays on screen for users who'd rather not break
 * out individual streams.
 */

import { useState } from 'react';
import Decimal from 'decimal.js';
import { Field, InfoTip, Select } from '@/components/ToolPrimitives';
import type { Country, IncomeStreamPayload } from '@/lib/api';
import {
  KIND_LABELS,
  activeGrossAnnual,
  activeStreams,
  blankStream,
  defaultTaxTreatment,
  defaultTdsForKind,
  hasHistoricalTransitions,
} from '@/lib/income-streams';
import type { IncomeStreamTaxTreatment } from '@/lib/api';

const TAX_TREATMENT_LABELS: Record<IncomeStreamTaxTreatment, string> = {
  salary: 'Salary — slab',
  business_44ada: 'Business — presumptive (44ADA/44AD)',
  business_normal: 'Business — full P&L',
  rental: 'Rental — house property',
  capital_gains: 'Capital gains — flat',
};

interface Props {
  country: Country;
  value: IncomeStreamPayload[] | undefined;
  onChange: (next: IncomeStreamPayload[]) => void;
}

export function IncomeStreamsPanel({ country, value, onChange }: Props) {
  const streams = value ?? [];
  const [expanded, setExpanded] = useState(streams.length > 0);
  const active = activeStreams(streams);
  const grossActive = activeGrossAnnual(active);
  const ccySym = country === 'IN' ? '₹' : '$';
  const ccy = country === 'IN' ? 'INR' : 'USD';

  function addStream() {
    onChange([...streams, blankStream()]);
    setExpanded(true);
  }

  function updateStream(i: number, patch: Partial<IncomeStreamPayload>) {
    const next = streams.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }

  function removeStream(i: number) {
    onChange(streams.filter((_, idx) => idx !== i));
  }

  function endStream(i: number) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    updateStream(i, { end_date: `${yyyy}-${mm}` });
  }

  function reopenStream(i: number) {
    updateStream(i, { end_date: undefined });
  }

  return (
    <div
      style={{
        marginTop: 12,
        padding: 14,
        border: '1px dashed var(--border)',
        borderRadius: 8,
        background: 'var(--soft-bg)',
      }}
    >
      {/* The info tip is its own button, so it sits beside the toggle
          rather than inside it (a button can't contain a button). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: 'var(--ink)',
        }}
      >
        <span
          style={{
            fontWeight: 600,
            fontSize: 14,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          Multiple incomes or a recent transition?
          <span
            style={{
              fontSize: 11,
              color: 'var(--muted)',
              letterSpacing: '0.06em',
            }}
          >
            {streams.length === 0
              ? '· empty'
              : `· ${active.length} active${
                  hasHistoricalTransitions(streams) ? ' + history' : ''
                }`}
          </span>
        </span>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      <InfoTip>
        <strong>What this is.</strong> If you have a single salary,
        ignore this — the field above handles you. Open this panel if
        you have:
        <div style={{ marginTop: 6 }}>
          • <strong>Multiple concurrent sources</strong> (salary + freelance
          side work, salary + rental, etc.) — list them as separate streams.
        </div>
        <div style={{ marginTop: 4 }}>
          • <strong>A recent role change</strong> (salaried until June, then
          freelance) — record both, with the old one&apos;s end-date set
          to the transition month.
        </div>
        <div style={{ marginTop: 8 }}>
          <strong>How it&apos;s used.</strong> Tax sleeve recomputes from
          active streams instead of a single annual_business_income input;
          your effective monthly income comes from sum-of-active / 12.
          Historical streams stay on file so future tax-year math has
          the context.
        </div>
      </InfoTip>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {streams.length === 0 && (
            <div className="muted" style={{ fontSize: 12 }}>
              No streams on file yet. Add one to break out your income by
              source — useful for the tax sleeve and for recording a
              salaried/freelance transition.
            </div>
          )}

          {streams.map((s, i) => {
            const isClosed = !!s.end_date;
            return (
              <div
                key={s.id}
                style={{
                  padding: 12,
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  display: 'grid',
                  gap: 10,
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  opacity: isClosed ? 0.7 : 1,
                  position: 'relative',
                }}
              >
                <Select
                  label="Source kind"
                  value={s.kind}
                  onChange={(v) => {
                    const kind = v as IncomeStreamPayload['kind'];
                    updateStream(i, {
                      kind,
                      tds_pct: defaultTdsForKind(kind),
                      tax_treatment: defaultTaxTreatment(kind),
                    });
                  }}
                  options={(Object.keys(KIND_LABELS) as IncomeStreamPayload['kind'][]).map((k) => ({
                    value: k,
                    label: KIND_LABELS[k],
                  }))}
                  info={
                    <>
                      Drives the TDS default below. Salaried = 30% withheld
                      at source (you owe nothing extra). Freelance under 194J
                      = 10% withheld (you owe the gap to slab). Rental /
                      business / cap-gains = 0% withheld; you pay the full
                      tax yourself at advance-tax installments.
                    </>
                  }
                />
                <Select
                  label="Tax treatment"
                  value={s.tax_treatment ?? defaultTaxTreatment(s.kind)}
                  onChange={(v) =>
                    updateStream(i, {
                      tax_treatment: v as IncomeStreamTaxTreatment,
                    })
                  }
                  options={(Object.keys(TAX_TREATMENT_LABELS) as IncomeStreamTaxTreatment[]).map((t) => ({
                    value: t,
                    label: TAX_TREATMENT_LABELS[t],
                  }))}
                  info={
                    <>
                      How the income gets taxed. Defaulted from the source
                      kind, override when your situation differs.
                      <div style={{ marginTop: 6 }}>
                        <strong>Salary</strong> — TDS by employer, slab rates,
                        standard deduction applies.
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <strong>Business — presumptive (44ADA/44AD)</strong> —
                        For professionals (doctors, lawyers, consultants,
                        freelancers): 50% of gross deemed profit, taxed at
                        slab. Requires gross &lt; ₹50L (services) / ₹2Cr
                        (trade). No bookkeeping.
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <strong>Business — full P&L</strong> — gross −
                        allowable expenses = profit, taxed at slab. Use when
                        actual expenses exceed 50% of gross, or you breach
                        the presumptive turnover ceiling.
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <strong>Rental — house property</strong> — 30%
                        standard deduction off gross, plus home-loan
                        interest deductible separately. Net taxed at slab.
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <strong>Capital gains — flat</strong> — bypasses slab.
                        LTCG 20% with indexation (or 10% for equity above
                        ₹1L exempt). STCG: 15% for equity (STT-paid), slab
                        otherwise. Conservative 20% LTCG applied by default;
                        edit the stream&apos;s gross to reflect indexed cost
                        already if needed.
                      </div>
                    </>
                  }
                />
                <Field
                  label="Label"
                  value={s.label}
                  onChange={(v) => updateStream(i, { label: v })}
                  hint={
                    s.kind === 'salaried'
                      ? 'e.g. "Acme Co salary"'
                      : s.kind === 'rental'
                        ? 'e.g. "Pune flat"'
                        : 'Short description'
                  }
                />
                <Field
                  label={`Annual gross (${ccySym}/yr)`}
                  kind="money"
                  currency={ccy}
                  value={s.gross_annual}
                  onChange={(v) => updateStream(i, { gross_annual: v })}
                  hint="Pre-tax annual from this source alone"
                />
                <Field
                  label="TDS / withholding (%)"
                  kind="percent"
                  value={s.tds_pct ?? ''}
                  onChange={(v) => updateStream(i, { tds_pct: v })}
                  hint="30 = 30% withheld at source; 0 = you owe the full tax yourself"
                  info={
                    <>
                      The fraction of this stream&apos;s tax that&apos;s
                      withheld at source. We use it in the tax sleeve to
                      know how much liability falls on you vs the payer.
                    </>
                  }
                />
                <Field
                  label="Start date (YYYY-MM)"
                  value={s.start_date}
                  onChange={(v) => updateStream(i, { start_date: v })}
                  hint="When this stream started"
                />
                <Field
                  label="End date (YYYY-MM, blank = current)"
                  value={s.end_date ?? ''}
                  onChange={(v) =>
                    updateStream(i, { end_date: v || undefined })
                  }
                  hint="Set when the stream ended; leave blank if still active"
                />

                <div
                  style={{
                    gridColumn: '1 / -1',
                    display: 'flex',
                    gap: 8,
                    justifyContent: 'flex-end',
                    flexWrap: 'wrap',
                  }}
                >
                  {isClosed ? (
                    <button
                      type="button"
                      onClick={() => reopenStream(i)}
                      style={btnSecondary}
                    >
                      Reopen
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => endStream(i)}
                      style={btnSecondary}
                    >
                      End this stream (today)
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeStream(i)}
                    style={btnDanger}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={addStream}
            style={{
              alignSelf: 'flex-start',
              padding: '6px 12px',
              border: '1px dashed var(--border)',
              background: 'transparent',
              color: 'var(--accent)',
              borderRadius: 4,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            + Add another stream
          </button>

          {active.length > 0 && (
            <div
              style={{
                padding: '8px 12px',
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              Active gross today:{' '}
              <strong>
                {ccySym}
                {grossActive.toFixed(0)}
              </strong>{' '}
              /yr ≈{' '}
              <strong>
                {ccySym}
                {grossActive.div(12).toFixed(0)}
              </strong>
              /mo across {active.length} stream{active.length === 1 ? '' : 's'}.{' '}
              {hasHistoricalTransitions(streams) && (
                <>
                  ·{' '}
                  <span className="muted">
                    {streams.filter((s) => !!s.end_date).length} historical on file
                  </span>
                </>
              )}
              <div className="muted" style={{ marginTop: 4, fontSize: 11 }}>
                This sum overrides the single monthly_income field above
                at save time. Set end-dates on streams you&apos;ve exited
                — they stay on file for record-keeping without skewing
                today&apos;s numbers.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const btnSecondary: React.CSSProperties = {
  padding: '5px 10px',
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--accent)',
  borderRadius: 4,
  fontSize: 11,
  cursor: 'pointer',
};

const btnDanger: React.CSSProperties = {
  padding: '5px 10px',
  border: '1px solid var(--negative)',
  background: 'transparent',
  color: 'var(--negative)',
  borderRadius: 4,
  fontSize: 11,
  cursor: 'pointer',
};
