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

import { useEffect, useMemo, useState } from 'react';
import { Field } from '@/components/ToolPrimitives';
import { MonthYearPicker } from '@/components/MonthYearPicker';
import { LChip, LChipRow, LKpi, LMathBlock, L_T } from '@/components/ledger/primitives';
import { LFieldGrid, LNote, LStep, LStepSub, LSteps, LVerdict } from '@/components/ledger/LToolSteps';
import { api, formatCurrency } from '@/lib/api';
import { useCurrentProfile as useStoredProfile } from '@/lib/use-profile';
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
import { isOpenGoal, readGoalsClient } from '@/lib/goals';
import {
  readContributionsClient,
  totalsByGoal,
} from '@/lib/goal-contributions';
import { computeGoalSlip, materialSlips } from '@/lib/goal-slip';

const TYPE_OPTIONS: { value: PurchaseType; label: string }[] = [
  { value: 'home', label: 'A home' },
  { value: 'vehicle', label: 'A car or bike' },
  { value: 'other', label: 'Something else' },
];

const DEFAULTS = {
  home: { downPct: '20', tenureYears: '20' },
  vehicle: { downPct: '15', tenureYears: '5' },
  other: { downPct: '25', tenureYears: '5' },
};

/** Which published rate starts each kind of purchase: something else is
 *  usually a personal loan. */
const RATE_SOURCE = { home: 'home_loan', vehicle: 'auto_loan', other: 'personal_loan' } as const;

/** Used until the bank rates load (or if they don't): the middle of the
 *  big banks' published rates in May 2026, the same cards the API serves. */
