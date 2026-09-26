'use client';

/**
 * Purchase advisor — feasibility check for a planned big-ticket buy.
 *
 * Wraps `analyzePurchase` from @/lib/purchase-advisor with the
 * standard Tools form pattern: profile-driven defaults (country,
 * regime, marginal rate, surplus), explicit inputs for the things the
 * user actually controls (price, target date, down-payment %, tenure,
 * indicative rate), and a verdict header with three levers when the
 * purchase isn't comfortable on current surplus.
 *
 * Distinct from /tools/new-debt: that one models taking *an existing*
 * loan against the user's current debt picture. This one models a
 * *prospective purchase*, treating the loan + down-payment savings as
 * a single decision and gating tax benefit by regime so the user
 * isn't sold a deduction they can't claim.
 */

import { useMemo, useState } from 'react';
import { Field, InfoTip, Select } from '@/components/ToolPrimitives';
import { MonthYearPicker } from '@/components/MonthYearPicker';
import { formatCurrency } from '@/lib/api';
import { useStoredProfile } from '@/lib/use-profile';
import { userDefaultCurrency } from '@/lib/currency';
import { deriveMetrics } from '@/lib/derived';
import { summariseDeductions } from '@/lib/deductions';
import { activeSlabGrossAnnual } from '@/lib/income-streams';
import { DecisionLogControls } from '@/components/DecisionLogControls';
import {
  analyzePurchase,
  type PurchaseType,
  type PurchaseAnalysis,
} from '@/lib/purchase-advisor';
import { readGoalsClient } from '@/lib/goals';
import {
  readContributionsClient,
  totalsByGoal,
} from '@/lib/goal-contributions';
import { computeGoalSlip, materialSlips } from '@/lib/goal-slip';
import { fitColumns } from '@/lib/grid';

const TYPE_OPTIONS: { value: PurchaseType; label: string }[] = [
  { value: 'home', label: 'Home' },
  { value: 'vehicle', label: 'Vehicle (car / bike)' },
  { value: 'other', label: 'Other big-ticket' },
];

const DEFAULTS = {
  home: { downPct: '20', tenureYears: '20', rate: '8.5' },
  vehicle: { downPct: '15', tenureYears: '5', rate: '10.5' },
  other: { downPct: '25', tenureYears: '5', rate: '11.0' },
};

