'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/Card';
import { Field, Select, SubmitBar } from '@/components/ToolPrimitives';
import type {
  Country,
  IncomeType,
  LoanPayload,
  LoanType,
  TaxRegimeIN,
  UserPayload,
} from '@/lib/api';
import { saveProfileClient } from '@/lib/user-store';

const STEPS = [
  'Country',
  'Income',
  'Loans',
  'Savings',
  'Credit score',
  'Review',
] as const;

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
    outstanding: '0',
    nominal_rate: '0.18',
    rate_type: 'fixed',
    tenure_months_remaining: 0,
    scheduled_emi: '0',
  };
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  // ─── form state ─────────────────────────────────────────────────────────
  const [country, setCountry] = useState<Country>('IN');
  const [incomeType, setIncomeType] = useState<IncomeType>('salaried');
  const [monthlyIncome, setMonthlyIncome] = useState('150000');
  const [fixedExpenses, setFixedExpenses] = useState('45000');
  const [primaryBank, setPrimaryBank] = useState('HDFC Bank');
  const [taxRegime, setTaxRegime] = useState<TaxRegimeIN>('new');
  const [annualHikeRate, setAnnualHikeRate] = useState('0.08');
  const [marginalRate, setMarginalRate] = useState('0.30');

  const [loans, setLoans] = useState<LoanPayload[]>([blankLoan()]);

  const [savingsBalance, setSavingsBalance] = useState('300000');
  const [efundBalance, setEfundBalance] = useState('150000');
  const [efundTarget, setEfundTarget] = useState('300000');

  const [creditScore, setCreditScore] = useState('720');

  function updateLoan(idx: number, patch: Partial<LoanPayload>) {
    setLoans((cur) => cur.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function addLoan() {
    setLoans((cur) => [...cur, blankLoan()]);
  }

  function removeLoan(idx: number) {
    setLoans((cur) => cur.filter((_, i) => i !== idx));
  }

  function buildUser(): UserPayload {
    return {
      country,
      income_type: incomeType,
      annual_income: String(Number(monthlyIncome) * 12),
      monthly_income: monthlyIncome,
      fixed_expenses: fixedExpenses,
      savings_balance: savingsBalance,
      primary_bank: primaryBank,
      location_tier: 'urban',
      tax_regime: country === 'IN' ? taxRegime : undefined,
      efund_balance: efundBalance,
      efund_target: efundTarget,
      loans: loans.filter((l) => Number(l.outstanding) > 0),
      investment_options: [
        {
          name: country === 'IN' ? 'Liquid fund' : 'HYSA',
          expected_return: country === 'IN' ? '0.068' : '0.045',
          liquidity_class: 'liquid',
          is_in_pool: true,
        },
      ],
      annual_hike_rate: annualHikeRate,
      inflation_rate: country === 'IN' ? '0.046' : '0.025',
    };
  }

  function save() {
    const score = Number(creditScore);
    saveProfileClient({
      user: buildUser(),
      marginalRate,
      creditScore: Number.isFinite(score) && score >= 300 ? score : null,
    });
    router.push('/plan');
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
            />
            <Field
              label={`Monthly income (${country === 'IN' ? '₹' : '$'})`}
              value={monthlyIncome}
              onChange={setMonthlyIncome}
              hint="Take-home, post-tax"
            />
            <Field
              label="Monthly fixed expenses"
              value={fixedExpenses}
              onChange={setFixedExpenses}
              hint="Rent, groceries, utilities — non-debt"
            />
            <Field
              label="Primary bank"
              value={primaryBank}
              onChange={setPrimaryBank}
            />
            <Field
              label="Expected annual income hike (decimal)"
              value={annualHikeRate}
              onChange={setAnnualHikeRate}
              hint="e.g. 0.08 for 8%"
            />
            <Field
              label="Your marginal tax rate (decimal)"
              value={marginalRate}
              onChange={setMarginalRate}
              hint="Drives invest-vs-prepay math. e.g. 0.30 for 30%"
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
                />
                <Field
                  label="Bank / lender"
                  value={l.bank}
                  onChange={(v) => updateLoan(i, { bank: v })}
                />
                <Field
                  label="Outstanding balance"
                  value={l.outstanding}
                  onChange={(v) => updateLoan(i, { outstanding: v })}
                />
                <Field
                  label="Nominal rate (decimal)"
                  value={l.nominal_rate}
                  onChange={(v) => updateLoan(i, { nominal_rate: v })}
                  hint="e.g. 0.085 for 8.5%"
                />
                <Select
                  label="Rate type"
                  value={l.rate_type}
                  onChange={(v) => updateLoan(i, { rate_type: v })}
                  options={[
                    { value: 'floating' as const, label: 'Floating' },
                    { value: 'fixed' as const, label: 'Fixed' },
                  ]}
                />
                <Field
                  label="Tenure remaining (months)"
                  value={String(l.tenure_months_remaining)}
                  onChange={(v) => updateLoan(i, { tenure_months_remaining: Number(v) || 0 })}
                  hint="0 for revolving credit cards"
                />
                <Field
                  label="Scheduled EMI / monthly payment"
                  value={l.scheduled_emi}
                  onChange={(v) => updateLoan(i, { scheduled_emi: v })}
                />
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
                background: 'var(--accent-soft)',
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
            />
            <Field
              label="Emergency fund — current"
              value={efundBalance}
              onChange={setEfundBalance}
            />
            <Field
              label="Emergency fund — target"
              value={efundTarget}
              onChange={setEfundTarget}
              hint="Typically 3-6 months of expenses"
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
              {loans
                .reduce((acc, l) => acc + Number(l.outstanding), 0)
                .toLocaleString()}
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
