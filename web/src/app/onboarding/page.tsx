'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/Card';
import { BankCombobox, Field, Select, SubmitBar } from '@/components/ToolPrimitives';
import { EffectiveAprBreakdown } from '@/components/EffectiveAprBreakdown';
import { RateRangeHint } from '@/components/RateRangeHint';
import type {
  Country,
  IncomeType,
  LoanPayload,
  LoanType,
  TaxRegimeIN,
  UserPayload,
} from '@/lib/api';
import { loadProfileClient, saveProfileClient } from '@/lib/user-store';
import {
  FY_ANCHOR_MONTH,
  MONTH_NAMES,
  formatCountryDateLong,
} from '@/lib/today';
import { explainMinPayment } from '@/lib/min-payment';
import { formatCurrency } from '@/lib/api';

const STEPS = [
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
  country: 0,
  income: 1,
  loans: 2,
  savings: 3,
  credit: 4,
  review: 5,
};

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
  const [country, setCountry] = useState<Country>('IN');
  const [incomeType, setIncomeType] = useState<IncomeType>('salaried');
  const [monthlyIncome, setMonthlyIncome] = useState('');
  const [fixedExpenses, setFixedExpenses] = useState('');
  const [primaryBank, setPrimaryBank] = useState('');
  const [otherBanks, setOtherBanks] = useState<string[]>([]);
  const [newOtherBank, setNewOtherBank] = useState('');
  const [taxRegime, setTaxRegime] = useState<TaxRegimeIN>('new');
  const [annualHikeRate, setAnnualHikeRate] = useState('');
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

  const [savingsBalance, setSavingsBalance] = useState('');
  const [efundBalance, setEfundBalance] = useState('');
  const [efundTarget, setEfundTarget] = useState('');

  const [creditScore, setCreditScore] = useState('');

  // Rehydrate from the saved profile cookie on mount so re-visiting Setup
  // shows the data the user already entered (not blank defaults).
  // isLive=false means there's no cookie — leave empty defaults in place.
  useEffect(() => {
    const stored = loadProfileClient();
    if (!stored.isLive) return;
    const u = stored.user;
    setCountry(u.country);
    setIncomeType(u.income_type);
    setMonthlyIncome(u.monthly_income ?? '');
    setFixedExpenses(u.fixed_expenses ?? '');
    setPrimaryBank(u.primary_bank ?? '');
    setOtherBanks(u.other_banks ?? []);
    if (u.country === 'IN' && u.tax_regime) setTaxRegime(u.tax_regime);
    setAnnualHikeRate(u.annual_hike_rate ?? '');
    if (u.hike_effective_month) {
      setHikeEffectiveMonth(u.hike_effective_month);
      setHikeMonthTouched(true);
    }
    if (u.loans && u.loans.length > 0) setLoans(u.loans);
    setSavingsBalance(u.savings_balance ?? '');
    setEfundBalance(u.efund_balance ?? '');
    setEfundTarget(u.efund_target ?? '');
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
  }

  // Coalesce empty strings to sensible numeric defaults so the engine accepts
  // the payload even if the user skipped optional fields.
  const num = (v: string, fallback = '0') => (v.trim() === '' ? fallback : v);

  function buildUser(): UserPayload {
    return {
      country,
      income_type: incomeType,
      annual_income: String(Number(num(monthlyIncome)) * 12),
      monthly_income: num(monthlyIncome),
      fixed_expenses: num(fixedExpenses),
      savings_balance: num(savingsBalance),
      primary_bank: primaryBank,
      other_banks: otherBanks,
      location_tier: 'urban',
      tax_regime: country === 'IN' ? taxRegime : undefined,
      efund_balance: num(efundBalance),
      efund_target: num(efundTarget),
      loans: loans
        .filter((l) => Number(l.outstanding) > 0)
        .map((l) => ({
          ...l,
          outstanding: num(l.outstanding),
          nominal_rate: num(l.nominal_rate, '0'),
          scheduled_emi: num(l.scheduled_emi),
          processing_fee_amortised: num(l.processing_fee_amortised ?? '', '0'),
          insurance_premium_pct: num(l.insurance_premium_pct ?? '', '0'),
          ...(l.min_payment_override && l.min_payment_override.trim() !== ''
            ? { min_payment_override: num(l.min_payment_override) }
            : {}),
        })),
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
      inflation_rate: country === 'IN' ? '0.046' : '0.025',
    };
  }

  function save() {
    const score = Number(creditScore);
    saveProfileClient({
      user: buildUser(),
      marginalRate: num(marginalRate, '0.30'),
      creditScore: Number.isFinite(score) && score >= 300 ? score : null,
    });
    router.push('/debts');
  }

  const canAdvance =
    step === 0 ? !!country
      : step === 1 ? Number(monthlyIncome) > 0 && Number(fixedExpenses) >= 0
      : step === 2 ? loans.some((l) => Number(l.outstanding) > 0)
      : step === 3 ? Number(savingsBalance) >= 0
      : step === 4 ? true
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
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
            <Select
              label="Country"
              value={country}
              onChange={setCountry}
              options={[
                { value: 'IN' as Country, label: 'India' },
                { value: 'US' as Country, label: 'USA' },
              ]}
            />
            <div />
          </div>
        )}

        {step === 1 && (
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
              label={`Monthly income (${country === 'IN' ? '₹' : '$'})`}
              value={monthlyIncome}
              onChange={setMonthlyIncome}
              hint={
                country === 'IN'
                  ? 'Take-home credited each month, AFTER EPF + TDS. Skip bonuses — add via Tools › Windfall when they arrive.'
                  : 'Take-home, post-tax, post-401(k). Add bonuses via Tools › Windfall.'
              }
              info={
                country === 'IN' ? (
                  <>
                    What lands in your bank account each month, <strong>after</strong>{' '}
                    EPF and TDS. Don't include annual bonuses or one-off
                    incentives — add those via Tools › Windfall when they arrive.
                  </>
                ) : (
                  <>
                    Take-home pay each month, <strong>after</strong> federal /
                    state tax and 401(k) contributions. Add bonuses separately
                    via Tools › Windfall.
                  </>
                )
              }
            />
            <Field
              label="Monthly fixed expenses"
              value={fixedExpenses}
              onChange={setFixedExpenses}
              hint="Rent, groceries, utilities — non-debt"
              info={
                <>
                  Recurring <strong>non-debt</strong> outflows: rent (not loan
                  EMI), groceries, utilities, fuel, school fees. Whatever you
                  spend every month even if you take no extra action.
                </>
              }
            />
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
                    80C (₹1.5L), HRA, and home-loan interest under section 24b
                    (up to ₹2L on self-occupied property). Pick whichever
                    you've filed under.
                  </>
                }
              />
            )}
          </div>
        )}

        {step === 2 && (
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
                <Field
                  label="Tenure remaining (months)"
                  value={String(l.tenure_months_remaining)}
                  onChange={(v) => updateLoan(i, { tenure_months_remaining: Number(v) || 0 })}
                  kind="integer"
                  hint="0 for revolving credit cards"
                  info={
                    <>
                      How many monthly EMIs are left until this loan is fully
                      paid.
                      <br />
                      <br />
                      For a credit card or any revolving line with no fixed
                      tenure, enter <strong>0</strong>.
                    </>
                  }
                />
                <Field
                  label="Scheduled EMI / monthly payment"
                  value={l.scheduled_emi}
                  onChange={(v) => updateLoan(i, { scheduled_emi: v })}
                  info={
                    <>
                      Your <strong>locked monthly payment</strong> to this
                      lender — the amount that gets auto-debited every month.
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

        {step === 3 && (
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
              hint="Typically 3-6 months of expenses"
              info={
                <>
                  Recommended: <strong>3-6 months of fixed expenses</strong>.
                  This is your buffer so a job loss or medical bill doesn't
                  force new high-rate debt.
                </>
              }
            />
          </div>
        )}

        {step === 4 && (
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

        {step === 5 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 14, lineHeight: 1.6 }}>
              <strong>{country}</strong> · {incomeType} · monthly income {monthlyIncome} ·
              fixed expenses {fixedExpenses}
              <br />
              <strong>{loans.filter((l) => Number(l.outstanding) > 0).length}</strong> loan(s)
              totalling{' '}
              {formatCurrency(
                loans.reduce((acc, l) => acc + Number(l.outstanding), 0),
                country === 'IN' ? 'INR' : 'USD',
              )}
              <br />
              Savings {savingsBalance} · emergency fund {efundBalance} of {efundTarget}
              <br />
              Credit score: {creditScore || '—'}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Saving writes a cookie to this browser only — no upload, no account.
              You can clear it from your browser settings or re-run onboarding.
            </div>
          </div>
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
