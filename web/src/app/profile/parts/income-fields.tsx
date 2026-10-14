'use client';

// Split out of app/profile/ProfileClient.tsx by scripts/split-profile-client.cjs
// (Audit 80 E15). Moved verbatim; edit here, not in ProfileClient.

import { assumptionError } from '@/lib/r8-inputs';
import { Field, Select } from '@/components/ToolPrimitives';
import type { Country, FilingStatusUS, IncomeType, TaxRegimeIN } from '@/lib/api';
import { employerTaxPhrase, untaxedIncomeLabel } from '@/lib/payroll-labels';
import { formatCurrency } from '@/lib/api';
import { classifyBracket, computeAnnualTax, describeBracket, isAdvanceTaxApplicable } from '@/lib/tax-brackets';

/**
 * Optional annual gross-income input + live tax bracket display.
 *
 * For salaried users we ask for Form-16 line-1 gross (pre-tax, after CTC
 * stripping of employer PF / gratuity / insurance). For SE we ask for
 * ITR-3/4 Total Income. The label and tooltip adapt to income_type.
 *
 * When the user types a value, we live-classify the bracket and surface
 * three things: marginal rate, distance to the next bracket, and projected
 * annual tax (with India regime + cess + 87A rebate applied). For SE
 * users with a high enough tax liability, also nudge them about Sec 208
 * advance tax / Form 1040-ES so they know it's coming.
 *
 * Everything here is advisory — leaving the field blank does not block
 * setup; downstream calls fall back to the manual marginal_rate field.
 */
