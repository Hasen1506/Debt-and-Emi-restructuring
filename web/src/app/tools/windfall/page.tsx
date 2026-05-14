'use client';

import { useState } from 'react';
import { Card } from '@/components/Card';
import { Field, Stat, SubmitBar, VerdictHeader } from '@/components/ToolPrimitives';
import { api, formatINR, type WindfallResponse } from '@/lib/api';
import { DEMO_USER, DEMO_MARGINAL_RATE } from '@/lib/demo-user';

export default function WindfallPage() {
  const [amount, setAmount] = useState('100000');
  const [v, setV] = useState<WindfallResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      setV(
        await api.windfall({
          amount,
          user: DEMO_USER,
          marginal_rate: DEMO_MARGINAL_RATE,
          strategy: 'avalanche',
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
        <h1 className="h1">Got a bonus — where should it go?</h1>
        <p className="muted">
          Runs Layer 1 → 2 → 3 on your current debts and tells you the single
          best home for the cash. §8a.
        </p>
      </section>

      <Card>
        <form
          onSubmit={check}
          style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}
        >
          <Field
            label="Windfall amount"
            value={amount}
            onChange={setAmount}
            hint="Bonus, tax refund, gift, asset sale, etc."
          />
          <div />
          <SubmitBar busy={busy} error={err} label="Where should it go?" />
        </form>
      </Card>

      {v && (
        <Card>
          <VerdictHeader
            label={
              v.invest_instead
                ? `Invest in ${v.investment_name ?? '—'}`
                : `Pay down ${v.loan_label}`
            }
            color={v.invest_instead ? 'var(--accent)' : 'var(--positive)'}
            detail={v.rationale}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 12,
            }}
          >
            <Stat label="Amount" value={formatINR(v.amount)} />
            <Stat
              label={
                v.invest_instead ? 'Interest given up (vs prepay)' : 'Interest avoided'
              }
              value={formatINR(v.interest_avoided)}
              color={v.invest_instead ? 'var(--negative)' : 'var(--positive)'}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
