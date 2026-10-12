'use client';

/**
 * Deductions sub-panel within onboarding step 2 (Income).
 *
 * Conditionally rendered:
 *   • IN + tax_regime === 'old' → renders the 80C / 80D / 80E / HRA fields.
 *   • US (any filing status) → renders the itemize-vs-standard fields.
 *
 * Updates the parent's `deductions` slice as the user types. The parent
 * persists this through saveProfileClient; engine math is unaffected
 * today (engine still consumes a flat marginal_rate), but the derived
 * marginal-rate preview below shows the user the *effect* of their
 * deductions on the bracket.
 */

import { SALT_CAP_COPY } from '@/lib/us-loans';
import { useMemo } from 'react';
import type {
  AgeBracket,
  Country,
  DeductionsPayload,
  FilingStatusUS,
  IncomeType,
  TaxRegimeIN,
} from '@/lib/api';
import {
  deriveMarginalRate,
  pickUSDeduction,
  summariseDeductions,
} from '@/lib/deductions';
import { Field, InfoTip } from '@/components/ToolPrimitives';

type Setter = (next: DeductionsPayload) => void;

interface Props {
  country: Country;
  taxRegime?: TaxRegimeIN;
  filingStatus?: FilingStatusUS;
  ageBracket?: AgeBracket;
  /** Salaried vs business-owner — gates the IN standard deduction. */
  incomeType?: IncomeType;
  /** User's gross annual salary (or business income); used only for the
   *  derived-marginal preview. */
  grossAnnual?: string;
  /** State marginal rate on the parent's payload (US default). */
  stateMarginalRate?: string;
  value: DeductionsPayload | undefined;
  onChange: Setter;
}

