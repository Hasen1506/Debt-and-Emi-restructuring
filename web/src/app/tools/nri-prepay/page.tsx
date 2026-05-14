'use client';

import { useState } from 'react';
import { Card } from '@/components/Card';
import {
  Field,
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
} from '@/lib/api';

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

export default function NriPrepayPage() {
  const [loanBalance, setLoanBalance] = useState('3500000');
  const [loanRate, setLoanRate] = useState('0.085');
  const [loanTenure, setLoanTenure] = useState('180');
  const [loanCurrency, setLoanCurrency] = useState<Currency>('INR');
  const [userCurrency, setUserCurrency] = useState<Currency>('USD');
  const [savingsYield, setSavingsYield] = useState('0.05');
  const [marginalTax, setMarginalTax] = useState('0.24');
  const [manualFx, setManualFx] = useState('');
  const [manualDrift, setManualDrift] = useState('');
  const [v, setV] = useState<CrossBorderResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function fetchLiveRate() {
    try {
      setErr(null);
      const r = await api.fxRate(loanCurrency, userCurrency);
      setManualFx(r.rate);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
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
          ...(manualFx ? { manual_fx_rate: manualFx } : {}),
          ...(manualDrift ? { manual_fx_drift_annual: manualDrift } : {}),
        }),
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <h1 className="h1">Loan back home — should I prepay from foreign savings?</h1>
        <p className="muted">
          You earn in one currency, your loan accrues in another. We weigh the
          FX-adjusted loan cost against your post-tax yield. Historical drift
          used by default; override anything you want.
        </p>
      </section>

      <Card>
        <form
          onSubmit={check}
          style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}
        >
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
              label="Manual FX rate (optional)"
              value={manualFx}
              onChange={setManualFx}
              hint={`${userCurrency} per 1 ${loanCurrency} — leave blank to fetch live`}
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
            label="Manual FX drift % p.a. (optional)"
            value={manualDrift}
            onChange={setManualDrift}
            hint="Positive = loan currency strengthens. Blank = historical default."
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
              label="Spread (prepay if positive)"
              value={formatPct(v.spread, 2)}
              color={Number(v.spread) > 0 ? 'var(--positive)' : 'var(--negative)'}
            />
            <Stat
              label="FX drift used"
              value={formatPct(v.fx_drift_used, 2)}
            />
          </div>
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
        </Card>
      )}
    </div>
  );
}
