'use client';

import Decimal from 'decimal.js';
import { useMemo, useState } from 'react';
import { Card } from '@/components/Card';
import {
  Field,
  ScoreChip,
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
  type ScoreImpactResponse,
} from '@/lib/api';
import { loadProfileClient } from '@/lib/user-store';

export default function RecomputePage() {
  const profile = useMemo(() => loadProfileClient(), []);
  const [extra, setExtra] = useState('50000');
  const [targetIdx, setTargetIdx] = useState<string>('0');
  const [v, setV] = useState<QuickRecomputeResponse | null>(null);
  const [impact, setImpact] = useState<ScoreImpactResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setImpact(null);
    try {
      const result = await api.quickRecompute({
        user: profile.user,
        extra_payment: extra,
        target_loan_index: Number(targetIdx),
        strategy: 'avalanche',
        horizon_months: 360,
        marginal_rate: profile.marginalRate,
      });
      setV(result);

      // Surface score impact when this lump clears a card/loan in full.
      const targetLoan = profile.user.loans[Number(targetIdx)];
      if (targetLoan && profile.creditScore != null) {
        const extraD = new Decimal(extra);
        const outstandingD = new Decimal(targetLoan.outstanding);
        const fullyClears = extraD.gte(outstandingD);
        if (fullyClears) {
          const action =
            targetLoan.loan_type === 'credit_card' ? 'card_paid_off' : 'loan_paid_off';
          const onlyInstalment =
            action === 'loan_paid_off' &&
            profile.user.loans.filter(
              (l) => l.loan_type !== 'credit_card',
            ).length === 1;
          setImpact(
            await api.scoreImpact({
              action,
              current_score: profile.creditScore,
              country: profile.user.country,
              is_only_instalment_loan: onlyInstalment,
            }),
          );
        } else if (targetLoan.loan_type === 'credit_card') {
          // Partial card paydown — model the utilisation drop.
          const limit = outstandingD.div('0.7'); // assume 70% utilised
          const utilTo = Decimal.max(
            outstandingD.minus(extraD),
            new Decimal('0'),
          ).div(limit);
          setImpact(
            await api.scoreImpact({
              action: 'utilisation_drop',
              current_score: profile.creditScore,
              country: profile.user.country,
              utilisation_from: outstandingD.div(limit).toFixed(4),
              utilisation_to: utilTo.toFixed(4),
            }),
          );
        }
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const loanOptions = profile.user.loans.map((l, i) => ({
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
          {!profile.isLive && (
            <span className="chip" style={{ marginLeft: 8, color: 'var(--muted)' }}>
              demo profile · <a href="/onboarding">set up yours</a>
            </span>
          )}
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
          {impact && (
            <div style={{ marginTop: 12 }}>
              <ScoreChip
                deltaLow={impact.delta_low}
                deltaHigh={impact.delta_high}
                daysToRealise={impact.days_to_realise}
                currentBand={impact.current_band}
                projectedBandHigh={impact.projected_band_high}
                source={impact.source}
                rationale={impact.rationale}
              />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
