'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/Card';
import { BankCombobox, Field, Select, SubmitBar } from '@/components/ToolPrimitives';
import { EffectiveAprBreakdown } from '@/components/EffectiveAprBreakdown';
import { RateRangeHint } from '@/components/RateRangeHint';
import type {
  AgeBracket,
  Country,
  DeductionsPayload,
  FilingStatusUS,
  IncomeStreamPayload,
  IncomeType,
  LoanPayload,
  LoanType,
  TaxRegimeIN,
  UserPayload,
} from '@/lib/api';
import { DeductionsPanel } from '@/components/onboarding/DeductionsPanel';
import { IncomeStreamsPanel } from '@/components/onboarding/IncomeStreamsPanel';
import { activeGrossAnnual, deriveMonthlyIncome } from '@/lib/income-streams';
import { deriveMarginalRate } from '@/lib/deductions';

/**
 * True when any field on the deductions payload is set to a meaningful
 * (truthy + > 0) value. Used to decide whether to persist the slice.
 */
function hasAnyDeductions(d: DeductionsPayload | undefined): boolean {
  if (!d) return false;
  return Object.values(d).some((v) => v != null && Number(v) > 0);
}
import {
  loadProfileClient,
  saveProfileClient,
  saveFxCacheClient,
} from '@/lib/user-store';
import { ensureFxRates } from '@/lib/currency';
import {
  FY_ANCHOR_MONTH,
  MONTH_NAMES,
  formatCountryDateLong,
} from '@/lib/today';
import { explainMinPayment, suggestedGraceDays } from '@/lib/min-payment';
import { api, formatCurrency } from '@/lib/api';
import { deriveTenureMonths } from '@/lib/derived';
import {
  classifyBracket,
  computeAnnualTax,
  describeBracket,
  isAdvanceTaxApplicable,
} from '@/lib/tax-brackets';

const STEPS = [
  'You',
  'Country',
  'Income',
  'Loans',
  'Savings',
  'Credit score',
  'Review',
] as const;

// `?step=loans` (or `?step=income`, etc.) deep-links to a specific step so
// CTAs like "+ Add debt" on the Debts page can drop the user directly on the
// Loans card instead of the country picker.
const STEP_ALIASES: Record<string, number> = {
  you: 0,
  country: 1,
  income: 2,
  loans: 3,
  savings: 4,
  credit: 5,
  review: 6,
};

const AGE_BRACKETS: { value: AgeBracket; label: string }[] = [
  { value: 'under_25', label: 'Under 25' },
  { value: '25_35', label: '25 to 35' },
  { value: '35_50', label: '35 to 50' },
  { value: '50_plus', label: '50+' },
];

function parseStepParam(raw: string | null): number {
  if (!raw) return 0;
  const lower = raw.toLowerCase();
  if (lower in STEP_ALIASES) return STEP_ALIASES[lower];
  const n = Number(lower);
  if (Number.isInteger(n) && n >= 0 && n < STEPS.length) return n;
  return 0;
}

const LOAN_TYPES: { value: LoanType; label: string }[] = [
  { value: 'home_loan', label: 'Home loan' },
  { value: 'auto_loan', label: 'Auto loan' },
  { value: 'personal_loan', label: 'Personal loan' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'education_loan', label: 'Education loan' },
  { value: 'gold_loan', label: 'Gold loan' },
  { value: 'bnpl', label: 'BNPL / pay-later' },
];

function blankLoan(): LoanPayload {
  return {
    loan_type: 'credit_card',
    bank: '',
    outstanding: '',
    nominal_rate: '',
    rate_type: 'fixed',
    tenure_months_remaining: 0,
    scheduled_emi: '',
    processing_fee_amortised: '',
    insurance_premium_pct: '',
  };
}

