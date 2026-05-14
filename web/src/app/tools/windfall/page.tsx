'use client';

import { useState } from 'react';
import Decimal from 'decimal.js';
import { Card } from '@/components/Card';
import { Field, ScoreChip, Stat, SubmitBar, VerdictHeader } from '@/components/ToolPrimitives';
import {
  api,
  formatINR,
  type ScoreImpactResponse,
  type WindfallResponse,
} from '@/lib/api';
import { DEMO_USER, DEMO_MARGINAL_RATE } from '@/lib/demo-user';

export default function WindfallPage() {
  const [amount, setAmount] = useState('100000');
  const [score, setScore] = useState('720');
  const [v, setV] = useState<WindfallResponse | null>(null);
  const [impact, setImpact] = useState<ScoreImpactResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setImpact(null);
    try {
      const result = await api.windfall({
        amount,
        user: DEMO_USER,
        marginal_rate: DEMO_MARGINAL_RATE,
        strategy: 'avalanche',
      });
      setV(result);

      // If the windfall lands on the card, model the utilisation drop.
      if (!result.invest_instead && result.loan_label.toLowerCase().includes('credit_card')) {
        const card = DEMO_USER.loans.find((l) => l.loan_type === 'credit_card');
        if (card) {
          const limit = new Decimal(card.outstanding).div('0.7'); // assume 70% utilised
          const utilFrom = new Decimal(card.outstanding).div(limit);
          const utilTo = Decimal.max(
            new Decimal(card.outstanding).minus(amount),
            new Decimal('0'),
          ).div(limit);
          const scoreInt = Number(score) || 720;
          const impactResult = await api.scoreImpact({
            action: 'utilisation_drop',
            current_score: scoreInt,
            country: 'IN',
            utilisation_from: utilFrom.toFixed(4),
            utilisation_to: utilTo.toFixed(4),
          });
          setImpact(impactResult);
        }
      }
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
          <Field
            label="Your current credit score"
            value={score}
            onChange={setScore}
            hint="CIBIL/Experian; leave blank to skip score impact"
          />
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
              marginBottom: impact ? 12 : 0,
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
          {impact && (
            <ScoreChip
              deltaLow={impact.delta_low}
              deltaHigh={impact.delta_high}
              daysToRealise={impact.days_to_realise}
              currentBand={impact.current_band}
              projectedBandHigh={impact.projected_band_high}
              source={impact.source}
              rationale={impact.rationale}
            />
          )}
        </Card>
      )}
    </div>
  );
}