function nextSixMonths(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 6);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function PurchaseTool() {
  const profile = useStoredProfile();
  const country = profile.user.country as 'IN' | 'US';
  const ccy = userDefaultCurrency(country);
  const fmt = (v: number) => formatCurrency(v.toFixed(0), ccy);
  // Marginal rate comes from the profile, not a re-derivation here.
  // Onboarding already computed it with the proper gross income (from
  // income_streams + deductions + filing status + age bracket) and
  // persisted the answer. Re-deriving in the tool was both wasteful
  // and incorrect — the previous fallback fed post-tax take-home into
  // a function that expected gross, landing the user in a lower
  // bracket than they actually sit in. Every other tool (e.g.
  // /tools/liquidate) reads `profile.marginalRate` directly; this
  // matches.
  const marginalRate = Number(profile.marginalRate || '0');

  // Real surplus: take-home minus fixed expenses minus variable
  // expenses minus scheduled EMIs across all existing loans — exactly
  // the engine's `compute_available_surplus`. The previous version
  // used `monthly_income` (raw take-home) as a stand-in, which
  // systematically over-stated affordability: a user with ₹100k
  // take-home and ₹80k of existing commitments was reported as having
  // ₹100k of EMI capacity. `deriveMetrics().surplus` matches what
  // /plan's KPI strip displays, so the feasibility verdict here lines
  // up with what the user sees on the plan page.
  const monthlySurplus = useMemo(() => {
    const surplus = Number(deriveMetrics(profile).surplus.toString());
    return Math.max(0, surplus);
  }, [profile]);

  // Taxable income (pre-home-loan-deduction). Lets the advisor walk
  // slab boundaries when the Sec 24(b) deduction (or US mortgage-
  // interest deduction) crosses a bracket — saves at the actual
  // blended rate instead of a flat `deduction × marginalRate`.
  //
  // Gross source mirrors deriveMarginalRateForUser: prefer income_streams
  // (richer — captures presumptive / rental / capital-gains splits),
  // but fall back to the scalar `annual_income` when streams aren't
  // configured. Without the fallback, users who skipped the streams
  // panel got `taxableIncome === 0`, which silently routed them through
  // the flat `marginalRate × deduction` path inside computeTaxBenefit —
  // exactly the approximation the bracket walker exists to avoid.
  const taxableIncome = useMemo(() => {
    const slabGross = Number(
      activeSlabGrossAnnual(profile.user.income_streams).toString(),
    );
    const gross = slabGross > 0
      ? slabGross
      : Number(profile.user.annual_income || '0');
    if (gross <= 0) return 0;
    const { totalAllowed } = summariseDeductions(
      profile.user.deductions,
      profile.user.country,
      profile.user.tax_regime,
      profile.user.age_bracket,
      profile.user.income_type,
    );
    return Math.max(0, gross - Number(totalAllowed.toString()));
  }, [profile]);

  const [type, setType] = useState<PurchaseType>('home');
  const [price, setPrice] = useState('');
  const [targetMonth, setTargetMonth] = useState(nextSixMonths);
  const [downPct, setDownPct] = useState(DEFAULTS.home.downPct);
  const [tenureYears, setTenureYears] = useState(DEFAULTS.home.tenureYears);
  const [rate, setRate] = useState(DEFAULTS.home.rate);
  const [itemisesUS, setItemisesUS] = useState(false);
  // Per-field "user touched this" flags. Without these, the prior
  // heuristic ("only reset when current value matches the prior
  // default") silently overwrote intentional edits any time the user
  // happened to type a value identical to the prior default and then
  // switched type. Once a field is touched it stays sticky across type
  // changes; untouched fields adopt the new type's defaults.
  const [touched, setTouched] = useState({
    downPct: false,
    tenureYears: false,
    rate: false,
  });

  function applyTypeDefaults(t: PurchaseType) {
    const next = DEFAULTS[t];
    if (!touched.downPct) setDownPct(next.downPct);
    if (!touched.tenureYears) setTenureYears(next.tenureYears);
    if (!touched.rate) setRate(next.rate);
    setType(t);
  }

  // Active goals + their saved totals — read client-side so a user who
  // has logged a partial down-payment toward a goal sees the slip from
  // the *remaining* gap, not the full goal amount.
  const goals = useMemo(() => readGoalsClient(), []);
  const contributionTotals = useMemo(
    () => totalsByGoal(readContributionsClient()),
    [],
  );

  const priceNum = Number(price || '0');
  const analysis: PurchaseAnalysis | null =
    priceNum > 0
      ? analyzePurchase({
          type,
          price: priceNum,
          targetMonth,
          downPaymentPct: Number(downPct) / 100,
          loanTenureYears: Number(tenureYears),
          loanRateAnnual: Number(rate) / 100,
          country,
          taxRegime: profile.user.tax_regime,
          marginalRate,
          taxableIncome,
          filingStatus: profile.user.filing_status,
          stateMarginalRate: profile.user.state_marginal_rate,
          stateMarginalRateOverride:
            profile.user.deductions?.state_marginal_rate_override,
          itemisesUS,
          monthlySurplus,
        })
      : null;

  // Goal-slip: how much does each active goal's earliest feasible month
  // shift if the user takes this purchase's EMI on top of current
  // commitments? Negative-surplus-delta = goal slips later (or breaks).
  // Empty rows when there are no goals, or when no goal is materially
  // impacted (slip < 1 month, no deadline break).
  const goalSlipRows = useMemo(() => {
    if (!analysis || goals.length === 0) return [];
    const emi = analysis.affordability.monthlyEmi;
    if (!Number.isFinite(emi) || emi <= 0) return [];
    const rows = computeGoalSlip({
      goals,
      contributionTotals,
      baselineMonthlySurplus: monthlySurplus,
      surplusDelta: -emi,
      efBalance: Number(profile.user.efund_balance || 0),
      efTarget: Number(profile.user.efund_target || 0),
      monthlyExpenses:
        Number(profile.user.fixed_expenses || 0) +
        Number(profile.user.variable_expenses || 0),
    });
    return materialSlips(rows);
  }, [analysis, goals, contributionTotals, monthlySurplus, profile.user]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: fitColumns(3, 140),
          gap: 12,
        }}
      >
        <Select
          label="Type"
          value={type}
          onChange={(v) => applyTypeDefaults(v as PurchaseType)}
          options={TYPE_OPTIONS}
        />
        <Field
          label={`Price (${ccy})`}
          value={price}
          onChange={setPrice}
          hint="Out-the-door cost"
          kind="decimal"
        />
        <MonthYearPicker
          label="Target month"
          value={targetMonth}
          onChange={setTargetMonth}
          minYear={new Date().getFullYear()}
          maxYear={new Date().getFullYear() + 10}
          hint="When you need to buy"
        />
        <Field
          label="Down payment (%)"
          value={downPct}
          onChange={(v) => {
            setDownPct(v);
            if (!touched.downPct) setTouched((t) => ({ ...t, downPct: true }));
          }}
          hint="Cash up front, balance financed"
          kind="decimal"
        />
        <Field
          label="Loan tenure (years)"
          value={tenureYears}
          onChange={(v) => {
            setTenureYears(v);
            if (!touched.tenureYears) setTouched((t) => ({ ...t, tenureYears: true }));
          }}
          hint={
            type === 'vehicle' ? 'Longer = underwater risk' : 'Longer = lower EMI, more interest'
          }
          kind="integer"
        />
        <Field
          label="Indicative rate (% p.a.)"
          value={rate}
          onChange={(v) => {
            setRate(v);
            if (!touched.rate) setTouched((t) => ({ ...t, rate: true }));
          }}
          hint="Sanction-letter rate; shop around"
          kind="decimal"
        />
      </div>

      {country === 'US' && type === 'home' && (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: 'var(--muted)',
          }}
        >
          <input
            type="checkbox"
            checked={itemisesUS}
            onChange={(e) => setItemisesUS(e.target.checked)}
          />
          I itemise on Schedule A (Schedule A &gt; standard deduction)
          <InfoTip>
            Mortgage interest deduction only helps if your itemised total
            exceeds the standard deduction. Tick this if your current return
            itemises — otherwise the analysis treats the benefit as zero.
          </InfoTip>
        </label>
      )}

      {analysis && (
        <>
          <AnalysisPanel
            analysis={analysis}
            fmt={fmt}
            ccySym={ccy === 'INR' ? '₹' : '$'}
            marginalRate={marginalRate}
          />
          {goalSlipRows.length > 0 && (
            <GoalSlipPanel rows={goalSlipRows} />
          )}
          <DecisionLogControls
            kind="new_loan"
            context={`${type} purchase — ${analysis.feasibility} on current surplus`}
            estimatedAmount={String(analysis.loan.tcoPostTax)}
            reasoning={`Down ${ccy === 'INR' ? '₹' : '$'}${analysis.downPayment.amount.toLocaleString()}, EMI ${ccy === 'INR' ? '₹' : '$'}${Math.round(analysis.loan.monthlyEmi).toLocaleString()}/mo over ${analysis.loan.tenureYears}yr`}
            source="tools/purchase"
            ccySym={ccy === 'INR' ? '₹' : '$'}
          />
        </>
      )}
      {!analysis && (
        <div
          className="muted"
          style={{
            padding: 12,
            border: '1px dashed var(--border)',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          Enter a price to run the feasibility check.
        </div>
      )}
    </div>
  );
}