export default function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState(() => parseStepParam(searchParams.get('step')));

  // ─── form state ─────────────────────────────────────────────────────────
  // Both optional. We never gate the flow on them — the "You" step is a soft
  // landing, not a required gate.
  const [displayName, setDisplayName] = useState('');
  const [ageBracket, setAgeBracket] = useState<AgeBracket | ''>('');
  const [country, setCountry] = useState<Country>('IN');
  const [isNriUs, setIsNriUs] = useState(false);
  const [incomeType, setIncomeType] = useState<IncomeType>('salaried');
  const [monthlyIncome, setMonthlyIncome] = useState('');
  const [fixedExpenses, setFixedExpenses] = useState('');
  const [variableExpenses, setVariableExpenses] = useState('');
  // Pre-tax annual income. One of these is filled depending on income_type;
  // the other stays blank. Empty = user provided only take-home, and the
  // bracket / marginal-rate auto-derivation is skipped (engine falls back
  // to the manual marginalRate field below).
  const [annualGrossSalary, setAnnualGrossSalary] = useState('');
  const [annualBusinessIncome, setAnnualBusinessIncome] = useState('');
  // Salaried-only: tax owed on non-TDS income (rental, FD interest,
  // cap gains, freelance). Drives the tax-sleeve card on /debts.
  const [extraIncomeAnnualTax, setExtraIncomeAnnualTax] = useState('');
  // Old-regime + itemized deductions. Captured at step 2 conditionally
  // (IN-old or US). Engine ignores; drives the derived-marginal preview
  // and the tax breakdown panel. Round-trips via the cookie.
  const [deductions, setDeductions] = useState<DeductionsPayload | undefined>(undefined);
  // Multi-source income streams. Empty = legacy single-source mode
  // (monthlyIncome alone). When non-empty, derived monthly_income from
  // active streams takes priority at save time.
  const [incomeStreams, setIncomeStreams] = useState<IncomeStreamPayload[]>([]);
  // By default we show a single "Monthly expenses" field — users don't
  // need to think about fixed vs. variable. Power users (and anyone with
  // existing variable_expenses from a previous session) get the detailed
  // breakdown. The split matters for the WhatIf "trim spending" slider:
  // combined mode → slider operates on fixed_expenses; detailed mode →
  // slider operates on variable_expenses (more honest).
  const [showDetailedExpenses, setShowDetailedExpenses] = useState(false);
  const [primaryBank, setPrimaryBank] = useState('');
  const [otherBanks, setOtherBanks] = useState<string[]>([]);
  const [newOtherBank, setNewOtherBank] = useState('');
  const [taxRegime, setTaxRegime] = useState<TaxRegimeIN>('new');
  // US filing status drives the federal slab table. Defaults to 'single'
  // for back-compat with profiles that pre-date the picker.
  const [filingStatus, setFilingStatus] = useState<FilingStatusUS>('single');
  // Optional US state marginal rate (decimal). Added on top of federal
  // marginal_rate when present so combined math reflects state burden.
  const [stateMarginalRate, setStateMarginalRate] = useState('');
  const [annualHikeRate, setAnnualHikeRate] = useState('');
  // Optional hike phases for users who want varied rates over time (e.g.
  // "first 2yrs 7%, next 4yrs 10%, job switch at year 6"). Empty list →
  // engine uses annualHikeRate uniformly. Each row is { from, to, rate }
  // with `from` 1-based inclusive and `to` 1-based exclusive.
  const [hikeSchedule, setHikeSchedule] = useState<
    { from: string; to: string; rate: string }[]
  >([]);
  const [marginalRate, setMarginalRate] = useState('');
  // 1-12. Defaults to country FY-1 (April for IN, January for US). When the
  // user changes country and HASN'T manually picked a month, we follow the
  // country default. `hikeMonthTouched` tracks the manual override.
  const [hikeEffectiveMonth, setHikeEffectiveMonth] = useState<number>(FY_ANCHOR_MONTH.IN);
  const [hikeMonthTouched, setHikeMonthTouched] = useState(false);
  useEffect(() => {
    if (!hikeMonthTouched) setHikeEffectiveMonth(FY_ANCHOR_MONTH[country]);
  }, [country, hikeMonthTouched]);

  const [loans, setLoans] = useState<LoanPayload[]>([blankLoan()]);
  // Most users don't know their exact remaining tenure — they know
  // outstanding, EMI, rate. We default to deriving tenure from those three
  // and only let the user override when they explicitly ask. This set tracks
  // which loan indices the user has chosen to enter manually.
  const [manualTenureIdxs, setManualTenureIdxs] = useState<Set<number>>(
    () => new Set(),
  );

  const [savingsBalance, setSavingsBalance] = useState('');
  const [efundBalance, setEfundBalance] = useState('');
  const [efundTarget, setEfundTarget] = useState('');
  // Optional rich cash breakdown. Empty list = legacy single-total mode
  // (savingsBalance alone is used). When user adds at least one account
  // here, savingsBalance is auto-derived from the sum of optimizable
  // (non-checking) balances at save() time.
  const [cashAccounts, setCashAccounts] = useState<
    { name: string; balance: string; apy: string; kind: 'checking' | 'savings' | 'hysa' | 'fd' | 'other' }[]
  >([]);

  const [creditScore, setCreditScore] = useState('');

  // Rehydrate from the saved profile cookie on mount so re-visiting Setup
  // shows the data the user already entered (not blank defaults).
  // isLive=false means there's no cookie — leave empty defaults in place.
  useEffect(() => {
    const stored = loadProfileClient();
    if (!stored.isLive) return;
    const u = stored.user;
    if (u.display_name) setDisplayName(u.display_name);
    if (u.age_bracket) setAgeBracket(u.age_bracket);
    setCountry(u.country);
    setIsNriUs(!!u.is_nri_us);
    setIncomeType(u.income_type);
    setMonthlyIncome(u.monthly_income ?? '');
    setFixedExpenses(u.fixed_expenses ?? '');
    setVariableExpenses(u.variable_expenses ?? '');
    setAnnualGrossSalary(u.annual_gross_salary ?? '');
    setAnnualBusinessIncome(u.annual_business_income ?? '');
    setExtraIncomeAnnualTax(u.extra_income_annual_tax ?? '');
    setDeductions(u.deductions);
    setIncomeStreams(u.income_streams ?? []);
    // Preserve the user's chosen view: if they previously filled out a
    // variable_expenses split, default the form to detailed mode.
    if (Number(u.variable_expenses || 0) > 0) {
      setShowDetailedExpenses(true);
    }
    // creditScore state lives below and is hydrated from stored.creditScore
    // (a top-level field on the cookie). The fallback below allows reading
    // it from u.credit_score for backend round-trips too.
    if (u.credit_score) setCreditScore(u.credit_score);
    setPrimaryBank(u.primary_bank ?? '');
    setOtherBanks(u.other_banks ?? []);
    if (u.country === 'IN' && u.tax_regime) setTaxRegime(u.tax_regime);
    if (u.country === 'US' && u.filing_status) setFilingStatus(u.filing_status);
    if (u.state_marginal_rate) setStateMarginalRate(u.state_marginal_rate);
    setAnnualHikeRate(u.annual_hike_rate ?? '');
    if (u.hike_schedule && u.hike_schedule.length > 0) {
      setHikeSchedule(
        u.hike_schedule.map(([from, to, rate]) => ({
          from: String(from),
          to: String(to),
          rate,
        })),
      );
    }
    if (u.hike_effective_month) {
      setHikeEffectiveMonth(u.hike_effective_month);
      setHikeMonthTouched(true);
    }
    if (u.loans && u.loans.length > 0) {
      setLoans(u.loans);
      // Decide auto vs manual per loan on rehydrate: if the saved tenure
      // matches what we'd derive from the current outstanding+EMI+rate,
      // the user is in auto mode — re-deriving on next submit gives the
      // same number, no surprise. If the saved tenure differs (manual
      // entry, or numbers have drifted), preserve it as manual.
      const manualOnLoad = new Set<number>();
      u.loans.forEach((loan, idx) => {
        if (loan.loan_type === 'credit_card') return;
        if (loan.tenure_months_remaining <= 0) return;
        const derived = deriveTenureMonths(
          loan.outstanding,
          loan.nominal_rate,
          loan.scheduled_emi,
        );
        if (derived == null || derived !== loan.tenure_months_remaining) {
          manualOnLoad.add(idx);
        }
      });
      setManualTenureIdxs(manualOnLoad);
    }
    setSavingsBalance(u.savings_balance ?? '');
    setEfundBalance(u.efund_balance ?? '');
    setEfundTarget(u.efund_target ?? '');
    if (u.cash_accounts && u.cash_accounts.length > 0) {
      setCashAccounts(
        u.cash_accounts.map((a) => ({
          name: a.name,
          balance: a.balance,
          apy: a.apy,
          kind: a.kind,
        })),
      );
    }
    setMarginalRate(stored.marginalRate ?? '');
    if (stored.creditScore != null) setCreditScore(String(stored.creditScore));
  }, []);

  function updateLoan(idx: number, patch: Partial<LoanPayload>) {
    setLoans((cur) => cur.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function addLoan() {
    setLoans((cur) => [...cur, blankLoan()]);
  }

  function removeLoan(idx: number) {
    setLoans((cur) => cur.filter((_, i) => i !== idx));
    // Indices shift down when a loan is removed — rebuild the manual set
    // accordingly so the right loans stay flagged as manually-tenured.
    setManualTenureIdxs((cur) => {
      const next = new Set<number>();
      cur.forEach((i) => {
        if (i < idx) next.add(i);
        else if (i > idx) next.add(i - 1);
      });
      return next;
    });
  }

  function setTenureMode(idx: number, manual: boolean) {
    setManualTenureIdxs((cur) => {
      const next = new Set(cur);
      if (manual) next.add(idx);
      else next.delete(idx);
      return next;
    });
    // When switching back to derived mode, blank the stored tenure so the
    // engine sees the derived value (computed in buildUser) instead of a
    // stale manual entry.
    if (!manual) updateLoan(idx, { tenure_months_remaining: 0 });
  }

  // Coalesce empty strings to sensible numeric defaults so the engine accepts
  // the payload even if the user skipped optional fields.
  const num = (v: string, fallback = '0') => (v.trim() === '' ? fallback : v);

  function buildUser(): UserPayload {
    return {
      country,
      income_type: incomeType,
      display_name: displayName.trim() || undefined,
      age_bracket: ageBracket || undefined,
      annual_income: (() => {
        // Streams override the manual monthly field when present.
        const derived = incomeStreams.length > 0
          ? deriveMonthlyIncome(incomeStreams)
          : null;
        return derived
          ? derived.mul(12).toFixed(0)
          : String(Number(num(monthlyIncome)) * 12);
      })(),
      monthly_income: (() => {
        const derived = incomeStreams.length > 0
          ? deriveMonthlyIncome(incomeStreams)
          : null;
        return derived ? derived.toFixed(0) : num(monthlyIncome);
      })(),
      fixed_expenses: num(fixedExpenses),
      variable_expenses: num(variableExpenses),
      annual_gross_salary:
        incomeType === 'salaried' && annualGrossSalary.trim()
          ? num(annualGrossSalary)
          : undefined,
      annual_business_income:
        incomeType === 'business_owner' && annualBusinessIncome.trim()
          ? num(annualBusinessIncome)
          : undefined,
      extra_income_annual_tax:
        incomeType === 'salaried' && extraIncomeAnnualTax.trim() && Number(extraIncomeAnnualTax) > 0
          ? num(extraIncomeAnnualTax)
          : undefined,
      deductions: hasAnyDeductions(deductions) ? deductions : undefined,
      income_streams: incomeStreams.length > 0 ? incomeStreams : undefined,
      credit_score: creditScore.trim() || undefined,
      // When user has populated rich per-account cash, derive the legacy
      // total from the sum of optimizable balances (everything except
      // 'checking', which is operational float). Single-field users keep
      // the legacy behaviour.
      savings_balance: (() => {
        const valid = cashAccounts.filter(
          (a) => a.name.trim() !== '' && Number(a.balance) > 0,
        );
        if (valid.length === 0) return num(savingsBalance);
        const optimizable = valid
          .filter((a) => a.kind !== 'checking')
          .reduce((s, a) => s + Number(a.balance || 0), 0);
        return String(optimizable);
      })(),
      cash_accounts: cashAccounts
        .filter((a) => a.name.trim() !== '' && Number(a.balance) >= 0)
        .map((a) => ({
          name: a.name.trim(),
          balance: num(a.balance),
          apy: num(a.apy),
          kind: a.kind,
        })),
      primary_bank: primaryBank,
      other_banks: otherBanks,
      location_tier: 'urban',
      tax_regime: country === 'IN' ? taxRegime : undefined,
      filing_status: country === 'US' ? filingStatus : undefined,
      state_marginal_rate:
        country === 'US' && stateMarginalRate.trim()
          ? num(stateMarginalRate)
          : undefined,
      efund_balance: num(efundBalance),
      efund_target: num(efundTarget),
      loans: loans
        .map((l, originalIdx) => ({ l, originalIdx }))
        .filter(({ l }) => Number(l.outstanding) > 0)
        .map(({ l, originalIdx }) => {
          // Tenure: cards never have one; for everyone else, derive from
          // outstanding + EMI + rate unless the user has explicitly chosen
          // to enter it manually.
          let tenure = l.tenure_months_remaining;
          if (l.loan_type === 'credit_card') {
            tenure = 0;
          } else if (!manualTenureIdxs.has(originalIdx)) {
            const derived = deriveTenureMonths(
              l.outstanding,
              l.nominal_rate,
              l.scheduled_emi,
            );
            if (derived != null) tenure = derived;
          }
          return {
            ...l,
            tenure_months_remaining: tenure,
            outstanding: num(l.outstanding),
            nominal_rate: num(l.nominal_rate, '0'),
            scheduled_emi: num(l.scheduled_emi),
            processing_fee_amortised: num(l.processing_fee_amortised ?? '', '0'),
            insurance_premium_pct: num(l.insurance_premium_pct ?? '', '0'),
            expected_monthly_spend:
              l.loan_type === 'credit_card'
                ? num(l.expected_monthly_spend ?? '', '0')
                : '0',
            ...(l.min_payment_override && l.min_payment_override.trim() !== ''
              ? { min_payment_override: num(l.min_payment_override) }
              : {}),
          };
        }),
      investment_options: [
        {
          name: country === 'IN' ? 'Liquid fund' : 'HYSA',
          expected_return: country === 'IN' ? '0.068' : '0.045',
          liquidity_class: 'liquid',
          is_in_pool: true,
        },
      ],
      annual_hike_rate: num(annualHikeRate),
      hike_effective_month: hikeEffectiveMonth,
      // Drop phases that are blank or have non-positive ranges. Engine
      // tolerates any list shape but we shouldn't ship garbage.
      hike_schedule: hikeSchedule
        .map(({ from, to, rate }) => [
          Number(from) || 0,
          Number(to) || 0,
          num(rate, '0'),
        ] as [number, number, string])
        .filter(([f, t, r]) => f > 0 && t > f && Number(r) >= 0),
      inflation_rate: country === 'IN' ? '0.046' : '0.025',
      is_nri_us: isNriUs,
    };
  }

  async function save() {
    const score = Number(creditScore);
    // For hybrid (NRI-US) users with any foreign-currency loan, pre-populate
    // FX rates before persisting so /plan and /debts don't fetch on first
    // render. ensureFxRates is a no-op for single-currency users (the
    // common case), so we don't block onboarding for them.
    const builtUser = buildUser();
    const userWithFx = await ensureFxRates(builtUser, api.fxRate, {
      onFetched: (rates) => saveFxCacheClient(rates),
    });
    // When the user provided gross income, derive marginal_rate from the
    // bracket they fall into — that's a sharper signal than the manual
    // marginal_rate field on Step 4. Fall back to the manual value only
    // when no gross is provided.
    // Streams (when present) override the single annual_gross_salary /
    // annual_business_income input. Sum of *active* streams = total gross
    // — this is what bracket + deductions math should consume.
    const streamGross =
      incomeStreams.length > 0
        ? Number(activeGrossAnnual(incomeStreams).toString())
        : 0;
    const grossForBracket =
      streamGross > 0
        ? streamGross
        : incomeType === 'salaried'
          ? Number(annualGrossSalary)
          : Number(annualBusinessIncome);

    // When deductions are populated, they refine the bracket math by
    // pulling taxable income (and thus marginal rate) down. Use the
    // deductions-aware derivation as the primary source; fall back to
    // bracket-only and then the manual field.
    const deductionDerived =
      hasAnyDeductions(deductions) && grossForBracket > 0
        ? deriveMarginalRate({
            grossAnnual: grossForBracket,
            country,
            taxRegime,
            filingStatus,
            deductions,
            ageBracket: ageBracket || undefined,
            stateMarginalRate,
          })
        : null;

    const derivedBracket =
      grossForBracket > 0
        ? classifyBracket(
            country, taxRegime, incomeType, grossForBracket,
            country === 'US' ? filingStatus : undefined,
          )
        : null;
    // Combined marginal rate = federal (derived from bracket) + state.
    // State only applies to US users; India users have a single national
    // slab. The combined rate flows into tax-aware effective APR + tax
    // savings calculations downstream.
    const federalMarginal = derivedBracket
      ? derivedBracket.marginalRate
      : Number(num(marginalRate, '0.30'));
    const stateRate =
      country === 'US' && stateMarginalRate.trim()
        ? Number(num(stateMarginalRate, '0'))
        : 0;
    // Deductions-derived rate wins when present — it already includes
    // state for US users (via stateMarginalRate threaded into the
    // helper). Otherwise fall through to bracket + state composition.
    const resolvedMarginalRate = deductionDerived
      ? deductionDerived.toFixed(4)
      : (federalMarginal + stateRate).toFixed(4);
    saveProfileClient({
      user: userWithFx,
      marginalRate: resolvedMarginalRate,
      creditScore: Number.isFinite(score) && score >= 300 ? score : null,
    });
    router.push('/debts');
  }

  const canAdvance =
    step === 0 ? true                                                       // 'You' is fully optional — never gate the flow
      : step === 1 ? !!country
      : step === 2 ? Number(monthlyIncome) > 0 && Number(fixedExpenses) >= 0
      : step === 3 ? loans.some((l) => Number(l.outstanding) > 0)
      : step === 4 ? Number(savingsBalance) >= 0
      : step === 5 ? true
      : true;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <h1 className="h1">Set up your profile</h1>
        <p className="muted">
          Six short steps — about two minutes. Saved locally to your browser,
          never uploaded. You can re-edit anytime.
        </p>
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Today, for projections: <strong>{formatCountryDateLong(country)}</strong>
          . The schedule uses this as month 1.
        </p>
      </section>

      {/* progress chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {STEPS.map((s, i) => (
          <span
            key={s}
            className="chip"
            style={{
              background: i === step ? 'var(--accent)' : 'var(--card)',
              color: i === step ? '#fff' : 'var(--muted)',
              opacity: i < step ? 0.6 : 1,
            }}
          >
            {i + 1}. {s}
          </span>
        ))}
      </div>

      <Card>
        {step === 0 && (
          <div style={{ display: 'grid', gap: 14 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
                {displayName ? `Hi, ${displayName.trim()}` : 'Welcome'}
              </div>
              <div className="muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
                A couple of optional details so the app feels less like a form.
                Both are skip-able — leave blank to stay anonymous, and we&apos;ll
                still build your plan.
              </div>
            </div>
            <Field
              label="Your name (optional)"
              value={displayName}
              onChange={setDisplayName}
              hint="Used only as a greeting. Stays in your browser."
            />
            <div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--muted)',
                  marginBottom: 6,
                }}
              >
                Age bracket (optional)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {AGE_BRACKETS.map((b) => {
                  const selected = ageBracket === b.value;
                  return (
                    <button
                      key={b.value}
                      type="button"
                      onClick={() =>
                        setAgeBracket(selected ? '' : b.value)
                      }
                      style={{
                        padding: '7px 14px',
                        borderRadius: 999,
                        border: `1px solid ${
                          selected ? 'var(--accent)' : 'var(--border)'
                        }`,
                        background: selected ? 'var(--accent)' : 'var(--card)',
                        color: selected ? '#fff' : 'var(--ink)',
                        fontSize: 13,
                        cursor: 'pointer',
                      }}
                    >
                      {b.label}
                    </button>
                  );
                })}
              </div>
              <div
                className="muted"
                style={{ fontSize: 11, marginTop: 6, lineHeight: 1.5 }}
              >
                Helps us tune nudges later — e.g. emergency-fund-first under 25,
                retirement check at 50+. Never used for math.
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
              <Select
                label="Country"
                value={country}
                onChange={(v: Country) => {
                  setCountry(v);
                  if (v !== 'US') setIsNriUs(false);
                }}
                options={[
                  { value: 'IN' as Country, label: 'India' },
                  { value: 'US' as Country, label: 'USA' },
                ]}
              />
              <div />
            </div>
            {country === 'US' && (
              <label
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                  padding: '10px 12px',
                  border: '1px dashed var(--dash)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13,
                  lineHeight: 1.55,
                }}
              >
                <input
                  type="checkbox"
                  checked={isNriUs}
                  onChange={(e) => setIsNriUs(e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <strong>I&apos;m an NRI on a US work visa</strong> with debts back
                  in India (home loan, family obligations).
                  <br />
                  <span className="muted" style={{ fontSize: 12 }}>
                    Turns on per-loan currency tagging (INR / USD) and auto-fills
                    the NRI prepay tool. You stay US-resident for tax purposes.
                  </span>
                </span>
              </label>
            )}
          </div>
        )}

        {step === 2 && (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
            <Select
              label="Income type"
              value={incomeType}
              onChange={setIncomeType}
              options={[
                { value: 'salaried' as IncomeType, label: 'Salaried' },
                { value: 'business_owner' as IncomeType, label: 'Business owner / self-employed' },
              ]}
              info={
                <>
                  <strong>Salaried</strong> = fixed monthly inflow from an
                  employer, EPF + TDS already deducted.{' '}
                  <strong>Self-employed / business owner</strong> = variable
                  income from your own work. The engine handles surplus
                  calculations slightly differently for each.
                </>
              }
            />
            <Field
              label={`In-hand salary (${country === 'IN' ? '₹' : '$'}/month, after TDS + PF)`}
              value={monthlyIncome}
              onChange={setMonthlyIncome}
              hint={
                country === 'IN'
                  ? "What actually hits your account each month — NOT your CTC. Skip bonuses; add via Tools › Windfall."
                  : 'Take-home, post-tax, post-401(k). Add bonuses via Tools › Windfall.'
              }
              info={
                country === 'IN' ? (
                  <>
                    The amount your bank account receives each month — <em>NOT</em>{' '}
                    your CTC.
                    <br />
                    <br />
                    <strong>CTC</strong> (Cost to Company) is the full annual
                    package including employer's PF contribution, gratuity, and
                    insurance — most of which you never see in your account.
                    <br />
                    <br />
                    <strong>In-hand salary</strong> = CTC minus employer PF
                    minus gratuity minus your employee PF minus{' '}
                    <strong>TDS</strong> minus professional tax. This is what
                    you can actually spend.
                    <br />
                    <br />
                    <strong>What's TDS?</strong> Your employer estimates your
                    annual income tax and withholds a slice each month before
                    paying you. The number you enter here is already net of
                    that — don't subtract tax again.
                    <br />
                    <br />
                    Skip annual bonuses and one-off incentives — log them via
                    Tools › Windfall when they actually credit.
                  </>
                ) : (
                  <>
                    Take-home pay each month, <strong>after</strong> federal /
                    state tax withholding and 401(k) contributions. NOT your
                    gross salary. Add bonuses separately via Tools › Windfall.
                  </>
                )
              }
            />
            {country === 'US' && (
              <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
                <Select
                  label="Filing status"
                  value={filingStatus}
                  onChange={setFilingStatus}
                  options={[
                    { value: 'single' as FilingStatusUS, label: 'Single' },
                    { value: 'mfj' as FilingStatusUS, label: 'Married, filing jointly' },
                    { value: 'hoh' as FilingStatusUS, label: 'Head of household' },
                  ]}
                  info={
                    <>
                      Drives which IRS slab table applies to your federal
                      income. <strong>MFJ</strong> doubles the single-filer
                      slabs; <strong>HoH</strong> sits between single and MFJ
                      in the lower brackets, merges with single at the top.
                    </>
                  }
                />
                <Field
                  label="State marginal rate (optional)"
                  value={stateMarginalRate}
                  onChange={setStateMarginalRate}
                  hint="e.g. 0.0682 for CA top, 0 for TX/FL/WA"
                  info={
                    <>
                      Your <strong>state income tax</strong> marginal rate as
                      a decimal. Added on top of federal marginal_rate when
                      computing tax savings on deductible interest. Leave
                      blank if your state has no income tax (TX, FL, WA, NV,
                      TN, AK, SD, WY, NH).
                    </>
                  }
                />
              </div>
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
                    ? setAnnualGrossSalary
                    : setAnnualBusinessIncome
                }
              />
            </div>
            {incomeType === 'salaried' && (
              <div style={{ gridColumn: '1 / -1' }}>
                <Field
                  label={`Tax on non-TDS income (${country === 'IN' ? '₹' : '$'}/year, optional)`}
                  value={extraIncomeAnnualTax}
                  onChange={setExtraIncomeAnnualTax}
                  hint="Skip if all your income is salary. Otherwise: rough estimate of tax you owe on rental, interest, gains, or freelance."
                  info={
                    <>
                      <strong>Most salaried users leave this blank.</strong>{' '}
                      Employer TDS already covers your salary's tax.
                      <br />
                      <br />
                      Fill this only if you have <strong>income outside salary</strong>:
                      rental, FD interest above{' '}
                      {country === 'IN' ? '₹40k' : '$10'}, capital gains, freelance
                      side-income. Rough estimate is fine — multiply your
                      expected non-salary income by your tax rate.
                      <br />
                      <br />
                      When &gt; 0, /debts shows a <strong>tax sleeve</strong> card
                      with the next advance-tax installment date{' '}
                      {country === 'IN'
                        ? '(Jun 15 / Sep 15 / Dec 15 / Mar 15)'
                        : '(Apr 15 / Jun 15 / Sep 15 / Jan 15)'}{' '}
                      and how much you need to set aside.
                    </>
                  }
                />
              </div>
            )}
            {!showDetailedExpenses ? (
              <div style={{ gridColumn: '1 / -1' }}>
                <Field
                  label="Monthly expenses"
                  value={fixedExpenses}
                  onChange={setFixedExpenses}
                  hint="Rent, food, utilities, subscriptions — all non-debt outflows"
                  info={
                    <>
                      Everything non-debt: rent, groceries, fuel, utilities,
                      eating out, subscriptions, school fees. One rough
                      number is fine — best estimate works.
                      <br />
                      <br />
                      <strong>Don't include income tax</strong> — your monthly
                      income is post-tax (take-home), so tax is already
                      accounted for.
                      <br />
                      <br />
                      If you want the What-if "trim spending" slider on
                      /plan to operate on just the squeezable bucket (eating
                      out, shopping) instead of your rent, use the detailed
                      breakdown below.
                    </>
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowDetailedExpenses(true)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--accent)',
                    padding: 0,
                    marginTop: 6,
                    fontSize: 11,
                    letterSpacing: '0.04em',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                  }}
                >
                  Add detailed breakdown ▸
                </button>
              </div>
            ) : (
              <>
                <Field
                  label="Monthly fixed expenses"
                  value={fixedExpenses}
                  onChange={setFixedExpenses}
                  hint="Rent, utilities, school fees — locked"
                  info={
                    <>
                      Recurring <strong>locked-in</strong> non-debt outflows:
                      rent (not loan EMI), utilities, school fees, insurance
                      premiums. You'd need to make a real change (move,
                      switch plan) to cut these.
                    </>
                  }
                />
                <div>
                  <Field
                    label="Monthly variable / discretionary spending"
                    value={variableExpenses}
                    onChange={setVariableExpenses}
                    hint="Eating out, travel, shopping — squeezable"
                    info={
                      <>
                        Discretionary outflows: eating out, entertainment,
                        travel, shopping, subscriptions. The number you'd
                        cut into if you needed to free up cash.
                        <br />
                        <br />
                        Splitting this out makes the{' '}
                        <strong>What-if "trim spending"</strong> slider on
                        /plan honest — it operates on this bucket, not on
                        your rent.
                      </>
                    }
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setVariableExpenses('');
                      setShowDetailedExpenses(false);
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--muted)',
                      padding: 0,
                      marginTop: 6,
                      fontSize: 11,
                      letterSpacing: '0.04em',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                    }}
                  >
                    ← Use combined expenses
                  </button>
                </div>
              </>
            )}
            <BankCombobox
              label="Primary bank"
              value={primaryBank}
              onChange={setPrimaryBank}
              country={country}
              info={
                <>
                  Your salary account. <strong>Doesn't affect the math</strong> —
                  used by Tools › Cash-yield to suggest sweep / liquid-fund
                  options for the bank you already use.
                </>
              }
            />
            <div style={{ gridColumn: '1 / -1' }}>
              <OtherBanksField
                country={country}
                primaryBank={primaryBank}
                value={otherBanks}
                onAdd={(name) => {
                  const trimmed = name.trim();
                  if (!trimmed) return;
                  if (trimmed === primaryBank) return;
                  if (otherBanks.includes(trimmed)) return;
                  setOtherBanks([...otherBanks, trimmed]);
                  setNewOtherBank('');
                }}
                onRemove={(name) =>
                  setOtherBanks(otherBanks.filter((b) => b !== name))
                }
                draft={newOtherBank}
                onDraftChange={setNewOtherBank}
              />
            </div>
            <Field
              label="Expected annual income hike (decimal)"
              value={annualHikeRate}
              onChange={setAnnualHikeRate}
              hint="e.g. 0.08 for 8%. Leave 0 if uncertain."
              info={
                <>
                  Yearly raise you expect, as a decimal.{' '}
                  <strong>0.08 = 8%</strong>. The simulation applies it once
                  every 12 months, on the month you pick below. Use 0 if
                  uncertain — better to be conservative. You can also toggle
                  the hike off entirely on the Plan page to compare flat-income
                  vs growing-income scenarios.
                </>
              }
            />
            <Select
              label="Hike applies in"
              value={String(hikeEffectiveMonth)}
              onChange={(v) => {
                setHikeEffectiveMonth(Number(v));
                setHikeMonthTouched(true);
              }}
              options={MONTH_NAMES.map((name, i) => ({
                value: String(i + 1),
                label: name,
              }))}
              info={
                country === 'IN' ? (
                  <>
                    The calendar month your hike usually kicks in.{' '}
                    <strong>Default: April</strong> (FY-1) — most Indian
                    salaried employees get appraised in March and the new salary
                    lands in April. Government / PSU staff often follow the
                    same cycle. Pick a different month if your employer's cycle
                    differs (Jan / July / your work-anniversary month, etc.).
                  </>
                ) : (
                  <>
                    The calendar month your hike usually kicks in.{' '}
                    <strong>Default: January</strong> (calendar-year start).
                    Pick your work-anniversary month, or whatever your employer
                    uses for annual raises.
                  </>
                )
              }
            />
            <div style={{ gridColumn: '1 / -1' }}>
              <HikeScheduleEditor
                phases={hikeSchedule}
                onChange={setHikeSchedule}
                fallbackRate={annualHikeRate}
              />
            </div>
            <Field
              label="Your marginal tax rate (decimal)"
              value={marginalRate}
              onChange={setMarginalRate}
              hint="Drives invest-vs-prepay math. e.g. 0.30 for 30%"
              info={
                country === 'IN' ? (
                  <>
                    Tax on your <strong>next ₹</strong> of income — not your
                    average rate.
                    <br />
                    <br />
                    <strong>New regime (FY 2025-26):</strong>
                    <br />
                    • ₹0–4L: 0%
                    <br />
                    • ₹4–8L: 5%
                    <br />
                    • ₹8–12L: 10%
                    <br />
                    • ₹12–15L: 15%
                    <br />
                    • ₹15–20L: 20%
                    <br />
                    • Above ₹20L: 30%
                    <br />
                    <br />
                    The engine uses this to decide whether prepaying debt or
                    investing the surplus is better for you.
                  </>
                ) : (
                  <>
                    Tax on your <strong>next $</strong> of income — not your
                    average rate. Federal marginal rate plus state. For most
                    salaried filers in 2026: 22–32% federal, plus state. The
                    engine uses this for invest-vs-prepay decisions.
                  </>
                )
              }
            />
            {country === 'IN' && (
              <Select
                label="Tax regime"
                value={taxRegime}
                onChange={setTaxRegime}
                options={[
                  { value: 'new' as TaxRegimeIN, label: 'New (default)' },
                  { value: 'old' as TaxRegimeIN, label: 'Old (with 80C / HRA / 24b)' },
                ]}
                info={
                  <>
                    <strong>New regime (default):</strong> lower flat rates, no
                    deductions allowed.
                    <br />
                    <br />
                    <strong>Old regime:</strong> higher rates, but you can claim
                    80C (₹1.5L), HRA, 80D, 80E, NPS top-up, and home-loan
                    interest under section 24b (up to ₹2L on self-occupied
                    property). Pick whichever you've filed under — if you
                    pick old, the deductions panel below captures the numbers
                    we use to derive your true marginal rate.
                  </>
                }
              />
            )}
            <DeductionsPanel
              country={country}
              taxRegime={taxRegime}
              filingStatus={filingStatus}
              ageBracket={ageBracket || undefined}
              grossAnnual={
                incomeType === 'salaried' ? annualGrossSalary : annualBusinessIncome
              }
              stateMarginalRate={stateMarginalRate}
              value={deductions}
              onChange={setDeductions}
            />
            <IncomeStreamsPanel
              country={country}
              value={incomeStreams}
              onChange={setIncomeStreams}
            />
          </div>
        )}

        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {loans.map((l, i) => (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gap: 12,
                  gridTemplateColumns: '1fr 1fr',
                  padding: 12,
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  position: 'relative',
                }}
              >
                <Select
                  label="Loan type"
                  value={l.loan_type}
                  onChange={(v) => updateLoan(i, { loan_type: v })}
                  options={LOAN_TYPES}
                  info={
                    <>
                      <strong>Credit cards</strong> and <strong>BNPL</strong>{' '}
                      are revolving — no fixed payoff date.{' '}
                      <strong>Home / auto / personal / education / gold</strong>{' '}
                      loans amortize over a tenure. Determines how the engine
                      prices each line.
                    </>
                  }
                />
                <BankCombobox
                  label="Bank / lender"
                  value={l.bank}
                  onChange={(v) => updateLoan(i, { bank: v })}
                  country={country}
                  info={
                    <>
                      The institution holding this debt. Tap to open the list,
                      type to filter. If your lender isn't shown, type it
                      manually — free text is accepted.
                    </>
                  }
                />
                <Field
                  label="Outstanding balance"
                  value={l.outstanding}
                  onChange={(v) => updateLoan(i, { outstanding: v })}
                  info={
                    <>
                      How much you still owe <strong>today</strong>.
                      <br />
                      <br />
                      For instalment loans (home, auto, personal): the{' '}
                      <strong>remaining principal</strong>, not the original
                      loan amount.
                      <br />
                      <br />
                      For credit cards: the <strong>unpaid statement
                      balance</strong> you'd see on your latest statement.
                    </>
                  }
                />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <Field
                    label="Nominal rate (decimal)"
                    value={l.nominal_rate}
                    onChange={(v) => updateLoan(i, { nominal_rate: v })}
                    hint="e.g. 0.085 for 8.5%"
                    info={
                      <>
                        The <strong>headline interest rate</strong> your bank
                        advertises. <strong>Doesn't include</strong> GST,
                        processing fees, or other charges.
                        <br />
                        <br />
                        Enter as a decimal: <strong>0.085</strong> for 8.5%,{' '}
                        <strong>0.36</strong> for 36%.
                        <br />
                        <br />
                        The Debts view will show your true <strong>effective
                        APR</strong> (nominal + 18% GST on interest + annualized
                        fees) so you see the real cost.
                      </>
                    }
                  />
                  <RateRangeHint
                    bank={l.bank}
                    loanType={l.loan_type}
                    userRate={l.nominal_rate}
                    variant="inline"
                    incomeType={incomeType}
                    country={country}
                    monthlyIncome={Number(monthlyIncome) || undefined}
                    creditScore={Number(creditScore) || null}
                    onUsePrediction={(rate) =>
                      updateLoan(i, { nominal_rate: rate })
                    }
                  />
                </div>
                <Select
                  label="Rate type"
                  value={l.rate_type}
                  onChange={(v) => updateLoan(i, { rate_type: v })}
                  options={[
                    { value: 'floating' as const, label: 'Floating' },
                    { value: 'fixed' as const, label: 'Fixed' },
                  ]}
                  info={
                    <>
                      <strong>Floating</strong> = rate moves when RBI repo or
                      your lender's benchmark changes. Most home loans in India
                      today.
                      <br />
                      <br />
                      <strong>Fixed</strong> = locked for the loan's life. Most
                      personal loans and credit cards.
                    </>
                  }
                />
                {isNriUs && (
                  <Select
                    label="Currency"
                    value={l.currency ?? 'USD'}
                    onChange={(v: 'INR' | 'USD') =>
                      updateLoan(i, { currency: v })
                    }
                    options={[
                      { value: 'USD' as const, label: 'USD ($) — US loan' },
                      { value: 'INR' as const, label: 'INR (₹) — Indian loan' },
                    ]}
                    info={
                      <>
                        Which currency is this loan denominated in? An NRI on a
                        US work visa typically has both: a USD car loan or US
                        credit card, and an INR home loan or family obligation
                        back in India. Tag each so the NRI prepay tool can
                        autofill currencies + FX correctly.
                      </>
                    }
                  />
                )}
                <TenureField
                  loan={l}
                  manualMode={manualTenureIdxs.has(i)}
                  onChangeTenure={(v) =>
                    updateLoan(i, { tenure_months_remaining: Number(v) || 0 })
                  }
                  onSetManual={(manual) => setTenureMode(i, manual)}
                />
                <Field
                  label="Bank-required EMI"
                  value={l.scheduled_emi}
                  onChange={(v) => updateLoan(i, { scheduled_emi: v })}
                  info={
                    <>
                      The <strong>contractual monthly amount</strong> the bank
                      auto-debits — not what you actually pay if you overpay.
                      <br />
                      <br />
                      Anything you pay above this number is captured as a{' '}
                      <strong>paid_extra</strong> entry in the Activity
                      ledger, or routed by the avalanche/snowball strategy as
                      surplus.
                      <br />
                      <br />
                      For credit cards: your usual payment amount, or{' '}
                      <strong>0</strong> if you only ever pay the minimum.
                    </>
                  }
                />
                {l.loan_type === 'credit_card' && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <MinPaymentExplainer
                      loan={l}
                      country={country}
                      onOverrideChange={(v) =>
                        updateLoan(i, { min_payment_override: v })
                      }
                    />
                  </div>
                )}
                {l.loan_type === 'credit_card' && (
                  <Field
                    label="Expected monthly spend on this card"
                    value={l.expected_monthly_spend ?? ''}
                    onChange={(v) =>
                      updateLoan(i, { expected_monthly_spend: v })
                    }
                    placeholder="0"
                    hint="0 if you've frozen the card; bake in real spend otherwise"
                    info={
                      <>
                        Roughly how much you usually <strong>charge</strong> to
                        this card each month — groceries, fuel, subscriptions.
                        <br />
                        <br />
                        /plan adds this to your outstanding before computing
                        each month&apos;s minimum, so the trajectory shows
                        what will <em>actually</em> happen at your current
                        usage rate, not the optimistic &quot;freeze the
                        card&quot; assumption.
                        <br />
                        <br />
                        Leave at <strong>0</strong> if you&apos;ve already
                        stopped using the card and are paying it down.
                      </>
                    }
                  />
                )}
                {l.loan_type === 'credit_card' && (
                  <Field
                    label="Statement day (1-28, optional)"
                    value={l.statement_day != null ? String(l.statement_day) : ''}
                    onChange={(v) => {
                      const n = Number(v);
                      updateLoan(i, {
                        statement_day:
                          v.trim() === '' || Number.isNaN(n) || n < 1 || n > 28
                            ? undefined
                            : n,
                      });
                    }}
                    placeholder="e.g. 5"
                    hint="Day-of-month your statement is generated"
                    info={
                      <>
                        The day each month your bank generates the bill for
                        this card. Used to frame the activity log around your
                        actual cycle (&quot;May 5 statement, due May 25&quot;)
                        instead of generic &quot;this month&quot;.
                        <br />
                        <br />
                        Doesn&apos;t change interest math — the engine still
                        accrues monthly. Optional; leave blank if you&apos;d
                        rather not specify.
                      </>
                    }
                  />
                )}
                {l.loan_type === 'credit_card' && l.statement_day != null && (
                  <Field
                    label="Due day (1-28)"
                    value={
                      l.due_day != null
                        ? String(l.due_day)
                        : String(
                            ((l.statement_day - 1 +
                              suggestedGraceDays(l.bank, country)) %
                              28) +
                              1,
                          )
                    }
                    onChange={(v) => {
                      const n = Number(v);
                      updateLoan(i, {
                        due_day:
                          v.trim() === '' || Number.isNaN(n) || n < 1 || n > 28
                            ? undefined
                            : n,
                      });
                    }}
                    placeholder={String(
                      ((l.statement_day - 1 +
                        suggestedGraceDays(l.bank, country)) %
                        28) +
                        1,
                    )}
                    hint={`Pre-filled from ${l.bank || 'country default'} (${suggestedGraceDays(l.bank, country)}-day grace) — override if your card differs`}
                    info={
                      <>
                        The day your payment is due each cycle. Indian banks
                        give 18-26 days grace from statement to due; US banks
                        21-25 days (CARD Act ≥21).
                        <br />
                        <br />
                        We pre-fill from a registry of typical grace periods
                        per bank. If your specific card differs (some premium
                        variants give longer), override here.
                      </>
                    }
                  />
                )}
                <Field
                  label="Processing fee / yr (decimal, optional)"
                  value={l.processing_fee_amortised ?? ''}
                  onChange={(v) => updateLoan(i, { processing_fee_amortised: v })}
                  hint="Annualised. Leave blank for cards. e.g. 0.005 = 0.5%/yr"
                  info={
                    <>
                      One-time processing fee, amortised across the loan's
                      tenure. Personal loans typically <strong>1-2%</strong>{' '}
                      upfront; home loans <strong>0.25-0.50%</strong>; auto
                      loans <strong>0.5-1%</strong>.
                      <br />
                      <br />
                      Enter the <strong>annualised</strong> value. If your
                      personal loan charges 1.5% upfront on a 3-year tenure,
                      that's 0.5%/yr → enter <strong>0.005</strong>.
                      <br />
                      <br />
                      Leave blank for credit cards (annual fee separately).
                    </>
                  }
                />
                <Field
                  label="Insurance premium / yr (decimal, optional)"
                  value={l.insurance_premium_pct ?? ''}
                  onChange={(v) => updateLoan(i, { insurance_premium_pct: v })}
                  hint="e.g. 0.001 = 0.1%/yr; leave blank if none"
                  info={
                    <>
                      Some lenders bundle loan-protection insurance (technically
                      optional but often pushed). Enter as a decimal pct/yr.
                      Leave blank if you declined or weren't offered insurance.
                    </>
                  }
                />
                <div style={{ gridColumn: '1 / -1' }}>
                  <EffectiveAprBreakdown
                    loan={l}
                    marginalTaxRate={marginalRate || '0.30'}
                    country={country}
                    taxRegime={country === 'IN' ? taxRegime : undefined}
                    incomeType={incomeType}
                  />
                </div>
                {loans.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLoan(i)}
                    style={{
                      gridColumn: '1 / -1',
                      padding: '6px 10px',
                      fontSize: 12,
                      background: 'transparent',
                      color: 'var(--negative)',
                      border: '1px solid var(--negative)',
                      borderRadius: 4,
                      cursor: 'pointer',
                      justifySelf: 'end',
                    }}
                  >
                    Remove this loan
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addLoan}
              style={{
                padding: '8px 14px',
                fontSize: 13,
                background: 'transparent',
                color: 'var(--accent)',
                border: '1px solid var(--accent)',
                borderRadius: 6,
                cursor: 'pointer',
                alignSelf: 'flex-start',
              }}
            >
              + Add another loan
            </button>
          </div>
        )}

        {step === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {cashAccounts.length === 0 && (
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
                <Field
                  label="Total savings balance"
                  value={savingsBalance}
                  onChange={setSavingsBalance}
                  hint="Excludes locked retirement accounts"
                  info={
                    <>
                      Liquid funds you can access within a few days — savings
                      accounts, FDs, liquid mutual funds.{' '}
                      <strong>Excludes</strong> EPF, NPS, 401(k), PPF, and other
                      locked instruments.
                    </>
                  }
                />
                <div style={{ alignSelf: 'end', paddingBottom: 6 }}>
                  <button
                    type="button"
                    onClick={() =>
                      setCashAccounts([
                        {
                          name: country === 'IN' ? 'Primary savings' : 'Checking',
                          balance: savingsBalance,
                          apy: '',
                          kind: country === 'IN' ? 'savings' : 'checking',
                        },
                      ])
                    }
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      color: 'var(--accent)',
                      fontSize: 12,
                      cursor: 'pointer',
                      padding: '6px 10px',
                      borderRadius: 6,
                    }}
                  >
                    + Split by account (recommended)
                  </button>
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    Tracking each account with its APY lets the advisor compare
                    idle cash against debt payoff (e.g. 0.01% checking vs 24%
                    card).
                  </div>
                </div>
              </div>
            )}

            {cashAccounts.length > 0 && (
              <div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  <strong style={{ color: 'var(--ink)' }}>Cash accounts.</strong>{' '}
                  Each one — checking, savings, HYSA, FD. APY can be 0 if you
                  don't know it; you can update later.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {cashAccounts.map((acct, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1.4fr 1fr 0.8fr 1fr auto',
                        gap: 8,
                        alignItems: 'end',
                      }}
                    >
                      <Field
                        label="Account name"
                        value={acct.name}
                        onChange={(v) =>
                          setCashAccounts((cur) =>
                            cur.map((a, i) => (i === idx ? { ...a, name: v } : a)),
                          )
                        }
                        hint={idx === 0 ? 'e.g. Chase Checking, Ally HYSA' : undefined}
                      />
                      <Field
                        label={`Balance (${country === 'IN' ? '₹' : '$'})`}
                        value={acct.balance}
                        onChange={(v) =>
                          setCashAccounts((cur) =>
                            cur.map((a, i) => (i === idx ? { ...a, balance: v } : a)),
                          )
                        }
                      />
                      <Field
                        label="APY (%)"
                        value={acct.apy === '' ? '' : String(Number(acct.apy) * 100)}
                        onChange={(v) =>
                          setCashAccounts((cur) =>
                            cur.map((a, i) =>
                              i === idx
                                ? {
                                    ...a,
                                    apy:
                                      v.trim() === ''
                                        ? ''
                                        : String(Number(v) / 100),
                                  }
                                : a,
                            ),
                          )
                        }
                        hint={idx === 0 ? 'e.g. 4.5' : undefined}
                      />
                      <Select
                        label="Kind"
                        value={acct.kind}
                        onChange={(v) =>
                          setCashAccounts((cur) =>
                            cur.map((a, i) =>
                              i === idx
                                ? { ...a, kind: v as typeof acct.kind }
                                : a,
                            ),
                          )
                        }
                        options={[
                          { value: 'checking', label: 'Checking' },
                          { value: 'savings', label: 'Savings' },
                          { value: 'hysa', label: 'HYSA' },
                          { value: 'fd', label: 'FD' },
                          { value: 'other', label: 'Other' },
                        ]}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setCashAccounts((cur) => cur.filter((_, i) => i !== idx))
                        }
                        aria-label="Remove account"
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--border)',
                          color: 'var(--muted-ink)',
                          padding: '6px 10px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          height: 38,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setCashAccounts((cur) => [
                      ...cur,
                      { name: '', balance: '', apy: '', kind: 'savings' },
                    ])
                  }
                  style={{
                    marginTop: 10,
                    background: 'transparent',
                    border: '1px dashed var(--border)',
                    color: 'var(--accent)',
                    fontSize: 12,
                    cursor: 'pointer',
                    padding: '6px 10px',
                    borderRadius: 6,
                  }}
                >
                  + Add another account
                </button>
                <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                  Total optimizable (excluding checking):{' '}
                  <strong style={{ color: 'var(--ink)' }}>
                    {formatCurrency(
                      String(
                        cashAccounts
                          .filter((a) => a.kind !== 'checking')
                          .reduce((s, a) => s + Number(a.balance || 0), 0),
                      ),
                      country === 'IN' ? 'INR' : 'USD',
                    )}
                  </strong>
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
              <Field
                label="Emergency fund — current"
                value={efundBalance}
                onChange={setEfundBalance}
                info={
                  <>
                    The portion of your savings you've earmarked for emergencies.
                    Often kept in a separate sweep or liquid fund so it isn't
                    spent by accident.
                  </>
                }
              />
              <Field
                label="Emergency fund — target"
                value={efundTarget}
                onChange={setEfundTarget}
                hint="Pick a tier below, or enter your own number"
                info={
                  <>
                    The "Lean / Standard / Conservative" buttons below set this
                    to 3 / 6 / 9 months of your stated expenses respectively.
                    /plan diverts 30% of each month's surplus into EF top-up
                    until this target is met — debt-free is pushed out a bit
                    in exchange for a real safety net.
                  </>
                }
              />
            </div>

            <EfTierPicker
              monthlyExpenses={fixedExpenses}
              variableExpenses={variableExpenses}
              efundBalance={efundBalance}
              currency={country === 'IN' ? 'INR' : 'USD'}
              currentTarget={efundTarget}
              onPick={(t) => setEfundTarget(t)}
              monthlyIncome={monthlyIncome}
              loans={loans}
            />
          </div>
        )}

        {step === 5 && (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
            <Field
              label="Current credit score (optional)"
              value={creditScore}
              onChange={setCreditScore}
              hint={
                country === 'IN'
                  ? 'CIBIL/Experian — 300 to 900'
                  : 'FICO/VantageScore — 300 to 850'
              }
              info={
                country === 'IN' ? (
                  <>
                    <strong>India:</strong> CIBIL or Experian, range 300-900.
                    Used only to flag which tool actions might affect your
                    score — never to gate features. Skip if you don't know it.
                  </>
                ) : (
                  <>
                    <strong>US:</strong> FICO or VantageScore, range 300-850.
                    Used only to flag which tool actions might affect your
                    score — never to gate features. Skip if you don't know it.
                  </>
                )
              }
            />
            <div className="muted" style={{ fontSize: 12, alignSelf: 'end' }}>
              Used for the score-impact chips on each tool. Skip if you don't know it.
            </div>
          </div>
        )}

        {step === 6 && (
          <ReviewSummary
            displayName={displayName}
            ageBracket={ageBracket || undefined}
            country={country}
            incomeType={incomeType}
            monthlyIncome={monthlyIncome}
            annualGrossSalary={annualGrossSalary}
            annualBusinessIncome={annualBusinessIncome}
            fixedExpenses={fixedExpenses}
            variableExpenses={variableExpenses}
            showDetailedExpenses={showDetailedExpenses}
            annualHikeRate={annualHikeRate}
            hikeSchedule={hikeSchedule}
            taxRegime={taxRegime}
            filingStatus={filingStatus}
            stateMarginalRate={stateMarginalRate}
            loans={loans}
            primaryBank={primaryBank}
            otherBanks={otherBanks}
            savingsBalance={savingsBalance}
            efundBalance={efundBalance}
            efundTarget={efundTarget}
            creditScore={creditScore}
            onJumpToStep={(s) => setStep(s)}
          />
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 20,
            gap: 12,
          }}
        >
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            style={{
              padding: '8px 16px',
              fontSize: 14,
              background: 'transparent',
              color: 'var(--muted)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              cursor: step === 0 ? 'not-allowed' : 'pointer',
              opacity: step === 0 ? 0.4 : 1,
            }}
          >
            ← Back
          </button>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={!canAdvance}
              className="btn btn-primary"
              style={{ opacity: canAdvance ? 1 : 0.4, cursor: canAdvance ? 'pointer' : 'not-allowed' }}
            >
              Next →
            </button>
          ) : (
            <button
              type="button"
              onClick={save}
              className="btn btn-primary"
            >
              Save profile &amp; see my plan
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}

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
function HikeScheduleEditor({
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
          Hike phases (optional)
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
          + Add hike phase
        </button>
      </div>
      <div style={{ color: 'var(--muted)', marginBottom: 8 }}>
        Use this if you expect different hike rates across the plan — e.g.
        "7% for the first 2 years, then 10% after a likely job switch."
        Years outside any phase fall back to your scalar hike above
        ({fallbackRate || '0'}).
      </div>
      {phases.length === 0 && (
        <div style={{ color: 'var(--muted)', fontStyle: 'italic', fontSize: 11 }}>
          No phases configured. The simulation uses your scalar hike rate uniformly.
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
            borderLeft: '2px solid var(--warning, #c97800)',
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
                    NPS — collectively <strong>80C</strong>, capped at ₹1.5L)
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
            we'll use the marginal-rate field on Step 4 instead. When filled,
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
            fontSize: 12,
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
            <div style={{ color: 'var(--muted)', marginTop: 2, fontSize: 11 }}>
              Computed under{' '}
              <strong>{taxRegime === 'old' ? 'old' : 'new'} regime</strong>
              {taxRegime !== 'old' && (
                <> · rebate u/s 87A keeps taxable income ≤ ₹12L tax-free</>
              )}
            </div>
          )}
          {advanceTaxApplies && (
            <div
              style={{
                marginTop: 6,
                padding: '6px 8px',
                background: 'var(--soft-bg, rgba(255,180,0,0.08))',
                borderLeft: '2px solid var(--warning, #c97800)',
                fontSize: 11,
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

function EfTierPicker({
  monthlyExpenses,
  variableExpenses,
  efundBalance,
  currency,
  currentTarget,
  onPick,
  monthlyIncome,
  loans,
}: {
  monthlyExpenses: string;
  variableExpenses: string;
  efundBalance: string;
  currency: 'INR' | 'USD';
  currentTarget: string;
  onPick: (next: string) => void;
  monthlyIncome: string;
  loans: LoanPayload[];
}) {
  const totalMonthlyExpenses =
    Number(monthlyExpenses || 0) + Number(variableExpenses || 0);
  if (totalMonthlyExpenses <= 0) {
    return (
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        Enter your monthly expenses (step 2) to see tier recommendations.
      </div>
    );
  }

  const income = Number(monthlyIncome || 0);
  const emiSum = loans.reduce(
    (s, l) => s + Number(l.scheduled_emi || 0),
    0,
  );
  const surplus = Math.max(0, income - totalMonthlyExpenses - emiSum);
  const balance = Number(efundBalance || 0);

  const tiers = [
    { id: 'lean' as const, label: 'Lean', months: 3, descr: '3 months of expenses' },
    { id: 'std' as const, label: 'Standard', months: 6, descr: '6 months — recommended' },
    { id: 'cons' as const, label: 'Conservative', months: 9, descr: '9 months — high risk or dependents' },
  ];

  const currentNum = Number(currentTarget || 0);
  const isPicked = (months: number) =>
    Math.abs(currentNum - totalMonthlyExpenses * months) < 1;

  // Months to fill at 30% of surplus per month (the engine's waterfall rate).
  const monthsToFill = (months: number) => {
    const target = totalMonthlyExpenses * months;
    const gap = Math.max(0, target - balance);
    if (gap === 0) return 0;
    if (surplus <= 0) return Infinity;
    return Math.ceil(gap / (surplus * 0.3));
  };

  return (
    <div
      style={{
        marginTop: 4,
        padding: 12,
        background: 'var(--canvas)',
        border: '1px dashed var(--border)',
        borderRadius: 6,
      }}
    >
      <div
        className="muted"
        style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.5 }}
      >
        Tier shortcuts — sets <strong style={{ color: 'var(--ink)' }}>EF target</strong>{' '}
        to N × your stated monthly expenses
        {' ('}
        {formatCurrency(String(totalMonthlyExpenses), currency)}/mo
        {'). '}
        At 30% of your surplus per month, the time-to-fill estimate is shown
        beside each option.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tiers.map((t) => {
          const target = totalMonthlyExpenses * t.months;
          const fill = monthsToFill(t.months);
          const picked = isPicked(t.months);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onPick(String(target))}
              style={{
                flex: '1 1 0',
                minWidth: 140,
                padding: '8px 10px',
                background: picked ? 'var(--accent)' : 'transparent',
                color: picked ? 'var(--canvas)' : 'var(--ink)',
                border: `1px solid ${picked ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 6,
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                {t.label} · {t.months} months
              </div>
              <div style={{ opacity: 0.8 }}>{t.descr}</div>
              <div style={{ marginTop: 4, fontSize: 11 }}>
                Target: {formatCurrency(String(target), currency)}
              </div>
              <div style={{ fontSize: 11, opacity: 0.85 }}>
                {fill === 0
                  ? 'Already met — no waterfall delay'
                  : fill === Infinity
                    ? 'No surplus to top up yet'
                    : `~${fill} month${fill === 1 ? '' : 's'} to fill`}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TenureField({
  loan,
  manualMode,
  onChangeTenure,
  onSetManual,
}: {
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
          Credit cards don&apos;t have a fixed tenure — they revolve until
          cleared. The bank&apos;s min-payment formula drives the trajectory;
          /plan will show how many months you&apos;d need to clear.
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
              ? `Auto-derive would say ≈ ${derived} mo`
              : 'Fill rate + EMI + outstanding above to auto-derive'
          }
          info={
            <>
              How many monthly EMIs are left until this loan is fully paid.
              <br />
              <br />
              You&apos;re in manual mode because you opened the form already
              knowing the exact tenure. If you don&apos;t know it, switch
              back to auto-derive — we&apos;ll compute it from your
              outstanding, EMI, and rate.
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
          Use auto-derived instead
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
              Computed from outstanding + rate + EMI. Most people don&apos;t
              know their tenure off the top of their head — only banks do —
              so we work it out from the three numbers above.
            </div>
          </>
        ) : (
          <>
            <em>Fill outstanding, rate, and EMI above</em> — we&apos;ll
            compute remaining months for you. No need to know it.
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

function OtherBanksField({
  country,
  primaryBank,
  value,
  draft,
  onDraftChange,
  onAdd,
  onRemove,
}: {
  country: Country;
  primaryBank: string;
  value: string[];
  draft: string;
  onDraftChange: (v: string) => void;
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  return (
    <div
      style={{
        padding: 12,
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
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
          Other banks &amp; cards you already use
        </div>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.55 }}>
          Add any bank where you hold a savings, current, NRE/NRO account,
          credit card, or debit card — anything beyond your primary bank,
          loan or no loan. Tools &rsaquo; New-debt and refinance suggestions
          prefer lenders you already have a relationship with: no fresh KYC,
          and often no opening fee or minimum balance.
        </div>
      </div>
      {value.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
          }}
        >
          {value.map((b) => (
            <span
              key={b}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                background: 'var(--soft-bg)',
                border: '1px solid var(--border)',
                borderRadius: 999,
                fontSize: 12,
              }}
            >
              {b}
              <button
                type="button"
                onClick={() => onRemove(b)}
                aria-label={`Remove ${b}`}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--muted)',
                  cursor: 'pointer',
                  fontSize: 14,
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <BankCombobox
            label=""
            value={draft}
            onChange={onDraftChange}
            country={country}
          />
        </div>
        <button
          type="button"
          onClick={() => onAdd(draft)}
          disabled={
            !draft.trim() || draft.trim() === primaryBank || value.includes(draft.trim())
          }
          style={{
            padding: '8px 14px',
            background: 'var(--accent)',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: draft.trim() ? 'pointer' : 'not-allowed',
            fontSize: 13,
            opacity:
              !draft.trim() || draft.trim() === primaryBank || value.includes(draft.trim())
                ? 0.4
                : 1,
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function MinPaymentExplainer({
  loan,
  country,
  onOverrideChange,
}: {
  loan: LoanPayload;
  country: Country;
  onOverrideChange: (value: string) => void;
}) {
  const explanation = explainMinPayment(loan, country);
  if (!explanation) return null;
  const currency = country === 'IN' ? 'INR' : 'USD';
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
              <strong>{explanation.bank}</strong> uses{' '}
              <em>{explanation.formula}</em>. At your current outstanding that
              works out to roughly <strong>{estimatedLabel}</strong>/month — and
              that&apos;s what we treat as the floor when projecting your plan.
            </>
          ) : (
            <>
              We don&apos;t have a formula specific to{' '}
              <strong>{explanation.bank}</strong>, so we fall back to the
              country default: <em>{explanation.formula}</em>. That&apos;s about{' '}
              <strong>{estimatedLabel}</strong>/month at your current
              outstanding — used as the floor unless you override it below.
            </>
          )}
        </div>
      </div>
      <Field
        label="Override minimum payment (optional)"
        value={loan.min_payment_override ?? ''}
        onChange={onOverrideChange}
        hint={
          loan.min_payment_override
            ? `Replaces the ${estimatedLabel} estimate above.`
            : 'Leave blank to use the formula above. Fill in only if your statement shows a different number.'
        }
      />
    </div>
  );
}

/**
 * Final-step review screen. Replaces the old "everything in one paragraph"
 * summary with one card per domain (You / Country / Income / Expenses /
 * Debts / Savings / Credit + banking). Each card has an Edit button that
 * jumps back to the relevant step via onJumpToStep, so a user who realises
 * they mistyped doesn't have to scroll the whole form.
 *
 * Pure render — receives every value as a prop. No business logic.
 */
function ReviewSummary(props: {
  displayName: string;
  ageBracket: AgeBracket | undefined;
  country: Country;
  incomeType: IncomeType;
  monthlyIncome: string;
  annualGrossSalary: string;
  annualBusinessIncome: string;
  fixedExpenses: string;
  variableExpenses: string;
  showDetailedExpenses: boolean;
  annualHikeRate: string;
  hikeSchedule: { from: string; to: string; rate: string }[];
  taxRegime: TaxRegimeIN;
  filingStatus: FilingStatusUS;
  stateMarginalRate: string;
  loans: LoanPayload[];
  primaryBank: string;
  otherBanks: string[];
  savingsBalance: string;
  efundBalance: string;
  efundTarget: string;
  creditScore: string;
  onJumpToStep: (step: number) => void;
}) {
  const {
    displayName, ageBracket, country, incomeType, monthlyIncome,
    annualGrossSalary, annualBusinessIncome, fixedExpenses, variableExpenses,
    showDetailedExpenses, annualHikeRate, hikeSchedule, taxRegime,
    filingStatus, stateMarginalRate, loans, primaryBank, otherBanks,
    savingsBalance, efundBalance, efundTarget, creditScore, onJumpToStep,
  } = props;
  const currency = country === 'IN' ? 'INR' : 'USD';
  const ageLabel = ageBracket
    ? AGE_BRACKETS.find((b) => b.value === ageBracket)?.label ?? ''
    : '';
  const realLoans = loans.filter((l) => Number(l.outstanding) > 0);
  const totalOutstanding = realLoans.reduce(
    (acc, l) => acc + Number(l.outstanding),
    0,
  );
  const hikeRatePct = Number(annualHikeRate) > 0
    ? `${(Number(annualHikeRate) * 100).toFixed(0)}%`
    : '—';
  const hikePhaseSummary = hikeSchedule
    .filter((p) => Number(p.from) > 0 && Number(p.to) > Number(p.from))
    .map((p) => `Y${p.from}-${Number(p.to) - 1} @ ${(Number(p.rate) * 100).toFixed(0)}%`)
    .join(', ');
  const grossLabel =
    incomeType === 'salaried' && Number(annualGrossSalary) > 0
      ? `${formatCurrency(annualGrossSalary, currency)} gross/yr`
      : incomeType === 'business_owner' && Number(annualBusinessIncome) > 0
        ? `${formatCurrency(annualBusinessIncome, currency)} business income/yr`
        : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.55, marginBottom: 2 }}>
        Quick once-over before we save. Click <strong>Edit</strong> on any card
        to jump back. Saving writes a cookie to this browser only — no upload,
        no account.
      </div>

      <ReviewCard title="You" onEdit={() => onJumpToStep(0)}>
        {displayName.trim() || ageLabel ? (
          <>
            {displayName.trim() && <strong>{displayName.trim()}</strong>}
            {displayName.trim() && ageLabel && <span className="muted"> · </span>}
            {ageLabel && <span>{ageLabel}</span>}
          </>
        ) : (
          <span className="muted">Anonymous — no name or age provided.</span>
        )}
      </ReviewCard>

      <ReviewCard title={'Country & residency'} onEdit={() => onJumpToStep(1)}>
        <strong>{country === 'IN' ? 'India' : 'USA'}</strong>
        {country === 'US' && (
          <span className="muted"> · filing as {filingStatus.replace('_', ' ')}</span>
        )}
        {country === 'IN' && (
          <span className="muted"> · {taxRegime === 'new' ? 'New regime' : 'Old regime'}</span>
        )}
        {country === 'US' && Number(stateMarginalRate) > 0 && (
          <span className="muted">
            {' '}· state marginal {(Number(stateMarginalRate) * 100).toFixed(1)}%
          </span>
        )}
      </ReviewCard>

      <ReviewCard title="Income" onEdit={() => onJumpToStep(2)}>
        <strong>{formatCurrency(monthlyIncome || '0', currency)}/mo</strong>{' '}
        take-home
        {grossLabel && <span className="muted"> · {grossLabel}</span>}
        <br />
        <span className="muted" style={{ fontSize: 12 }}>
          Hike {hikePhaseSummary || hikeRatePct}
          {hikePhaseSummary && Number(annualHikeRate) > 0
            ? ` · fallback ${hikeRatePct}`
            : ''}
        </span>
      </ReviewCard>

      <ReviewCard title="Expenses" onEdit={() => onJumpToStep(2)}>
        {showDetailedExpenses ? (
          <>
            <strong>{formatCurrency(fixedExpenses || '0', currency)}/mo</strong> fixed
            <span className="muted"> · </span>
            <strong>{formatCurrency(variableExpenses || '0', currency)}/mo</strong>{' '}
            <span className="muted">variable</span>
          </>
        ) : (
          <>
            <strong>{formatCurrency(fixedExpenses || '0', currency)}/mo</strong>{' '}
            <span className="muted">combined monthly outflows</span>
          </>
        )}
      </ReviewCard>

      <ReviewCard
        title={`Debts (${realLoans.length})`}
        onEdit={() => onJumpToStep(3)}
      >
        {realLoans.length === 0 ? (
          <span className="muted">No active debts entered.</span>
        ) : (
          <>
            <strong>{formatCurrency(String(totalOutstanding), currency)}</strong>{' '}
            <span className="muted">total outstanding</span>
            <div
              style={{
                marginTop: 6,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {realLoans.slice(0, 5).map((l, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {l.bank || '—'} {l.loan_type.replace('_', ' ')} ·{' '}
                  {formatCurrency(l.outstanding, currency)} @{' '}
                  {(Number(l.nominal_rate) * 100).toFixed(2)}%
                </div>
              ))}
              {realLoans.length > 5 && (
                <div className="muted" style={{ fontSize: 11 }}>
                  + {realLoans.length - 5} more
                </div>
              )}
            </div>
          </>
        )}
      </ReviewCard>

      <ReviewCard
        title={'Savings & emergency fund'}
        onEdit={() => onJumpToStep(4)}
      >
        <strong>{formatCurrency(savingsBalance || '0', currency)}</strong>{' '}
        <span className="muted">savings</span>
        {Number(efundTarget) > 0 && (
          <span className="muted">
            {' '}· emergency fund {formatCurrency(efundBalance || '0', currency)} of{' '}
            {formatCurrency(efundTarget, currency)}
          </span>
        )}
      </ReviewCard>

      <ReviewCard title={'Banking & credit'} onEdit={() => onJumpToStep(5)}>
        {primaryBank ? (
          <>
            <strong>{primaryBank}</strong>{' '}
            <span className="muted">primary</span>
            {otherBanks.length > 0 && (
              <span className="muted"> · {otherBanks.length} other</span>
            )}
          </>
        ) : (
          <span className="muted">No primary bank set.</span>
        )}
        <span className="muted"> · CIBIL/FICO {creditScore || '—'}</span>
      </ReviewCard>
    </div>
  );
}

function ReviewCard({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 14px',
        background: 'var(--card)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--muted)',
          }}
        >
          {title}
        </div>
        <button
          type="button"
          onClick={onEdit}
          style={{
            padding: '3px 10px',
            fontSize: 11,
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 999,
            color: 'var(--accent)',
            cursor: 'pointer',
          }}
        >
          Edit
        </button>
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}
