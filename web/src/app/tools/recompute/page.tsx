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
  monthIndexToLabel,
  type QuickRecomputeResponse,
} from '@/lib/api';
import { DEMO_USER, DEMO_MARGINAL_RATE } from '@/lib/demo-user';

export default function RecomputePage() {
  const [extra, setExtra] = useState('50000');
  const [targetIdx, setTargetIdx] = useState<string>('1');
  const [v, setV] = useState<QuickRecomputeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      setV(
        await api.quickRecompute({
          user: DEMO_USER,
          extra_payment: extra,
          target_loan_index: Number(targetIdx),
          strategy: 'avalanche',
          horizon_months: 360,
          marginal_rate: DEMO_MARGINAL_RATE,
        }),
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const loanOptions = DEMO_USER.loans.map((l, i) => ({
    value: String(i),
    label: `${l.bank} · ${l.loan_type.replace('_', ' ')} (${formatINR(l.outstanding)})`,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <h1 className="h1">I just paid extra — where does that leave me?</h1>
        <p className="muted">
          Reruns the full schedule with the lump-sum applied and tells you how
          much closer to debt-free you are now. §8d.
        </p>
      </section>

      <Card>
        <form
          onSubmit={check}
          style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}
        >
          <Field
            label="Extra payment"
            value={extra}
            onChange={setExtra}
            hint="Lump sum you just paid"
          />
          <Select
            label="Applied to which loan?"
            value={targetIdx}
            onChange={setTargetIdx}
            options={loanOptions}
          />
          <SubmitBar busy={busy} error={err} label="Recompute" />
        </form>
      </Card>

      {v && (
        <Card>
          <VerdictHeader
            label={
              v.months_pulled_forward > 0
                ? `${v.months_pulled_forward} months closer to debt-free`
                : 'No change to debt-free date'
            }
            color={v.months_pulled_forward > 0 ? 'var(--positive)' : 'var(--muted)'}
            detail={
              v.months_pulled_forward > 0
                ? `Old date ${monthIndexToLabel(v.old_debt_free_month)} → new date ${monthIndexToLabel(v.new_debt_free_month)}.`
                : 'The extra payment helped but did not advance the final clear date inside the horizon.'
            }
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
            }}
          >
            <Stat
              label="Old debt-free date"
              value={monthIndexToLabel(v.old_debt_free_month)}
            />
            <Stat
              label="New debt-free date"
              value={monthIndexToLabel(v.new_debt_free_month)}
              color="var(--accent)"
            />
            <Stat
              label="Interest saved"
              value={formatINR(v.interest_saved)}
              color="var(--positive)"
            />
          </div>
        </Card>
      )}
    </div>
  );
}
