'use client';

import Decimal from 'decimal.js';
import { useMemo, useState } from 'react';
import { Card } from '@/components/Card';
import {
  AddLoanAction,
  ApplyAction,
  Field,
  InfoTip,
  Select,
  Stat,
  SubmitBar,
  VerdictHeader,
} from '@/components/ToolPrimitives';
import {
  api,
  formatCurrency,
  formatPct,
  type CrossBorderResponse,
  type LoanType,
} from '@/lib/api';
import { loadProfileClient } from '@/lib/user-store';
import { applyToolResult } from '@/lib/apply-tool-result';
import { addLoanToProfile } from '@/lib/add-loan-to-profile';

type Currency = 'INR' | 'USD' | 'GBP' | 'EUR' | 'AUD' | 'CAD' | 'SGD' | 'AED';

const CURRENCIES: { value: Currency; label: string }[] = [
  { value: 'INR', label: 'INR (₹)' },
  { value: 'USD', label: 'USD ($)' },
  { value: 'GBP', label: 'GBP (£)' },
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'AUD', label: 'AUD' },
  { value: 'CAD', label: 'CAD' },
  { value: 'SGD', label: 'SGD' },
  { value: 'AED', label: 'AED' },
];

const VERDICT_LABEL: Record<CrossBorderResponse['verdict'], string> = {
  prepay: 'Prepay the loan',
  invest: 'Keep amortising — invest instead',
  marginal: 'Within 1pp — your call',
};
const VERDICT_COLOR: Record<CrossBorderResponse['verdict'], string> = {
  prepay: 'var(--positive)',
  invest: 'var(--accent)',
  marginal: 'var(--muted)',
};