function GrossIncomeField({
  incomeType,
  country,
  taxRegime,
  filingStatus,
  stateMarginalRate,
  value,
  onChange,
}: {
  incomeType: IncomeType;
  country: Country;
  taxRegime: TaxRegimeIN;
  filingStatus?: FilingStatusUS;
  /** US-only — added to federal bracket rate for the combined-marginal
   *  display. Pure display here; the actual combination happens at save(). */
  stateMarginalRate?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const gross = Number(value || 0);
  const bracket =
    gross > 0 ? classifyBracket(country, taxRegime, incomeType, gross, filingStatus) : null;
  const annualTax =
    gross > 0 ? computeAnnualTax(country, taxRegime, incomeType, gross, filingStatus) : null;
  const advanceTaxApplies =
    annualTax != null
      ? isAdvanceTaxApplicable(country, incomeType, annualTax)
      : false;
  const ccy: 'INR' | 'USD' = country === 'IN' ? 'INR' : 'USD';

  const label =
    incomeType === 'salaried'
      ? `Annual gross salary (${country === 'IN' ? '₹' : '$'}, optional)`
      : `Annual business income (${country === 'IN' ? '₹' : '$'}, optional)`;

  const hint =
    incomeType === 'salaried'
      ? country === 'IN'
        ? 'Form 16 line 1 — gross before TDS, after CTC minus employer PF / gratuity / insurance'
        : 'W-2 box 1 — gross wages before federal / state tax + 401(k)'
      : country === 'IN'
        ? 'ITR Total Income — revenue − business expenses − depreciation'
        : 'Net business income — gross receipts − Schedule C deductions';

  return (
    <div>
      <Field
        label={label}
        kind="money"
        currency={ccy}
        value={value}
        onChange={onChange}
        hint={hint}
        info={
          <>
            {incomeType === 'salaried' ? (
              <>
                Your <strong>pre-tax annual salary</strong>. This is the gross
                figure from Form 16 line 1 ({country === 'IN' ? 'India' : 'or W-2 box 1 in the US'}),
                not your CTC. CTC includes employer PF, gratuity, and
                insurance — none of those reach you, so we strip them.
                {country === 'IN' && (
                  <>
                    <br />
                    <br />
                    <strong>Quick jargon:</strong>{' '}
                    <strong>TDS</strong> = tax your employer withholds monthly.{' '}
                    <strong>Form 12BB / declared deductions</strong> = the
                    investments you tell your employer in April that you{' '}
                    <em>plan</em> to make this year (PPF, ELSS, life insurance,
                    NPS — collectively <strong>80C</strong>, capped at ₹1.5 lakh)
                    so they withhold less TDS. If you under-invest vs declared,
                    they claw it back from Jan-Feb paychecks; if you over-invest,
                    you claim a refund via ITR in July.
                  </>
                )}
              </>
            ) : (
              <>
                Your <strong>Total Income</strong> from last filed{' '}
                {country === 'IN' ? 'ITR-3 / ITR-4' : 'Schedule C'} — revenue
                minus business expenses (and depreciation in India). This is
                the number that goes through tax slabs.
                {country === 'IN' && (
                  <>
                    <br />
                    <br />
                    <strong>Heads up:</strong> for business / freelance income
                    there's no TDS — you pay <strong>advance tax</strong>{' '}
                    quarterly (15% by Jun 15, 45% by Sep 15, 75% by Dec 15, 100%
                    by Mar 15). Missing it costs 1%/month penal interest.
                  </>
                )}
              </>
            )}
            <br />
            <br />
            <strong>Optional.</strong> Leave blank if you only know take-home;
            we'll use the marginal-rate field below instead. When filled,
            we'll auto-show your tax bracket and (for SE users) advance-tax
            reminders.
          </>
        }
      />
      {bracket && annualTax && (
        <div
          style={{
            marginTop: 6,
            padding: '8px 10px',
            background: 'var(--canvas)',
            border: '1px dashed var(--border)',
            borderRadius: 6,
            fontSize: 'var(--fs-dense)',
            lineHeight: 1.5,
            color: 'var(--ink)',
          }}
        >
          <div>
            You're in the{' '}
            <strong>{describeBracket(bracket, country)}</strong>
            {country === 'US' && stateMarginalRate && Number(stateMarginalRate) > 0 && (
              <>
                {' '}· combined with state{' '}
                <strong>
                  {(
                    (bracket.marginalRate + Number(stateMarginalRate)) * 100
                  ).toFixed(1)}
                  %
                </strong>{' '}
                combined marginal
              </>
            )}
            .
          </div>
          <div style={{ color: 'var(--muted)', marginTop: 2 }}>
            Projected annual tax:{' '}
            <strong style={{ color: 'var(--ink)' }}>
              {formatCurrency(annualTax.toFixed(0), ccy)}
            </strong>
            {bracket.headroom !== Infinity && (
              <>
                {' '}· next bracket at{' '}
                {formatCurrency(bracket.upperBound, ccy)}{' '}
                <span style={{ opacity: 0.7 }}>
                  (headroom {formatCurrency(bracket.headroom, ccy)})
                </span>
              </>
            )}
          </div>
          {country === 'IN' && (
            <div style={{ color: 'var(--muted)', marginTop: 2, fontSize: 'var(--fs-small)' }}>
              Computed under{' '}
              <strong>{taxRegime === 'old' ? 'old' : 'new'} regime</strong>
              {taxRegime !== 'old' && (
                <> · rebate u/s 87A keeps taxable income ≤ ₹12 lakh tax-free</>
              )}
            </div>
          )}
          {advanceTaxApplies && (
            <div
              style={{
                marginTop: 6,
                padding: '6px 8px',
                background: 'var(--soft-bg, rgba(255,180,0,0.08))',
                borderLeft: '2px solid var(--warning)',
                fontSize: 'var(--fs-small)',
                color: 'var(--ink)',
              }}
            >
              <strong>Heads up:</strong>{' '}
              {country === 'IN'
                ? 'tax > ₹10k means Section 208 quarterly advance tax applies (due 15 Jun / 15 Sep / 15 Dec / 15 Mar). Missing instalments costs ~1%/month in Sec 234C interest.'
                : 'owing > $1k means Form 1040-ES quarterly estimated tax applies (Apr 15 / Jun 15 / Sep 15 / Jan 15). Underpayment costs ~8% APR.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Advanced-tax disclosure: filing status, state marginal rate, gross
 * income, and non-TDS tax. Hidden behind a "+ Advanced: tax details"
 * expander so first-time setup is just "take-home + expenses". Auto-
 * expanded when ANY of the wrapped fields already has a value (e.g. user
 * coming back via Edit profile, or stored profile carrying tax info).
 *
 * All fields are optional from the engine's perspective — leaving them
 * blank means we don't try to derive marginal rate from gross slabs;
 * the manual marginal-rate field at the bottom of step 2 fills in.
 */
export function AdvancedTaxDetails({
  country,
  incomeType,
  taxRegime,
  filingStatus,
  stateMarginalRate,
  annualGrossSalary,
  annualBusinessIncome,
  extraIncomeAnnualTax,
  onFilingStatusChange,
  onStateMarginalRateChange,
  onAnnualGrossSalaryChange,
  onAnnualBusinessIncomeChange,
  onExtraIncomeAnnualTaxChange,
}: {
  country: Country;
  incomeType: IncomeType;
  taxRegime: TaxRegimeIN;
  filingStatus: FilingStatusUS;
  stateMarginalRate: string;
  annualGrossSalary: string;
  annualBusinessIncome: string;
  extraIncomeAnnualTax: string;
  onFilingStatusChange: (v: FilingStatusUS) => void;
  onStateMarginalRateChange: (v: string) => void;
  onAnnualGrossSalaryChange: (v: string) => void;
  onAnnualBusinessIncomeChange: (v: string) => void;
  onExtraIncomeAnnualTaxChange: (v: string) => void;
}) {
  // Auto-expand when any wrapped field has a non-empty / non-default value.
  // A returning user shouldn't have to hunt for where their stored numbers
  // live; if they previously filled the gross slab, surface it immediately.
  const hasGross =
    incomeType === 'salaried'
      ? Number(annualGrossSalary || 0) > 0
      : Number(annualBusinessIncome || 0) > 0;
  const hasExtraTax = Number(extraIncomeAnnualTax || 0) > 0;
  const hasState = Number(stateMarginalRate || 0) > 0;
  const defaultOpen = hasGross || hasExtraTax || hasState;

  return (
    <details open={defaultOpen}>
      <summary
        style={{
          cursor: 'pointer',
          fontSize: 'var(--fs-dense)',
          color: 'var(--accent)',
          padding: '6px 0',
          letterSpacing: '0.02em',
        }}
      >
        + More: tax details (your tax rate, advance tax)
      </summary>
      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
          marginTop: 10,
          padding: '10px 12px',
          border: '1px dashed var(--border)',
          borderRadius: 6,
        }}
      >
        <div style={{ gridColumn: '1 / -1', fontSize: 'var(--fs-dense)', color: 'var(--muted)', lineHeight: 1.55 }}>
          Optional. Leave blank if you just want a plan from your take-home —
          the engine will use the manual marginal-rate field at the bottom of
          this step. Fill these to get the tax-sleeve card, deduction
          projections, and a derived marginal rate based on your actual slab.
        </div>
        {country === 'US' && (
          <>
            <Select
              label="Filing status"
              value={filingStatus}
              onChange={onFilingStatusChange}
              options={[
                { value: 'single' as FilingStatusUS, label: 'Single' },
                { value: 'mfj' as FilingStatusUS, label: 'Married, filing jointly' },
                { value: 'hoh' as FilingStatusUS, label: 'Head of household' },
              ]}
              info={
                <>
                  Drives which IRS slab table applies to your federal income.{' '}
                  <strong>MFJ</strong> doubles the single-filer slabs;{' '}
                  <strong>HoH</strong> sits between single and MFJ in the lower
                  brackets, merges with single at the top.
                </>
              }
            />
            <Field
              label="State marginal rate (%, optional)"
              kind="percent"
              value={stateMarginalRate}
              onChange={onStateMarginalRateChange}
              error={assumptionError('tax', stateMarginalRate)}
              hint="e.g. 6.82 for CA top, 0 for TX/FL/WA"
              info={
                <>
                  Your <strong>state income tax</strong> marginal rate, as a
                  percent. Added on top of federal marginal_rate when computing
                  tax savings on deductible interest. Leave blank for states
                  with no income tax (TX, FL, WA, NV, TN, AK, SD, WY, NH).
                </>
              }
            />
          </>
        )}
        <div style={{ gridColumn: '1 / -1' }}>
          <GrossIncomeField
            incomeType={incomeType}
            country={country}
            taxRegime={taxRegime}
            filingStatus={country === 'US' ? filingStatus : undefined}
            stateMarginalRate={country === 'US' ? stateMarginalRate : undefined}
            value={
              incomeType === 'salaried' ? annualGrossSalary : annualBusinessIncome
            }
            onChange={
              incomeType === 'salaried'
                ? onAnnualGrossSalaryChange
                : onAnnualBusinessIncomeChange
            }
          />
        </div>
        {incomeType === 'salaried' && (
          <div style={{ gridColumn: '1 / -1' }}>
            <Field
              label={untaxedIncomeLabel(country)}
              kind="money"
              currency={country === 'IN' ? 'INR' : 'USD'}
              value={extraIncomeAnnualTax}
              onChange={onExtraIncomeAnnualTaxChange}
              hint="Skip if all your income is salary. Otherwise: rough estimate of tax you owe on rental, interest, gains, or freelance."
              info={
                <>
                  <strong>Most salaried users leave this blank.</strong>{' '}
                  {employerTaxPhrase(country)}
                  <br />
                  <br />
                  Fill only if you have income <strong>outside salary</strong>:
                  rental, FD interest above{' '}
                  {country === 'IN' ? '₹40k' : '$10'}, capital gains, freelance
                  side-income.
                  <br />
                  <br />
                  When it's more than 0, What you own shows the next
                  advance-tax date.
                </>
              }
            />
          </div>
        )}
      </div>
    </details>
  );
}