export function DeductionsPanel({
  country,
  taxRegime,
  filingStatus,
  ageBracket,
  incomeType,
  grossAnnual,
  stateMarginalRate,
  value,
  onChange,
}: Props) {
  const visible = country === 'US' || (country === 'IN' && taxRegime === 'old');
  const ded = useMemo<DeductionsPayload>(() => value ?? {}, [value]);
  const update = (patch: Partial<DeductionsPayload>) =>
    onChange({ ...ded, ...patch });

  const summary = useMemo(
    () => summariseDeductions(ded, country, taxRegime, ageBracket, incomeType),
    [ded, country, taxRegime, ageBracket, incomeType],
  );
  const derived = useMemo(
    () =>
      deriveMarginalRate({
        grossAnnual,
        country,
        taxRegime,
        filingStatus,
        deductions: ded,
        ageBracket,
        incomeType,
        stateMarginalRate,
      }),
    [grossAnnual, country, taxRegime, filingStatus, ded, ageBracket, incomeType, stateMarginalRate],
  );
  const usPick = useMemo(
    () => (country === 'US' ? pickUSDeduction(ded, filingStatus) : null),
    [country, filingStatus, ded],
  );

  if (!visible) return null;

  const ccySym = country === 'IN' ? '₹' : '$';
  const ccy = country === 'IN' ? 'INR' : 'USD';

  return (
    <div
      style={{
        padding: 14,
        border: '1px solid var(--border)',
        background: 'var(--soft-bg)',
        borderRadius: 8,
        borderLeft: '3px solid var(--accent)',
        marginTop: 12,
      }}
    >
      <div
        style={{
          fontWeight: 600,
          fontSize: 14,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {country === 'IN' ? 'Old-regime deductions' : 'Itemized deductions'}
        <InfoTip>
          {country === 'IN' ? (
            <>
              <strong>Old regime only.</strong> If you&apos;ve switched to the
              new regime, leave these blank — new regime trades deductions
              for cleaner slabs.
              <div style={{ marginTop: 8 }}>
                <strong>How they help.</strong> Each rupee of deduction reduces
                your taxable income, which can drop you into a lower bracket.
                The derived marginal rate below updates as you type.
              </div>
              <div style={{ marginTop: 8 }}>
                Home-loan interest under section 24b is captured per-loan
                (rate, outstanding, property use) — don&apos;t double-count
                it here.
              </div>
            </>
          ) : (
            <>
              <strong>Itemize-vs-standard auto-switch.</strong> If your
              mortgage interest + other itemized beats the standard deduction
              for your filing status, we use the itemized total. Otherwise
              the standard wins automatically — no penalty for filling these in.
              <div style={{ marginTop: 8 }}>
                <strong>SALT cap.</strong> {SALT_CAP_COPY} Apply it
                yourself before entering, we trust the input.
              </div>
            </>
          )}
        </InfoTip>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        {country === 'IN'
          ? 'All annual rupees. We apply statutory caps (1.5L on 80C, etc.) below.'
          : 'All annual dollars. We compare to the standard deduction for your filing status.'}
      </div>

      {country === 'IN' && (
        <div
          style={{
            marginTop: 12,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 12,
          }}
        >
          <Field
            label={`HRA exemption claimed (${ccySym}/yr)`}
            kind="money"
            currency={ccy}
            value={ded.hra_claim_annual ?? ''}
            onChange={(v) => update({ hra_claim_annual: v || undefined })}
            hint="Post-cap claim — what you'd enter on ITR"
            info={
              <>
                Enter the <strong>final HRA exemption</strong> after the
                least-of-three rule (actual HRA / rent − 10% basic / 50% basic
                for metros). If you don&apos;t want to compute it, leave
                blank — it&apos;ll just show as zero on the breakdown.
              </>
            }
          />
          <Field
            label={`Rent actually paid (${ccySym}/yr, optional)`}
            kind="money"
            currency={ccy}
            value={ded.rent_paid_annual ?? ''}
            onChange={(v) => update({ rent_paid_annual: v || undefined })}
            hint="Sanity check — HRA claim shouldn't exceed rent"
            info={
              <>
                Not used in the math directly. We surface it as a sanity
                check on the HRA claim above.
              </>
            }
          />
          <Field
            label={`80C investments (${ccySym}/yr)`}
            kind="money"
            currency={ccy}
            value={ded.sec_80c_annual ?? ''}
            onChange={(v) => update({ sec_80c_annual: v || undefined })}
            hint="PPF, ELSS, life premium, principal repayment — capped at ₹1.5L"
            info={
              <>
                Sum of <strong>PPF + ELSS + life-insurance premium + home-loan
                principal repayment + 5-yr FD + NSC + ULIP + Sukanya</strong>.
                We cap at ₹1.5L at compute time, so entering more is harmless
                — the excess simply isn&apos;t deducted.
              </>
            }
          />
          <Field
            label={`80D health insurance (${ccySym}/yr)`}
            kind="money"
            currency={ccy}
            value={ded.sec_80d_annual ?? ''}
            onChange={(v) => update({ sec_80d_annual: v || undefined })}
            hint="₹25k cap (₹50k if you're 60+)"
            info={
              <>
                Premiums paid for self + family + parents. Default cap is
                ₹25k; we apply the senior-citizen ₹50k cap automatically if
                your age bracket is 50+.
              </>
            }
          />
          <Field
            label={`80E education-loan interest (${ccySym}/yr)`}
            kind="money"
            currency={ccy}
            value={ded.sec_80e_annual ?? ''}
            onChange={(v) => update({ sec_80e_annual: v || undefined })}
            hint="No cap; first 8 years of repayment only"
            info={
              <>
                Interest on education loans is fully deductible for up to 8
                years from when repayment started. The principal isn&apos;t
                deductible.
              </>
            }
          />
          <Field
            label={`80CCD(1B) NPS top-up (${ccySym}/yr)`}
            kind="money"
            currency={ccy}
            value={ded.sec_80ccd1b_annual ?? ''}
            onChange={(v) => update({ sec_80ccd1b_annual: v || undefined })}
            hint="Up to ₹50k on top of 80C"
            info={
              <>
                Additional NPS deduction <em>over and above</em> the ₹1.5L 80C
                cap — for retail investors this is the main reason to hold
                NPS Tier 1.
              </>
            }
          />
        </div>
      )}

      {country === 'US' && (
        <div
          style={{
            marginTop: 12,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 12,
          }}
        >
          <Field
            label={`Mortgage interest (${ccySym}/yr)`}
            kind="money"
            currency={ccy}
            value={ded.mortgage_interest_annual ?? ''}
            onChange={(v) =>
              update({ mortgage_interest_annual: v || undefined })
            }
            hint="From Form 1098, box 1"
            info={
              <>
                Deductible under IRC §163. Use the figure from your lender&apos;s
                Form 1098 (box 1). For loans before Dec 2017, the cap is $1M;
                after Dec 2017, $750k of debt principal.
              </>
            }
          />
          <Field
            label={`Other itemized (SALT + charity + etc., ${ccySym}/yr)`}
            kind="money"
            currency={ccy}
            value={ded.itemized_deductions_other ?? ''}
            onChange={(v) =>
              update({ itemized_deductions_other: v || undefined })
            }
            hint="Sum of state/local tax (capped at $40,400 for 2026), charity, medical (>7.5% AGI)"
            info={
              <>
                <strong>SALT cap.</strong> {SALT_CAP_COPY} Apply the cap
                yourself before entering. Add charity + qualified medical (over 7.5%
                of AGI) here too.
              </>
            }
          />
          <Field
            label="State marginal rate override (%)"
            value={ded.state_marginal_rate_override ?? ''}
            onChange={(v) =>
              update({ state_marginal_rate_override: v || undefined })
            }
            hint="Decimal (0.05 = 5%); leave blank to use the default"
            info={
              <>
                Default state rate is auto-picked from your state field at
                onboarding. Override here if your bracket differs (e.g.
                California's 9.3%+ at higher incomes).
              </>
            }
          />
        </div>
      )}

      {/* Live breakdown */}
      {(summary.lines.length > 0 || (country === 'US' && usPick && usPick.uses === 'standard')) && (
        <div
          style={{
            marginTop: 14,
            padding: '10px 12px',
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: 'var(--muted-ink)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 6,
            }}
          >
            Deduction breakdown
          </div>
          {country === 'US' && usPick && (
            <div
              style={{
                marginBottom: 6,
                color:
                  usPick.uses === 'itemized'
                    ? 'var(--positive)'
                    : 'var(--muted-ink)',
              }}
            >
              Using <strong>{usPick.uses}</strong> deduction —{' '}
              {ccySym}
              {(usPick.uses === 'itemized'
                ? usPick.itemized
                : usPick.standard
              ).toFixed(0)}
              . {usPick.uses === 'standard' && (
                <>
                  Itemized total {ccySym}
                  {usPick.itemized.toFixed(0)} doesn&apos;t beat the standard
                  deduction for your filing status.
                </>
              )}
            </div>
          )}
          {summary.lines.map((l) => (
            <div
              key={l.label}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
            >
              <span>{l.label}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {ccySym}
                {l.allowed.toFixed(0)}
                {l.note && (
                  <span className="muted" style={{ marginLeft: 6 }}>
                    · {l.note}
                  </span>
                )}
              </span>
            </div>
          ))}
          {summary.lines.length > 1 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                marginTop: 4,
                paddingTop: 4,
                borderTop: '1px solid var(--border)',
                fontWeight: 600,
              }}
            >
              <span>Total allowed</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {ccySym}
                {summary.totalAllowed.toFixed(0)}
              </span>
            </div>
          )}
        </div>
      )}

      {derived != null && (
        <div
          className="muted"
          style={{
            marginTop: 10,
            fontSize: 12,
            padding: '6px 10px',
            background: 'var(--card)',
            border: '1px dashed var(--border)',
            borderRadius: 4,
          }}
        >
          With these deductions applied to your gross of{' '}
          {ccySym}
          {Number(grossAnnual || 0).toLocaleString()}, your derived marginal
          rate is roughly{' '}
          <strong style={{ color: 'var(--ink)' }}>
            {derived.mul(100).toFixed(1)}%
          </strong>
          .{' '}
          {country === 'US' && (
            <>
              (Includes federal +{' '}
              {ded.state_marginal_rate_override
                ? 'overridden state'
                : 'declared state'}{' '}
              marginal.)
            </>
          )}
          {' '}
          Marginal rate field above takes precedence if you&apos;ve set it
          manually.
        </div>
      )}
    </div>
  );
}