export function NriPrepayTool() {
  const profile = useMemo(() => loadProfileClient(), []);
  const [targetIdx, setTargetIdx] = useState<string>('');
  const [loanBalance, setLoanBalance] = useState('3500000');
  const [loanRate, setLoanRate] = useState('0.085');
  const [loanTenure, setLoanTenure] = useState('180');
  const [loanCurrency, setLoanCurrency] = useState<Currency>('INR');
  const [userCurrency, setUserCurrency] = useState<Currency>('USD');
  const [savingsYield, setSavingsYield] = useState('0.05');
  const [marginalTax, setMarginalTax] = useState('0.24');
  // User-facing FX field: "1 [userCurrency] = X [loanCurrency]" — e.g. for
  // USD-earner with INR loan, X ≈ 96. Engine wants the inverse direction
  // (user_currency per 1 loan_currency), so we convert before sending.
  const [fxInverse, setFxInverse] = useState('');
  const [manualDrift, setManualDrift] = useState('');
  const [v, setV] = useState<CrossBorderResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [added, setAdded] = useState(false);

  function pickTargetLoan(idx: string) {
    setTargetIdx(idx);
    const i = Number(idx);
    if (!Number.isNaN(i) && profile.user.loans[i]) {
      const loan = profile.user.loans[i];
      setLoanBalance(loan.outstanding);
      setLoanRate(loan.nominal_rate);
      if (loan.tenure_months_remaining > 0) {
        setLoanTenure(String(loan.tenure_months_remaining));
      }
    }
  }

  async function fetchLiveRate() {
    try {
      setErr(null);
      // API returns "user_currency per 1 loan_currency". We display the
      // inverse so the user sees "1 [user] = X [loan]".
      const r = await api.fxRate(loanCurrency, userCurrency);
      const enginePerUnit = new Decimal(r.rate);
      if (enginePerUnit.isZero()) {
        setErr('FX rate came back zero — please enter manually.');
        return;
      }
      // Invert: 1 user = ? loan
      setFxInverse(new Decimal(1).div(enginePerUnit).toFixed(4));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  // Engine direction: user_currency per 1 loan_currency. UI direction:
  // loan_currency per 1 user_currency. So engine_value = 1 / ui_value.
  const enginefxRate = useMemo(() => {
    if (!fxInverse) return '';
    const v = new Decimal(fxInverse);
    if (v.isZero()) return '';
    return new Decimal(1).div(v).toFixed(8);
  }, [fxInverse]);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setApplied(false);
    setAdded(false);
    try {
      setV(
        await api.crossBorder({
          loan_balance: loanBalance,
          loan_nominal_rate: loanRate,
          loan_tenure_months: Number(loanTenure),
          loan_currency: loanCurrency,
          user_currency: userCurrency,
          user_savings_yield: savingsYield,
          user_marginal_tax: marginalTax,
          ...(enginefxRate ? { manual_fx_rate: enginefxRate } : {}),
          ...(manualDrift ? { manual_fx_drift_annual: manualDrift } : {}),
        }),
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Show the response's fx_rate_used in the friendly direction. The
  // response field is user_currency per 1 loan_currency; invert for UI.
  const displayedFx = useMemo(() => {
    if (!v) return null;
    const r = new Decimal(v.fx_rate_used);
    if (r.isZero()) return null;
    return new Decimal(1).div(r).toFixed(2);
  }, [v]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card>
        <form
          onSubmit={check}
          style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}
        >
          {profile.user.loans.length > 0 && (
            <Select
              label="Which of your loans is this? (optional)"
              value={targetIdx}
              onChange={pickTargetLoan}
              options={[
                { value: '', label: '— not in my profile yet' },
                ...profile.user.loans.map((l, i) => ({
                  value: String(i),
                  label: `${l.bank} · ${l.loan_type.replace('_', ' ')}`,
                })),
              ]}
              info={
                <>
                  NRI households often run hybrid loan books. Pick an
                  existing loan to mirror its balance/rate/tenure; pick
                  &ldquo;not in my profile&rdquo; if this loan isn&apos;t
                  tracked yet (we&apos;ll offer one-click add at the end).
                </>
              }
            />
          )}
          <Field
            label="Loan balance (in loan currency)"
            value={loanBalance}
            onChange={setLoanBalance}
          />
          <Field
            label="Loan rate (decimal)"
            value={loanRate}
            onChange={setLoanRate}
            hint="e.g. 0.085 for 8.5%"
          />
          <Field
            label="Tenure remaining (months)"
            value={loanTenure}
            onChange={setLoanTenure}
            kind="integer"
          />
          <Select
            label="Loan currency"
            value={loanCurrency}
            onChange={setLoanCurrency}
            options={CURRENCIES}
          />
          <Select
            label="Your earnings / savings currency"
            value={userCurrency}
            onChange={setUserCurrency}
            options={CURRENCIES}
          />
          <Field
            label="Your savings yield (decimal, pre-tax)"
            value={savingsYield}
            onChange={setSavingsYield}
            hint="HYSA, T-bills, FD, equity etc."
          />
          <Field
            label="Your marginal tax rate on yield"
            value={marginalTax}
            onChange={setMarginalTax}
            hint="e.g. 0.24 for 24%"
          />
          <div>
            <Field
              label={`FX rate — 1 ${userCurrency} = ? ${loanCurrency}`}
              value={fxInverse}
              onChange={setFxInverse}
              hint={
                userCurrency === 'USD' && loanCurrency === 'INR'
                  ? 'e.g. 96 means 1 USD = 96 INR'
                  : `units of ${loanCurrency} you get per 1 ${userCurrency}`
              }
              info={
                <>
                  Direction matters. Type how many{' '}
                  <strong>{loanCurrency}</strong> you get for 1{' '}
                  <strong>{userCurrency}</strong>. We invert internally for
                  the engine, so you don&apos;t have to think about it.
                </>
              }
            />
            <button
              type="button"
              onClick={fetchLiveRate}
              style={{
                marginTop: 6,
                padding: '4px 10px',
                fontSize: 12,
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
                border: '1px solid var(--accent)',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Fetch live rate
            </button>
          </div>
          <Field
            label="FX drift % p.a. (optional)"
            value={manualDrift}
            onChange={setManualDrift}
            hint="Positive = loan currency strengthens. Blank = historical default."
            info={
              <>
                Long-run trend in the loan-currency vs your earnings
                currency. INR has historically drifted ~3%/yr weaker against
                USD; if you think that&apos;s changing, override.
              </>
            }
          />
          <SubmitBar busy={busy} error={err} label="Should I prepay?" />
        </form>
      </Card>

      {v && (
        <Card>
          <VerdictHeader
            label={VERDICT_LABEL[v.verdict]}
            color={VERDICT_COLOR[v.verdict]}
            detail={v.rationale}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <Stat
              label={`FX-adjusted loan cost (in ${userCurrency})`}
              value={formatPct(v.effective_loan_cost_in_user_currency, 2)}
              color="var(--negative)"
            />
            <Stat
              label="Post-tax yield on savings"
              value={formatPct(v.user_post_tax_yield, 2)}
              color="var(--positive)"
            />
            <Stat
              label={
                <>
                  Spread (prepay if positive){' '}
                  <InfoTip>
                    Loan&apos;s effective cost minus your post-tax yield.
                    Positive ⇒ debt is more expensive than the alternative ⇒
                    pay it down.
                  </InfoTip>
                </>
              }
              value={formatPct(v.spread, 2)}
              color={Number(v.spread) > 0 ? 'var(--positive)' : 'var(--negative)'}
            />
            <Stat
              label="FX drift used"
              value={formatPct(v.fx_drift_used, 2)}
            />
          </div>
          {displayedFx && (
            <div
              className="muted"
              style={{ fontSize: 12, marginBottom: 12, paddingBottom: 8 }}
            >
              FX rate used: <span className="num" style={{ color: 'var(--ink)' }}>
                1 {userCurrency} = {displayedFx} {loanCurrency}
              </span>
            </div>
          )}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 12,
            }}
          >
            <Stat
              label={`EMI today in ${userCurrency}`}
              value={formatCurrency(v.loan_emi_user_currency, userCurrency)}
            />
            <Stat
              label={`Projected EMI in 5y in ${userCurrency}`}
              value={formatCurrency(v.loan_emi_user_currency_y5, userCurrency)}
              color={
                Number(v.loan_emi_user_currency_y5) > Number(v.loan_emi_user_currency)
                  ? 'var(--negative)'
                  : 'var(--positive)'
              }
            />
          </div>
          {v.verdict === 'prepay' && (
            targetIdx !== '' &&
            profile.isLive &&
            profile.user.loans[Number(targetIdx)] ? (
              <ApplyAction
                applied={applied}
                onApply={() => {
                  const target = profile.user.loans[Number(targetIdx)];
                  const sched = target.scheduled_emi || '0';
                  const balanceD = new Decimal(loanBalance);
                  const outstandingD = new Decimal(target.outstanding);
                  const fullyClears = balanceD.gte(outstandingD);
                  applyToolResult({
                    loanIndex: Number(targetIdx),
                    kind: fullyClears ? 'closed' : 'paid_extra',
                    amount: fullyClears
                      ? outstandingD.toFixed(2)
                      : String(Number(sched) + Number(loanBalance)),
                    scheduledEmi: sched,
                    note: `NRI prepay — ${formatCurrency(loanBalance, loanCurrency)} to ${target.bank}`,
                    loans: profile.user.loans,
                    country: profile.user.country,
                  });
                  setApplied(true);
                }}
                label={`Apply this — log payoff to ${profile.user.loans[Number(targetIdx)].bank} & reprice /plan`}
              />
            ) : (
              <AddLoanAction
                added={added}
                onAdd={() => {
                  // Add as personal_loan by default — user can tweak the
                  // type in Setup. Bank label is intentionally generic
                  // ("Foreign loan") because cross-border loans often
                  // aren't with a bank from our IN/US lists.
                  const r = Number(loanRate) / 12;
                  const n = Number(loanTenure);
                  const p = Number(loanBalance);
                  const emi = r === 0 ? p / n : (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
                  addLoanToProfile({
                    loan_type: 'personal_loan' as LoanType,
                    bank: `Foreign loan (${loanCurrency})`,
                    outstanding: loanBalance,
                    nominal_rate: loanRate,
                    tenure_months_remaining: Number(loanTenure),
                    scheduled_emi: emi.toFixed(2),
                  });
                  setAdded(true);
                }}
                label="Add this foreign loan to my profile to track it"
              />
            )
          )}
        </Card>
      )}
    </div>
  );
}