// ─── Analysis panel ────────────────────────────────────────────────────────

const VERDICT_COLOR: Record<PurchaseAnalysis['feasibility'], string> = {
  feasible: 'var(--positive)',
  tight: 'var(--warning)',
  unfeasible: 'var(--negative)',
};

const VERDICT_LABEL: Record<PurchaseAnalysis['feasibility'], string> = {
  feasible: 'Feasible on current surplus',
  tight: 'Tight — affordable but with little headroom',
  unfeasible: 'Not feasible on the current plan',
};

function AnalysisPanel({
  analysis,
  fmt,
  ccySym,
  marginalRate,
}: {
  analysis: PurchaseAnalysis;
  fmt: (v: number) => string;
  ccySym: string;
  /** Tax bracket the TCO/effective-rate math used. Surfaced inline so
   *  the user can tell when the stored value is stale (0% or far from
   *  their expected bracket) before trusting the verdict. */
  marginalRate: number;
}) {
  const showLevers = analysis.feasibility !== 'feasible';
  const marginalPct = marginalRate > 0 ? `${Math.round(marginalRate * 100)}%` : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          padding: 12,
          background: 'var(--card)',
          border: `1px solid ${VERDICT_COLOR[analysis.feasibility]}`,
          borderRadius: 6,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: VERDICT_COLOR[analysis.feasibility],
          }}
        >
          {VERDICT_LABEL[analysis.feasibility]}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          {analysis.monthsToTarget} months until target ·{' '}
          {analysis.affordability.emiOverSurplus === Infinity
            ? 'no surplus on file'
            : `EMI ${Math.round(analysis.affordability.emiOverSurplus * 100)}% of surplus`}
          {marginalPct ? (
            <> · at your {marginalPct} marginal bracket</>
          ) : (
            <>
              {' '}·{' '}
              <span style={{ color: 'var(--warning)' }}>
                no marginal rate on file — tax benefit will read as zero
              </span>
            </>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: fitColumns(3, 140),
          gap: 10,
        }}
      >
        <NumberStat
          label="Down payment"
          value={fmt(analysis.downPayment.amount)}
          sub={`${fmt(analysis.downPayment.monthlySavingRequired)}/mo to save by date${
            analysis.downPayment.coverableBySurplus ? '' : ' — exceeds surplus'
          }`}
        />
        <NumberStat
          label="Monthly EMI"
          value={fmt(analysis.loan.monthlyEmi)}
          sub={`${analysis.loan.tenureYears}yr · ${fmt(analysis.loan.principal)} financed`}
        />
        <NumberStat
          label="Total interest"
          value={fmt(analysis.loan.totalInterestOverTenure)}
          sub={`Effective rate after tax: ${(analysis.loan.effectiveAfterTaxRate * 100).toFixed(2)}%`}
        />
      </div>

      <div
        style={{
          padding: 10,
          background: 'var(--soft-bg)',
          borderRadius: 4,
          fontSize: 12,
          lineHeight: 1.55,
        }}
      >
        <strong>TCO (post-tax):</strong> {fmt(analysis.loan.tcoPostTax)}{' '}
        — down payment + EMIs over {analysis.loan.tenureYears} years, minus the
        tax saving on deductible interest (when applicable).
      </div>

      {showLevers && (
        <div
          style={{
            padding: 10,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 4,
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
            What would make this comfortable?
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: fitColumns(3, 140),
              gap: 8,
              fontSize: 12,
            }}
          >
            <LeverCell
              label="Lower the price"
              value={
                analysis.levers.lowerPriceTo > 0
                  ? `≤ ${ccySym}${Math.round(analysis.levers.lowerPriceTo).toLocaleString()}`
                  : 'n/a'
              }
              subtle="Keeps EMI to ≤ 50% of surplus."
            />
            <LeverCell
              label="Push the date out"
              value={
                analysis.levers.extendTargetByMonths > 0
                  ? `+${analysis.levers.extendTargetByMonths} months`
                  : 'date already fits surplus'
              }
              subtle="More months to accumulate the down payment."
            />
            <LeverCell
              label="More down payment"
              value={
                analysis.levers.increaseDownPaymentToPct > 0
                  ? `≥ ${Math.round(analysis.levers.increaseDownPaymentToPct * 100)}%`
                  : 'n/a'
              }
              subtle="Shrinks the loan so EMI fits surplus."
            />
          </div>
        </div>
      )}

      {(analysis.warnings.length > 0 || analysis.notes.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {analysis.warnings.map((w, i) => (
            <div
              key={`w${i}`}
              style={{
                padding: '8px 10px',
                background: 'var(--card)',
                borderLeft: '3px solid var(--warning)',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {w}
            </div>
          ))}
          {analysis.notes.map((n, i) => (
            <div
              key={`n${i}`}
              style={{
                padding: '8px 10px',
                background: 'var(--card)',
                borderLeft: '3px solid var(--accent)',
                fontSize: 12,
                lineHeight: 1.5,
                color: 'var(--muted)',
              }}
            >
              {n}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NumberStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div
      style={{
        padding: 10,
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 4,
      }}
    >
      <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>
        {label.toUpperCase()}
      </div>
      <div className="num" style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>
        {value}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 2, lineHeight: 1.4 }}>
        {sub}
      </div>
    </div>
  );
}

function LeverCell({
  label,
  value,
  subtle,
}: {
  label: string;
  value: string;
  subtle: string;
}) {
  return (
    <div
      style={{
        padding: 8,
        background: 'var(--soft-bg)',
        borderRadius: 4,
        lineHeight: 1.4,
      }}
    >
      <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.04em' }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontWeight: 600, marginTop: 2 }}>{value}</div>
      <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>{subtle}</div>
    </div>
  );
}

// ─── Goal-slip panel ───────────────────────────────────────────────────────

function GoalSlipPanel({
  rows,
}: {
  rows: ReturnType<typeof materialSlips>;
}) {
  const breaking = rows.filter((r) => r.breaksDeadline);
  const slipping = rows.filter((r) => !r.breaksDeadline);
  return (
    <div
      style={{
        padding: 12,
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--warning, var(--accent))',
        borderRadius: 6,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--accent)',
          marginBottom: 8,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        Impact on your goals
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {breaking.map((r) => (
          <div key={r.goalId} style={{ fontSize: 13 }}>
            <span style={{ color: 'var(--negative)', fontWeight: 600 }}>
              {r.goalLabel}
            </span>{' '}
            <span className="muted">— breaks the deadline.</span>{' '}
            {r.baseEarliestLabel && r.postEarliestLabel && (
              <span className="muted">
                Was achievable by {r.baseEarliestLabel}; now earliest{' '}
                {r.postEarliestLabel}.
              </span>
            )}
            {r.postEarliest === null && (
              <span className="muted">
                Forward surplus can&apos;t reach it after this purchase.
              </span>
            )}
          </div>
        ))}
        {slipping.map((r) => (
          <div key={r.goalId} style={{ fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>{r.goalLabel}</span>{' '}
            <span className="muted">
              — slips by {r.slipMonths} month{r.slipMonths === 1 ? '' : 's'}
              {r.baseEarliestLabel && r.postEarliestLabel ? (
                <>
                  {' '}({r.baseEarliestLabel} → {r.postEarliestLabel})
                </>
              ) : null}
              .
            </span>
          </div>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
        Estimated from current surplus held steady. The /plan engine runs a
        fuller projection that includes lifecycle events and inflation.
      </div>
    </div>
  );
}