const RATE_FALLBACK: Record<'IN' | 'US', Record<PurchaseType, string>> = {
  IN: { home: '8.3', vehicle: '9.0', other: '15.5' },
  US: { home: '6.8', vehicle: '8.7', other: '16.0' },
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
  const [availableSavings, setAvailableSavings] = useState(() => {
    if(!profile.isLive) return '0';
    const accounts=profile.user.cash_accounts;
    if(!accounts?.length) return String(Math.round(Number(profile.user.savings_balance ?? 0)));
    return accounts.filter(a=>a.kind!=='fd' && (!a.currency || a.currency===ccy))
      .reduce((sum,a)=>sum+Number(a.balance),0).toFixed(0);
  });
  const [targetMonth, setTargetMonth] = useState(nextSixMonths);
  const [downPct, setDownPct] = useState(DEFAULTS.home.downPct);
  const [tenureYears, setTenureYears] = useState(DEFAULTS.home.tenureYears);
  // Starts at the middle of the big banks' published rates for this kind
  // of loan, until the user types their lender's offer.
  const [marketRates, setMarketRates] = useState<Record<PurchaseType, string>>(RATE_FALLBACK[country]);
  const [rate, setRate] = useState(RATE_FALLBACK[country].home);
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
    if (!touched.rate) setRate(marketRates[t]);
    setType(t);
  }

  useEffect(() => {
    let cancelled = false;
    const types = Object.keys(RATE_SOURCE) as PurchaseType[];
    Promise.all(types.map((t) => api.marketMedian(country, RATE_SOURCE[t]).catch(() => null))).then((rows) => {
      if (cancelled) return;
      const next = { ...RATE_FALLBACK[country] };
      rows.forEach((r, i) => {
        if (r?.median != null) next[types[i]] = String(Math.round(Number(r.median) * 1000) / 10);
      });
      setMarketRates(next);
    });
    return () => {
      cancelled = true;
    };
  }, [country]);

  // A rate the user hasn't typed follows the published one as it loads.
  useEffect(() => {
    if (!touched.rate) setRate(marketRates[type]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketRates]);

  // Active goals + their saved totals — read client-side so a user who
  // has logged a partial down-payment toward a goal sees the slip from
  // the *remaining* gap, not the full goal amount.
  const goals = useMemo(() => readGoalsClient().filter(isOpenGoal), []);
  const contributionTotals = useMemo(
    () => totalsByGoal(readContributionsClient()),
    [],
  );

  let analysis: PurchaseAnalysis | null = null;
  let inputError: string | null = null;
  try {
    if (price.trim() && deriveMetrics(profile).fxMissing.length) throw new Error('Save exchange rates for your foreign loans in Setup before checking affordability.');
    if (price.trim()) analysis = analyzePurchase({
          type,
          price: Number(price),
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
          availableSavings: Number(availableSavings),
        }); } catch(e) { inputError = (e as Error).message; }

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

  const savingsFromProfile = profile.isLive;
  const fieldTouch = (k: keyof typeof touched, set: (v: string) => void) => (v: string) => {
    set(v);
    if (!touched[k]) setTouched((t) => ({ ...t, [k]: true }));
  };

  return (
    <LSteps>
      <LStep no="01" id="pa-in" title="What you'd buy">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <LChipRow label="What is it?">
            {TYPE_OPTIONS.map((o) => (
              <LChip key={o.value} on={type === o.value} onClick={() => applyTypeDefaults(o.value)}>
                {o.label}
              </LChip>
            ))}
          </LChipRow>
          <LFieldGrid min={200}>
            <Field label="Price" kind="money" currency={ccy} value={price} onChange={setPrice} hint="All in: taxes, registration, fees" />
            <Field
              label="Savings you'd put in"
              kind="money"
              currency={ccy}
              value={availableSavings}
              onChange={setAvailableSavings}
              hint={savingsFromProfile ? 'From your profile. Leave out your emergency fund.' : 'Leave out your emergency fund'}
            />
            <MonthYearPicker
              label="When you'd buy"
              value={targetMonth}
              onChange={setTargetMonth}
              minYear={new Date().getFullYear()}
              maxYear={new Date().getFullYear() + 10}
            />
          </LFieldGrid>

          <div>
            <LStepSub right="TYPICAL TERMS TO START">The loan</LStepSub>
            <div style={{ marginTop: 10 }}>
              <LFieldGrid min={180}>
                <Field label="Down payment (%)" value={downPct} onChange={fieldTouch('downPct', setDownPct)} hint="Paid up front" />
                <Field
                  label="Over how many years"
                  kind="integer"
                  value={tenureYears}
                  onChange={fieldTouch('tenureYears', setTenureYears)}
                  hint={type === 'vehicle' ? 'Longer: you owe more than it’s worth' : 'Longer: lower EMI, more interest'}
                />
                <Field
                  label="Rate (%)"
                  value={rate}
                  onChange={fieldTouch('rate', setRate)}
                  hint={
                    !touched.rate && rate === marketRates[type]
                      ? 'Middle of the big banks’ published rates (May 2026). Use your lender’s offer.'
                      : 'From the lender’s offer'
                  }
                />
              </LFieldGrid>
            </div>
          </div>

          {country === 'US' && type === 'home' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: L_T.muted }}>
              <input type="checkbox" checked={itemisesUS} onChange={(e) => setItemisesUS(e.target.checked)} />
              I itemise deductions (Schedule A beats the standard deduction)
            </label>
          )}
          {inputError && (
            <p role="alert" style={{ margin: 0, fontSize: 12, color: L_T.negative }}>
              {inputError}
            </p>
          )}
        </div>
      </LStep>

      {analysis ? (
        <AnalysisPanel
          analysis={analysis}
          fmt={fmt}
          marginalRate={marginalRate}
          price={Number(price)}
          rate={Number(rate)}
          monthlySurplus={monthlySurplus}
          goalSlipRows={goalSlipRows}
          log={
            <DecisionLogControls
              kind="new_loan"
              context={`${type} purchase — ${analysis.feasibility} on current surplus`}
              estimatedAmount={String(analysis.loan.tcoPostTax)}
              reasoning={`Down ${fmt(analysis.downPayment.amount)}, EMI ${fmt(analysis.loan.monthlyEmi)} a month over ${analysis.loan.tenureYears} years`}
              source="tools/purchase"
              ccySym={ccy === 'INR' ? '₹' : '$'}
            />
          }
        />
      ) : (
        !inputError && <LNote style={{ margin: 0 }}>Enter a price to see whether it fits.</LNote>
      )}
    </LSteps>
  );
}

