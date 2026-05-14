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
  formatINR,
  formatPct,
  type CashYieldResponse,
  type Country,
} from '@/lib/api';

export default function CashYieldPage() {
  const [idle, setIdle] = useState('500000');
  const [yieldNow, setYieldNow] = useState('0.025');
  const [country, setCountry] = useState<Country>('IN');
  const [topRate, setTopRate] = useState('0.42');
  const [v, setV] = useState<CashYieldResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      setV(
        await api.cashYield({
          idle_balance: idle,
          current_yield: yieldNow,
          country,
          top_loan_effective_rate: topRate || undefined,
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
        <h1 className="h1">Is your cash earning its keep?</h1>
        <p className="muted">
          Compares your savings yield against the country's best liquid
          alternative and against prepaying your top loan. §8e.
        </p>
      </section>

      <Card>
        <form
          onSubmit={check}
          style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}
        >
          <Field label="Idle balance" value={idle} onChange={setIdle} />
          <Field
            label="Current yield (decimal)"
            value={yieldNow}
            onChange={setYieldNow}
            hint="e.g. 0.025 for 2.5%"
          />
          <Select
            label="Country"
            value={country}
            onChange={setCountry}
            options={[
              { value: 'IN' as Country, label: 'India' },
              { value: 'US' as Country, label: 'USA' },
            ]}
          />
          <Field
            label="Top loan effective rate (decimal, optional)"
            value={topRate}
            onChange={setTopRate}
            hint="Comparison against prepaying"
          />
          <SubmitBar busy={busy} error={err} label="Check yield" />
        </form>
      </Card>

      {v && !v.alert && (
        <Card>
          <VerdictHeader
            label="No action needed"
            color="var(--muted)"
            detail="Either the idle balance is small enough that moving it isn't worth the friction, or the yield gap is under 1pp."
          />
        </Card>
      )}

      {v && v.alert && (
        <Card>
          <VerdictHeader
            label={v.beats_top_loan ? `Move to ${v.alt_name}` : 'Prepay top loan first'}
            color={v.beats_top_loan ? 'var(--accent)' : 'var(--positive)'}
            detail={v.rationale ?? ''}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
            }}
          >
            <Stat
              label="Current yield"
              value={v.current_yield ? formatPct(v.current_yield, 2) : '—'}
            />
            <Stat
              label="Better yield"
              value={v.best_alt_yield ? formatPct(v.best_alt_yield, 2) : '—'}
              color="var(--accent)"
            />
            <Stat
              label="Annual uplift"
              value={v.annual_uplift ? formatINR(v.annual_uplift) : '—'}
              color="var(--positive)"
            />
          </div>
        </Card>
      )}
    </div>
  );
}
