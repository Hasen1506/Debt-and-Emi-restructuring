'use client';

// Split out of app/profile/ProfileClient.tsx by scripts/split-profile-client.cjs
// (Audit 80 E15). Moved verbatim; edit here, not in ProfileClient.

import { Field } from '@/components/ToolPrimitives';
import type { Country, LoanPayload } from '@/lib/api';
import { loanCurrency } from '@/lib/currency';
import { explainMinPayment } from '@/lib/min-payment';
import { formatCurrency } from '@/lib/api';
import { deriveTenureMonths } from '@/lib/derived';
import { emiBelowInterest } from '@/lib/loan-gaps';

/**
 * Optional hike-schedule editor for users who want varied hike rates over
 * the simulation horizon.
 *
 * Default state is empty (uses the scalar `annual_hike_rate` uniformly).
 * Click "Add hike phase" → expands with a row of {Years X-Y, Rate}. Engine
 * picks the first phase that covers a given firing year; if no phase matches
 * for a year, it falls back to `annual_hike_rate`.
 *
 * The editor performs minimal validation: warns visually if year ranges
 * overlap or are inverted (year_to ≤ year_from). The buildUser save path
 * filters out invalid rows so a slightly-misconfigured editor doesn't
 * break the engine call.
 *
 * Year semantics: 1-based, "from" inclusive, "to" exclusive. So {1, 3, 0.07}
 * means rate 7% applies to the hike events firing in years 1 and 2 — i.e.
 * the first two annual hikes get this rate.
 */
