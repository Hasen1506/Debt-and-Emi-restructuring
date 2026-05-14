'use client';

import { useState } from 'react';
import { Card } from '@/components/Card';
import {
  Field,
  Stat,
  SubmitBar,
  VerdictHeader,
} from '@/components/ToolPrimitives';
import { api, formatINR, formatPct, type NewDebtResponse } from '@/lib/api';

const VERDICT_LABEL: Record<NewDebtResponse['verdict'], string> = {
  take: 'Take the EMI',
  pay_cash: 'Pay cash',
  delay: 'Delay',
};
const VERDICT_COLOR: Record<NewDebtResponse['verdict'], string> = {
  take: 'var(--positive)',
  pay_cash: 'var(--accent)',
  delay: 'var(--negative)',
};

export default function NewDebtPage() {
  const [listPrice, setListPrice] = useState('20000');
  const [cashPrice, setCashPrice] = useState('17000');
  const [months, setMonths] = useState('6');
  const [emi, setEmi] = useState('3333.33');
  const [fee, setFee] = useState('0');
  const [savings, setSavings] = useState('50000');
  const [v, setV] = useState<NewDebtResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      setV(
        await api.newDebt({
          list_price: listPrice,
          cash_price_elsewhere: cashPrice,
          emi_offer_months: Number(months),
          emi_offer_monthly_payment: emi,
          processing_fee: fee,
          user_savings_after_efund: savings,
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
        <h1 className="h1">Should I take this EMI?</h1>
        <p className="muted">
          Enter the offer, see the real APR after foregone discounts and
          processing fee. §8b · §4.9.
        </p>
      </section>

      <Card>
        <form
          onSubmit={check}
          style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}
        >
          <Field label="List price" value={listPrice} onChange={setListPrice} />
          <Field
            label="Cash price (elsewhere)"
            value={cashPrice}
            onChange={setCashPrice}
            hint="What you'd pay if you walked in with cash"
          />
          <Field label="Months" value={months} onChange={setMonths} />
          <Field label="Monthly EMI" value={emi} onChange={setEmi} />
          <Field label="Processing fee" value={fee} onChange={setFee} />
          <Field
            label="Your savings after e-fund"
            value={savings}
            onChange={setSavings}
          />
          <SubmitBar busy={busy} error={err} label="Check" />
        </form>
      </Card>

      {v && (
        <Card>
          <VerdictHeader
            label={VERDICT_LABEL[v.verdict]}
            color={VERDICT_COLOR[v.verdict]}
            detail={v.detail}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
            }}
          >
            <Stat label="Effective APR" value={formatPct(v.effective_apr, 1)} />
            <Stat
              label="Foregone discount"
              value={formatINR(v.foregone_discount)}
            />
            <Stat label="Total real cost" value={formatINR(v.total_real_cost)} />
          </div>
        </Card>
      )}
    </div>
  );
}
