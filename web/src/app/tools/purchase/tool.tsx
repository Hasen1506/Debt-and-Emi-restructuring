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
import { formatCurrency } from '@/lib/api';
import { loadProfileClient } from '@/lib/user-store';
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
  const profile = useMemo(() => loadProfileClient(), []);
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
  // blended rate instead of a flat `deduction × marginalRate`. The
  // bracket walker handles edge cases naturally; here we just supply
  // the inputs.
  const taxableIncome = useMemo(() => {
    const slabGross = Number(
      activeSlabGrossAnnual(profile.user.income_streams).toString(),
    );
    if (slabGross <= 0) return 0;
    const { totalAllowed } = summariseDeductions(
      profile.user.deductions,
      profile.user.country,
      profile.user.tax_regime,
      profile.user.age_bracket,
    );
    return Math.max(0, slabGross - Number(totalAllowed.toString()));
  }, [profile]);

  const [type, setType] = useState<PurchaseType>('home');
  const [price, setPrice] = useState('');
  const [targetMonth, setTargetMonth] = useState(nextSixMonths);
  const [downPct, setDownPct] = useState(DEFAULTS.home.downPct);
  const [tenureYears, setTenureYears] = useState(DEFAULTS.home.tenureYears);
  const [rate, setRate] = useState(DEFAULTS.home.rate);
  const [itemisesUS, setItemisesUS] = useState(false);

  // Push type defaults when the user switches type — but only when the
  // current value still matches some default (so we don't overwrite
  // intentional edits).
  function applyTypeDefaults(t: PurchaseType) {
    const cur = DEFAULTS[type];
    const next = DEFAULTS[t];
    if (downPct === cur.downPct) setDownPct(next.downPct);
    if (tenureYears === cur.tenureYears) setTenureYears(next.tenureYears);
    if (rate === cur.rate) setRate(next.rate);
    setType(t);
  }

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
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
        <Field
          label="Target month (YYYY-MM)"
          value={targetMonth}
          onChange={setTargetMonth}
          hint="When you need to buy"
        />
        <Field
          label="Down payment (%)"
          value={downPct}
          onChange={setDownPct}
          hint="Cash up front, balance financed"
          kind="decimal"
        />
        <Field
          label="Loan tenure (years)"
          value={tenureYears}
          onChange={setTenureYears}
          hint={
            type === 'vehicle' ? 'Longer = underwater risk' : 'Longer = lower EMI, more interest'
          }
          kind="integer"
        />
        <Field
          label="Indicative rate (% p.a.)"
          value={rate}
          onChange={setRate}
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
          <AnalysisPanel analysis={analysis} fmt={fmt} ccySym={ccy === 'INR' ? '₹' : '$'} />
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
}: {
  analysis: PurchaseAnalysis;
  fmt: (v: number) => string;
  ccySym: string;
}) {
  const showLevers = analysis.feasibility !== 'feasible';
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
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
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
              gridTemplateColumns: 'repeat(3, 1fr)',
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