export function HikeScheduleEditor({
  phases,
  onChange,
  fallbackRate,
}: {
  phases: { from: string; to: string; rate: string }[];
  onChange: (next: { from: string; to: string; rate: string }[]) => void;
  /** The scalar annual_hike_rate that applies outside any phase. Shown
   *  in the helper text so users know what gets used in the gaps. */
  fallbackRate: string;
}) {
  function add() {
    // Auto-suggest year ranges that extend the last phase, so a quick
    // "add another" flow doesn't need the user to think about indices.
    const lastTo = phases.length > 0 ? Number(phases[phases.length - 1].to) : 1;
    onChange([
      ...phases,
      { from: String(lastTo), to: String(lastTo + 2), rate: '' },
    ]);
  }
  function update(idx: number, patch: Partial<{ from: string; to: string; rate: string }>) {
    onChange(phases.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
  function remove(idx: number) {
    onChange(phases.filter((_, i) => i !== idx));
  }

  // Flag overlaps / inversions to surface problems in red.
  const issues = phases.map((p, i) => {
    const from = Number(p.from);
    const to = Number(p.to);
    if (!Number.isFinite(from) || from < 1) return 'year-from must be ≥ 1';
    if (!Number.isFinite(to) || to <= from) return 'year-to must be > year-from';
    for (let j = 0; j < phases.length; j++) {
      if (i === j) continue;
      const other = phases[j];
      const oFrom = Number(other.from);
      const oTo = Number(other.to);
      if (Number.isFinite(oFrom) && Number.isFinite(oTo)
          && oFrom < to && from < oTo) {
        return `overlaps row ${j + 1}`;
      }
    }
    return null;
  });

  // Detect gaps between adjacent phases. A "gap" is a year that's not
  // covered by any phase, sitting BETWEEN configured phases (we don't
  // warn about years after the last phase — those are explicitly handled
  // by the fallback rate). Reports as a flat list of year ranges so the
  // user can decide whether to fill the gap or accept the fallback.
  const gapsWarning: string | null = (() => {
    if (phases.length === 0) return null;
    const valid = phases
      .map((p) => ({ from: Number(p.from), to: Number(p.to) }))
      .filter((p) => Number.isFinite(p.from) && Number.isFinite(p.to)
                  && p.from >= 1 && p.to > p.from)
      .sort((a, b) => a.from - b.from);
    if (valid.length < 2) return null;
    const gapRanges: string[] = [];
    for (let i = 1; i < valid.length; i++) {
      const prev = valid[i - 1];
      const cur = valid[i];
      if (prev.to < cur.from) {
        // Years [prev.to, cur.from-1] are uncovered. Inclusive labels.
        const lo = prev.to;
        const hi = cur.from - 1;
        gapRanges.push(lo === hi ? `Y${lo}` : `Y${lo}-${hi}`);
      }
    }
    if (gapRanges.length === 0) return null;
    const rate = fallbackRate || '0';
    return `Gaps: ${gapRanges.join(', ')} fall back to ${rate || '0'}.`;
  })();

  return (
    <div
      style={{
        marginTop: 4,
        padding: '10px 12px',
        background: 'var(--canvas)',
        border: '1px dashed var(--border)',
        borderRadius: 6,
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 6,
        }}
      >
        <strong style={{ color: 'var(--ink)' }}>
          Different rises by year (optional)
        </strong>
        <button
          type="button"
          onClick={add}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--accent)',
            padding: 0,
            fontSize: 11,
            letterSpacing: '0.04em',
            textDecoration: 'underline',
            cursor: 'pointer',
          }}
        >
          + Add a period
        </button>
      </div>
      <div style={{ color: 'var(--muted)', marginBottom: 8 }}>
        Use this if you expect different hike rates across the plan — e.g.
        "7% for the first 2 years, then 10% after a likely job switch."
        Years outside a phase use the yearly rise above
        ({fallbackRate || '0'}%).
      </div>
      {phases.length === 0 && (
        <div style={{ color: 'var(--muted)', fontStyle: 'italic', fontSize: 11 }}>
          None added: the plan uses the yearly rise above for every year.
        </div>
      )}
      {phases.map((p, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: '60px 60px 100px 1fr auto',
            gap: 8,
            alignItems: 'center',
            marginBottom: 6,
          }}
        >
          <input
            type="number"
            min={1}
            value={p.from}
            onChange={(e) => update(i, { from: e.target.value })}
            placeholder="from"
            style={{
              padding: '4px 6px',
              border: '1px solid var(--border)',
              borderRadius: 4,
              fontSize: 12,
              fontFamily: 'inherit',
            }}
          />
          <input
            type="number"
            min={1}
            value={p.to}
            onChange={(e) => update(i, { to: e.target.value })}
            placeholder="to"
            style={{
              padding: '4px 6px',
              border: '1px solid var(--border)',
              borderRadius: 4,
              fontSize: 12,
              fontFamily: 'inherit',
            }}
          />
          <input
            type="text"
            value={p.rate}
            onChange={(e) => update(i, { rate: e.target.value })}
            placeholder="0.10"
            style={{
              padding: '4px 6px',
              border: '1px solid var(--border)',
              borderRadius: 4,
              fontSize: 12,
              fontFamily: 'inherit',
            }}
          />
          <span
            style={{
              color: issues[i] ? 'var(--negative)' : 'var(--muted)',
              fontSize: 11,
            }}
          >
            {issues[i]
              ? issues[i]
              : `years ${p.from || '?'}–${
                  Number(p.to) > 0 ? Number(p.to) - 1 : '?'
                } @ ${p.rate ? `${(Number(p.rate) * 100).toFixed(1)}%` : '?'}`}
          </span>
          <button
            type="button"
            onClick={() => remove(i)}
            aria-label={`Remove phase ${i + 1}`}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--muted)',
              cursor: 'pointer',
              padding: '0 4px',
              fontSize: 14,
            }}
          >
            ×
          </button>
        </div>
      ))}
      {gapsWarning && (
        <div
          style={{
            marginTop: 8,
            padding: '6px 8px',
            background: 'var(--soft-bg, rgba(255,180,0,0.08))',
            borderLeft: '2px solid var(--warning)',
            fontSize: 11,
            color: 'var(--ink)',
          }}
        >
          {gapsWarning} Add a phase to cover them, or leave as-is to use
          the fallback rate.
        </div>
      )}
    </div>
  );
}

