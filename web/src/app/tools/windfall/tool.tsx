'use client';

import { useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { Card } from '@/components/Card';
import { ApplyAction, Field, InfoTip, ScoreChip, Stat, SubmitBar, VerdictHeader } from '@/components/ToolPrimitives';
import {
  api,
  formatCurrency,
  type ScoreImpactResponse,
  type WindfallResponse,
} from '@/lib/api';
import { loadProfileClient } from '@/lib/user-store';
import { deriveMetrics } from '@/lib/derived';
import { applyToolResult } from '@/lib/apply-tool-result';
import { loanCurrency, userDefaultCurrency } from '@/lib/currency';

export function WindfallTool() {
  const profile = useMemo(() => loadProfileClient(), []);
  const country = profile.user.country;
  const loudest = useMemo(() => deriveMetrics(profile).loudest, [profile]);
  // Windfall payouts route against the loudest loan, so format figures in
  // that loan's currency. If there is no loudest (no loans), fall back to
  // the user's residence currency.
  const ccy = loudest ? loanCurrency(loudest.loan, country) : userDefaultCurrency(country);
  const fmt = (v: string | number) => formatCurrency(v, ccy);
  const [amount, setAmount] = useState('');
  const [score, setScore] = useState(
    profile.creditScore != null ? String(profile.creditScore) : '',
  );
  const [v, setV] = useState<WindfallResponse | null>(null);
  const [impact, setImpact] = useState<ScoreImpactResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (!amount.trim() || Number(amount) <= 0) {
      setErr('Enter the windfall amount.');
      return;
    }
    setBusy(true);
    setErr(null);
    setImpact(null);
    setApplied(false);
    try {
      const result = await api.windfall({
        amount,
        user: profile.user,
        marginal_rate: profile.marginalRate,
        strategy: 'avalanche',
      });
      setV(result);

      if (!result.invest_instead && result.loan_label.toLowerCase().includes('credit_card')) {
        const card = profile.user.loans.find((l) => l.loan_type === 'credit_card');
        if (card) {
          const limit = new Decimal(card.outstanding).div('0.7');
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
      {!profile.isLive && (
        <div className="chip" style={{ alignSelf: 'flex-start', color: 'var(--muted)' }}>
          demo profile · <a href="/onboarding">set up yours</a>
        </div>
      )}

      <Card>
        {loudest && (
          <div
            className="muted"
            style={{
              fontSize: 12,
              lineHeight: 1.55,
              marginBottom: 10,
              padding: '8px 10px',
              border: '1px dashed var(--border)',
              borderRadius: 6,
            }}
          >
            Based on your profile, the windfall will be routed against your{' '}
            <strong style={{ color: 'var(--ink)' }}>
              {loudest.loan.bank || 'highest-rate'} {loudest.loan.loan_type.replace('_', ' ')}
            </strong>{' '}
            unless investing beats it.
          </div>
        )}
        <form
          onSubmit={check}
          style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}
        >
          <Field
            label="Windfall amount (net of tax)"
            value={amount}
            onChange={setAmount}
            hint="The figure that actually hit your account — bonus, refund, gift, sale"
            info={
              <>
                Any lump sum that&apos;s not part of your monthly cash flow.
                Enter the <strong>net amount</strong> — i.e. what landed in
                your bank after the payer&apos;s TDS / withholding.
                <div style={{ marginTop: 8 }}>
                  <strong>Why net?</strong> A {profile.user.country === 'IN' ? '₹5L' : '$5k'} bonus
                  with 30% TDS lands as {profile.user.country === 'IN' ? '~₹3.4L' : '~$3.5k'} —
                  that smaller figure is what you can actually deploy. We
                  compare it against your loudest loan and the best liquid
                  parking option, after-tax on both sides.
                </div>
                {profile.user.income_type === 'business_owner' && (
                  <div style={{ marginTop: 8 }}>
                    <strong>Business income?</strong> No TDS was withheld
                    on this — you owe the tax yourself at the next advance-tax
                    installment. Set aside roughly{' '}
                    {Math.round(Number(profile.marginalRate) * 100)}% of any
                    amount you enter here before deploying it.
                  </div>
                )}
              </>
            }
          />
          <Field
            label="Your current credit score"
            value={score}
            onChange={setScore}
            hint="CIBIL/Experian; leave blank to skip score impact"
            info={
              <>
                Used only if the windfall lands on a credit card —
                we&apos;ll model the utilisation drop and project the score
                bump. Leave blank if you&apos;d rather skip that.
              </>
            }
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
          {profile.user.income_type === 'business_owner' &&
            Number(amount) > 0 && (
              <div
                style={{
                  padding: '8px 12px',
                  marginBottom: 12,
                  background: 'var(--soft-bg)',
                  border: '1px solid var(--border)',
                  borderLeft: '3px solid var(--accent)',
                  borderRadius: 6,
                  fontSize: 12,
                  lineHeight: 1.55,
                }}
              >
                <strong>Tax set-aside reminder.</strong> If this is business
                income (no TDS withheld), park{' '}
                <strong>
                  {fmt(
                    Math.round(
                      Number(amount) * Number(profile.marginalRate || '0'),
                    ),
                  )}
                </strong>{' '}
                in your <a href="/debts" style={{ color: 'var(--accent)' }}>tax sleeve</a>{' '}
                before deploying the rest. The advance-tax installment will
                catch up either way.
              </div>
            )}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 12,
              marginBottom: impact ? 12 : 0,
            }}
          >
            <Stat label="Amount" value={fmt(v.amount)} />
            <Stat
              label={
                <>
                  {v.invest_instead ? 'Interest given up (vs prepay)' : 'Interest avoided'}{' '}
                  <InfoTip>
                    {v.invest_instead
                      ? 'Investing instead of prepaying means your loan keeps accruing. This is the extra interest you\'ll pay over the loan\'s remaining life — the opportunity cost of investing.'
                      : 'Interest you won\'t pay because the loan balance is smaller now. Calculated against the loan\'s remaining tenure at its current rate.'}
                  </InfoTip>
                </>
              }
              value={fmt(v.interest_avoided)}
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
          {!v.invest_instead && loudest && profile.isLive && (
            <ApplyAction
              applied={applied}
              onApply={() => {
                applyToolResult({
                  loanIndex: loudest.index,
                  kind: 'paid_extra',
                  amount: String(
                    Number(loudest.loan.scheduled_emi || 0) + Number(v.amount),
                  ),
                  scheduledEmi: loudest.loan.scheduled_emi || '0',
                  note: `Windfall applied — ${fmt(v.amount)} to ${v.loan_label}`,
                  loans: profile.user.loans,
                  country: profile.user.country,
                });
                setApplied(true);
              }}
              label={`Apply this — log ${fmt(v.amount)} to ${loudest.loan.bank} & reprice /plan`}
            />
          )}
        </Card>
      )}
    </div>
  );
}
