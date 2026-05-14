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
  type BorrowTimingResponse,
} from '@/lib/api';

type Urgency = 'now' | '3m_ok' | '6m_ok';

export default function RightTimePage() {
  const [currentRate, setCurrentRate] = useState('0.085');
  const [avgRate, setAvgRate] = useState('0.090');
  const [changeBps, setChangeBps] = useState('-50');
  const [monthsTo, setMonthsTo] = useState('3');
  const [urgency, setUrgency] = useState<Urgency>('3m_ok');
  const [principal, setPrincipal] = useState('5000000');
  const [tenure, setTenure] = useState('240');
  const [v, setV] = useState<BorrowTimingResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      setV(
        await api.rightTime({
          current_rate: currentRate,
          six_month_avg: avgRate,
          consensus_change_bps: Number(changeBps),
          months_to_decision: Number(monthsTo),
          urgency,
          principal,
          tenure_months: Number(tenure),
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
        <h1 className="h1">Wait for a cut, or lock the rate now?</h1>
        <p className="muted">
          Weighs the central-bank consensus against your urgency and tenure
          to suggest whether to defer the borrow. §8f.
        </p>
      </section>

      <Card>
        <form
          onSubmit={check}
          style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}
        >
          <Field
            label="Current quoted rate (decimal)"
            value={currentRate}
            onChange={setCurrentRate}
          />
          <Field
            label="6-month average rate (decimal)"
            value={avgRate}
            onChange={setAvgRate}
          />
          <Field
            label="Consensus change (bps)"
            value={changeBps}
            onChange={setChangeBps}
            hint="negative = expected cut, positive = expected hike"
          />
          <Field
            label="Months to next central-bank decision"
            value={monthsTo}
            onChange={setMonthsTo}
          />
          <Select
            label="How urgent is the borrow?"
            value={urgency}
            onChange={setUrgency}
            options={[
              { value: 'now' as Urgency, label: 'I need it now' },
              { value: '3m_ok' as Urgency, label: 'I can wait 3 months' },
              { value: '6m_ok' as Urgency, label: 'I can wait 6 months' },
            ]}
          />
          <Field label="Principal" value={principal} onChange={setPrincipal} />
          <Field
            label="Tenure (months)"
            value={tenure}
            onChange={setTenure}
          />
          <SubmitBar busy={busy} error={err} label="What should I do?" />
        </form>
      </Card>

      {v && (
        <Card>
          <VerdictHeader
            label={v.verdict === 'wait' ? 'Wait' : 'Borrow now'}
            color={v.verdict === 'wait' ? 'var(--accent)' : 'var(--positive)'}
            detail={v.detail}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
            }}
          >
            <Stat label="Current rate" value={formatPct(v.current_rate, 2)} />
            <Stat label="6-mo avg" value={formatPct(v.six_month_avg, 2)} />
            <Stat
              label="Est. savings if you wait"
              value={formatINR(v.estimated_savings)}
              color={v.verdict === 'wait' ? 'var(--positive)' : 'var(--muted)'}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