export function TenureField({
  loan,
  manualMode,
  onChangeTenure,
  onSetManual,
  country,
}: {
  country?: string;
  loan: LoanPayload;
  manualMode: boolean;
  onChangeTenure: (v: string) => void;
  onSetManual: (manual: boolean) => void;
}) {
  // Credit cards revolve — no fixed tenure to ask for or derive.
  if (loan.loan_type === 'credit_card') {
    return (
      <div>
        <label
          style={{
            display: 'block',
            fontSize: 11,
            color: 'var(--muted)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 6,
          }}
        >
          Tenure
        </label>
        <div
          style={{
            fontSize: 13,
            color: 'var(--muted)',
            lineHeight: 1.5,
            padding: '8px 10px',
            border: '1px dashed var(--border)',
            background: 'var(--soft-bg)',
          }}
        >
          A card has no end date: it runs until it&apos;s cleared. Plan
          shows how many months that takes at what you pay.
        </div>
      </div>
    );
  }

  const derived = deriveTenureMonths(
    loan.outstanding,
    loan.nominal_rate,
    loan.scheduled_emi,
  );

  if (manualMode) {
    return (
      <div>
        <Field
          label="Tenure remaining (months)"
          value={String(loan.tenure_months_remaining)}
          onChange={onChangeTenure}
          kind="integer"
          hint={
            derived != null
              ? `Worked out from the balance, EMI and rate: about ${derived} mo`
              : 'Add the rate, EMI and balance above to work it out'
          }
          info={
            <>
              How many monthly EMIs are left until this loan is fully paid.
              <br />
              <br />
              You&apos;re typing it in. If you don&apos;t know it, let the
              app work it out from the balance, EMI and rate.
            </>
          }
        />
        <button
          type="button"
          onClick={() => onSetManual(false)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--accent)',
            padding: 0,
            marginTop: 4,
            fontSize: 11,
            letterSpacing: '0.04em',
            textDecoration: 'underline',
            cursor: 'pointer',
          }}
        >
          Work it out for me
        </button>
      </div>
    );
  }

  return (
    <div>
      <label
        style={{
          display: 'block',
          fontSize: 11,
          color: 'var(--muted)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 6,
        }}
      >
        Tenure remaining
      </label>
      <div
        style={{
          fontSize: 13,
          color: derived == null ? 'var(--muted)' : 'var(--ink)',
          lineHeight: 1.5,
          padding: '8px 10px',
          border: '1px dashed var(--border)',
          background: 'var(--soft-bg)',
          minHeight: 38,
        }}
      >
        {derived != null ? (
          <>
            ≈ <strong>{derived}</strong> months at this EMI
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              Worked out from the balance, rate and EMI above.
            </div>
          </>
        ) : emiBelowInterest(loan, country) ? (
          <span role="alert" style={{ color: 'var(--negative)' }}>
            {emiBelowInterest(loan, country)}
          </span>
        ) : (
          <>
            <em>Fill in the balance, rate and EMI above</em> and the months
            left are worked out for you.
          </>
        )}
      </div>
      <button
        type="button"
        onClick={() => onSetManual(true)}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--accent)',
          padding: 0,
          marginTop: 4,
          fontSize: 11,
          letterSpacing: '0.04em',
          textDecoration: 'underline',
          cursor: 'pointer',
        }}
      >
        Set manually instead
      </button>
    </div>
  );
}

export function MinPaymentExplainer({
  loan,
  country,
  onOverrideChange,
}: {
  loan: LoanPayload;
  country: Country;
  onOverrideChange: (value: string) => void;
}) {
  // The card's own currency, not the profile's: an NRI's rupee card kept
  // a "$2,250.00" placeholder after its currency was set to INR (QA #17).
  const currency = loanCurrency(loan, country);
  const ruleCountry: Country = currency === 'INR' ? 'IN' : currency === 'USD' ? 'US' : country;
  const explanation = explainMinPayment(loan, ruleCountry);
  if (!explanation) return null;
  const estimatedLabel = formatCurrency(explanation.estimated, currency);
  return (
    <div
      style={{
        padding: 12,
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        fontSize: 13,
        lineHeight: 1.55,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 11,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--muted)',
            marginBottom: 4,
          }}
        >
          Minimum payment
        </div>
        <div>
          {explanation.source === 'bank' ? (
            <>
              <strong>{explanation.bank}</strong> asks for{' '}
              <em>{explanation.formula}</em>: about{' '}
              <strong>{estimatedLabel}</strong> a month at today&apos;s
              balance. The plan always pays at least this.
            </>
          ) : (
            <>
              {explanation.bank ? (
                <>
                  No rule on file for <strong>{explanation.bank}</strong>, so
                  the usual one:{' '}
                </>
              ) : (
                <>With no bank picked, the usual rule: </>
              )}
              <em>{explanation.formula}</em>. That&apos;s about{' '}
              <strong>{estimatedLabel}</strong> a month at today&apos;s
              balance; the plan pays at least this unless you enter your
              statement&apos;s figure below.
            </>
          )}
        </div>
      </div>
      <Field
        label="Minimum on your statement (optional)"
        kind="money"
        currency={loanCurrency(loan, country)}
        placeholder={estimatedLabel}
        value={loan.min_payment_override ?? ''}
        onChange={onOverrideChange}
        hint={
          loan.min_payment_override
            ? `Replaces the ${estimatedLabel} estimate above.`
            : 'Blank: the rule above'
        }
      />
    </div>
  );
}