// ─── The answer ────────────────────────────────────────────────────────────

const VERDICT: Record<PurchaseAnalysis['feasibility'], { text: string; tone: 'pos' | 'accent' | 'neg' }> = {
  feasible: { text: 'You can afford it.', tone: 'pos' },
  tight: { text: 'You can afford it, just.', tone: 'accent' },
  unfeasible: { text: 'Not on your current budget.', tone: 'neg' },
};

function AnalysisPanel({
  analysis: a,
  fmt,
  marginalRate,
  price,
  rate,
  monthlySurplus,
  goalSlipRows,
  log,
}: {
  analysis: PurchaseAnalysis;
  fmt: (v: number) => string;
  /** Tax rate the after-tax math used; shown so a stale 0% is visible. */
  marginalRate: number;
  price: number;
  rate: number;
  monthlySurplus: number;
  goalSlipRows: ReturnType<typeof materialSlips>;
  log: React.ReactNode;
}) {
  const v = VERDICT[a.feasibility];
  const months = a.loan.tenureYears * 12;
  const taxSaved = Math.max(0, a.downPayment.amount + a.loan.monthlyEmi * months - a.loan.tcoPostTax);
  const share = a.affordability.emiOverSurplus;
  const levers = a.levers;
  const noLever = levers.lowerPriceTo == null && levers.extendTargetByMonths == null && levers.increaseDownPaymentToPct == null;
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  return (
    <>
      <LStep no="02" id="pa-out" title="The answer" answer>
        <LVerdict tone={v.tone}>{v.text}</LVerdict>
        <LNote>
          {a.monthsToTarget === 0 ? 'You buy this month. ' : `${a.monthsToTarget} month${a.monthsToTarget === 1 ? '' : 's'} to go. `}
          {a.loan.monthlyEmi === 0
            ? 'No loan needed.'
            : share === Infinity
              ? 'Nothing is left each month after your costs and payments.'
              : `The EMI takes ${Math.round(share * 100)}% of what's left each month; up to 40% is comfortable.`}
          {marginalRate > 0 ? '' : ' No tax rate on file, so any tax break reads as zero.'}
        </LNote>
        <LKpi
          items={[
            {
              l: 'DOWN PAYMENT',
              v: fmt(a.downPayment.amount),
              s: a.downPayment.remainingToSave > 0 ? `save ${fmt(a.downPayment.monthlySavingRequired)} a month` : 'from savings',
              tone: a.downPayment.coverableBySurplus ? undefined : L_T.negative,
            },
            { l: 'EMI', v: fmt(a.loan.monthlyEmi), s: `a month for ${a.loan.tenureYears} years` },
            {
              l: 'TOTAL INTEREST',
              v: fmt(a.loan.totalInterestOverTenure),
              s: taxSaved >= 1 ? `${pct(a.loan.effectiveAfterTaxRate)} after tax` : `at ${pct(rate / 100)}, no tax break`,
            },
            {
              l: 'LEFT EACH MONTH',
              v: fmt(a.affordability.surplusAfterEmi),
              s: 'after the EMI',
              tone: a.affordability.surplusAfterEmi < 0 ? L_T.negative : L_T.positive,
            },
          ]}
        />

        {a.feasibility !== 'feasible' && (
          <div style={{ marginTop: 18 }}>
            <LStepSub>What would make it fit</LStepSub>
            {noLever ? (
              <LNote style={{ margin: '8px 0 0' }}>
                No single change fixes it: nothing is left each month. Free up money first (see your plan), then check again.
              </LNote>
            ) : (
              <div style={{ marginTop: 10 }}>
                <LKpi
                  items={[
                    ...(levers.lowerPriceTo != null
                      ? [{ l: 'A PRICE UP TO', v: fmt(Math.round(levers.lowerPriceTo)), s: 'saves in time, EMI under 40%' }]
                      : []),
                    ...(levers.extendTargetByMonths != null
                      ? [{ l: 'BUY LATER BY', v: `${levers.extendTargetByMonths} month${levers.extendTargetByMonths === 1 ? '' : 's'}`, s: 'to save the down payment' }]
                      : []),
                    ...(levers.increaseDownPaymentToPct != null
                      ? [{ l: 'PUT DOWN', v: `${Math.ceil(levers.increaseDownPaymentToPct * 100)}%`, s: 'so the EMI fits' }]
                      : []),
                  ]}
                />
              </div>
            )}
          </div>
        )}

        {goalSlipRows.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <LStepSub right="WHAT'S LEFT HELD STEADY">Your goals</LStepSub>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
              {goalSlipRows.map((r) => (
                <li key={r.goalId}>
                  <strong style={{ color: r.breaksDeadline ? L_T.negative : L_T.ink }}>{r.goalLabel}</strong>
                  {r.breaksDeadline
                    ? r.postEarliest === null
                      ? ': out of reach after this.'
                      : `: misses its date. Earliest now ${r.postEarliestLabel}${r.baseEarliestLabel ? `, was ${r.baseEarliestLabel}` : ''}.`
                    : `: ${r.slipMonths} month${r.slipMonths === 1 ? '' : 's'} later${r.baseEarliestLabel && r.postEarliestLabel ? ` (${r.baseEarliestLabel} → ${r.postEarliestLabel})` : ''}.`}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(a.warnings.length > 0 || a.notes.length > 0) && (
          <ul style={{ margin: '16px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.6, color: L_T.muted }}>
            {a.warnings.map((w, i) => (
              <li key={`w${i}`} style={{ color: L_T.accent }}>
                {w}
              </li>
            ))}
            {a.notes.map((n, i) => (
              <li key={`n${i}`}>{n}</li>
            ))}
          </ul>
        )}
        {log}
      </LStep>

      <LMathBlock
        rows={[
          { k: 'price', v: fmt(price) },
          { k: 'down payment', v: fmt(a.downPayment.amount), note: `${Math.round(a.downPayment.pctOfPrice * 100)}% of the price` },
          ...(a.downPayment.savingsUsed > 0 ? [{ k: 'from savings', v: fmt(a.downPayment.savingsUsed) }] : []),
          ...(a.downPayment.remainingToSave > 0
            ? [
                {
                  k: 'still to save',
                  v: fmt(a.downPayment.remainingToSave),
                  note: a.monthsToTarget > 0 ? `${fmt(a.downPayment.monthlySavingRequired)} a month for ${a.monthsToTarget} months` : 'needed now',
                  tone: a.downPayment.coverableBySurplus ? undefined : ('neg' as const),
                },
              ]
            : []),
          ...(a.loan.principal > 0
            ? [
                { k: 'borrowed', v: fmt(a.loan.principal) },
                { k: 'EMI', v: fmt(a.loan.monthlyEmi), note: `${rate}% over ${months} months` },
                { k: 'total interest', v: fmt(a.loan.totalInterestOverTenure) },
              ]
            : []),
          ...(taxSaved >= 1 ? [{ k: 'tax saved', v: fmt(taxSaved), note: 'over the loan', tone: 'pos' as const }] : []),
          taxSaved >= 1
            ? { k: 'all in, after tax', v: fmt(a.loan.tcoPostTax), note: 'down payment + EMIs − tax saved' }
            : { k: 'all in', v: fmt(a.loan.tcoPostTax), note: 'down payment + EMIs' },
          {
            k: 'left each month',
            v: fmt(a.affordability.surplusAfterEmi),
            note: `${fmt(monthlySurplus)} now, less the EMI`,
            tone: a.affordability.surplusAfterEmi < 0 ? ('neg' as const) : undefined,
          },
        ]}
      />
    </>
  );
}
