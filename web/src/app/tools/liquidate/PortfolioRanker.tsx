'use client';

import Decimal from 'decimal.js';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { LBracket, LKpi, L_T } from '@/components/ledger/primitives';
import { LNote, LStepSub } from '@/components/ledger/LToolSteps';
import { loanLabel, loanName } from '@/lib/loan-types';
import {
  api,
  formatCurrency,
  formatPct,
  type LiquidationRankingsResponse,
  type LiquidationRecommendation,
  type LiquidationVerdict,
  type UserPayload,
} from '@/lib/api';
import { userMarginalCosts } from '@/lib/marginal-cost';
import { applyToolResult } from '@/lib/apply-tool-result';

interface Props {
  user: UserPayload;
  marginalRate: string;
  isLive: boolean;
  /** Called when the user clicks "drill in" — pre-fills the sandbox form. */
  onDrillIn?: (rec: LiquidationRecommendation) => void;
}

const VERDICT_COLOR: Record<LiquidationVerdict, string> = {
  clear_win:   L_T.positive,
  conditional: L_T.accent,
  marginal:    L_T.muted,
  dont_sell:   L_T.negative,
};

const VERDICT_LABEL: Record<LiquidationVerdict, string> = {
  clear_win:   'Sell',
  conditional: 'Sell, if the notes hold',
  marginal:    'Small gain',
  dont_sell:   "Don't sell",
};

/** The ranker's frame: a 1px box like a tool step, without a number. */
function Box({ children }: { children: ReactNode }) {
  return (
    <section aria-label="Your assets, ranked" style={{ border: `1px solid ${L_T.ink}`, padding: 'clamp(14px, 2.5vw, 22px)', minWidth: 0 }}>
      <LStepSub right="AFTER TAX AND COSTS">Your assets, ranked</LStepSub>
      <div style={{ marginTop: 10 }}>{children}</div>
    </section>
  );
}

export function PortfolioRanker({ user, marginalRate, isLive, onDrillIn }: Props) {
  const [data, setData] = useState<LiquidationRankingsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  // Per-loan effective rate dict, indexed by loan position.
  const effectiveRates = useMemo(() => {
    // What each loan costs a year (compounded, GST, after the tax break):
    // the rate the plan weighs an early payment by (lib/marginal-cost).
    const out: Record<number, string> = {};
    const costs = userMarginalCosts(user, marginalRate);
    user.loans.forEach((l, i) => {
      const cost = costs.get(i);
      if (cost) out[i] = cost.annualCost.toFixed(4);
    });
    return out;
  }, [user, marginalRate]);

  // Auto-fetch on mount + whenever the input shape changes.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setBusy(true);
      setErr(null);
      try {
        const res = await api.liquidationRankings({
          user,
          debt_effective_rates: effectiveRates,
          marginal_rate: marginalRate,
        });
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    if (user.assets && user.assets.length > 0 && user.loans.length > 0) {
      run();
    }
    return () => {
      cancelled = true;
    };
  }, [user, effectiveRates, marginalRate]);

  if (!user.assets || user.assets.length === 0) return null;
  if (user.loans.length === 0) {
    return (
      <Box>
        <LNote style={{ margin: 0 }}>
          Ranking needs a loan to clear. <a href="/profile?step=loans" style={{ color: L_T.accent }}>Add one in your profile</a>.
        </LNote>
      </Box>
    );
  }

  if (busy) {
    return (
      <Box>
        <LNote style={{ margin: 0 }}>
          Ranking {user.assets.length} asset{user.assets.length === 1 ? '' : 's'} against {user.loans.length} loan{user.loans.length === 1 ? '' : 's'}…
        </LNote>
      </Box>
    );
  }

  if (err) {
    return (
      <Box>
        <LNote style={{ margin: 0, color: L_T.negative }}>Couldn&apos;t rank them: {err}</LNote>
      </Box>
    );
  }

  if (!data) return null;

  const hasRecs = data.recommendations.length > 0;
  const hasSkipped = data.considered_but_skipped.length > 0;

  return (
    <Box>
      {!hasRecs && <LNote style={{ margin: 0 }}>No sale is worth making against your loans right now.</LNote>}

      {hasRecs && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.recommendations.map((rec, idx) => (
            <RecCard
              key={`${rec.asset_index}-${rec.target_loan_index}-${idx}`}
              rec={rec}
              country={user.country}
              isLive={isLive}
              loans={user.loans}
              onDrillIn={onDrillIn}
            />
          ))}
        </div>
      )}

      {hasSkipped && (
        <div style={{ marginTop: 12 }}>
          <LBracket onClick={() => setShowSkipped((s) => !s)}>
            {showSkipped ? '− HIDE' : '+ SHOW'} {data.considered_but_skipped.length} OTHER{data.considered_but_skipped.length === 1 ? '' : 'S'} WE LOOKED AT
          </LBracket>
          {showSkipped && (
            <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.considered_but_skipped.map((rec, idx) => (
                <SkippedRow
                  key={`${rec.asset_index}-${rec.target_loan_index}-${idx}`}
                  rec={rec}
                  country={user.country}
                  loan={user.loans[rec.target_loan_index]}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </Box>
  );
}

function RecCard({
  rec, country, isLive, loans, onDrillIn,
}: {
  rec: LiquidationRecommendation;
  country: 'IN' | 'US';
  isLive: boolean;
  loans: UserPayload['loans'];
  onDrillIn?: (rec: LiquidationRecommendation) => void;
}) {
  const [applied, setApplied] = useState(false);
  const color = VERDICT_COLOR[rec.verdict];
  const label = VERDICT_LABEL[rec.verdict];
  const cur = country === 'IN' ? 'INR' : 'USD';
  const target = loans[rec.target_loan_index];

  function plan() {
    // Logs the recommendation against the chosen debt as a partial/full payoff.
    const sched = target?.scheduled_emi || '0';
    const proceeds = new Decimal(rec.proceeds.net_proceeds);
    const outstandingD = new Decimal(target?.outstanding || '0');
    const fullyClears = proceeds.gte(outstandingD);
    applyToolResult({
      loanIndex: rec.target_loan_index,
      kind: fullyClears ? 'closed' : 'paid_extra',
      amount: fullyClears
        ? proceeds.toFixed(2)
        : String(Number(sched) + Number(rec.proceeds.net_proceeds)),
      scheduledEmi: sched,
      note: `Asset sold (${rec.asset_label}): ${formatCurrency(rec.proceeds.net_proceeds, cur)} paid to the ${target ? loanName(target) : 'loan'}`,
      loans,
      country,
    });
    setApplied(true);
  }

  return (
    <div style={{ border: `1px solid ${L_T.ruleSoft}`, borderLeft: `3px solid ${color}`, padding: 'clamp(10px, 2vw, 14px)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700 }}>
          {rec.asset_label} → {target ? loanLabel(target) : rec.target_loan_label}
        </div>
        <div style={{ color, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</div>
      </div>

      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>{rec.proceeds.explanation}</p>

      <LKpi
        items={[
          { l: 'YOU GET', v: formatCurrency(rec.proceeds.net_proceeds, cur), s: 'after tax and costs' },
          { l: 'CLEARS', v: formatCurrency(rec.debt_cleared_amount, cur) },
          { l: 'INTEREST SAVED', v: formatCurrency(rec.interest_saved_yr1_nominal, cur), s: 'in the first year' },
          {
            l: 'GAIN A YEAR',
            v: formatCurrency(rec.net_annual_benefit_nominal, cur),
            tone: Number(rec.net_annual_benefit_nominal) > 0 ? L_T.positive : L_T.negative,
          },
        ]}
      />

      {rec.proceeds.caveats.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6, color: L_T.muted }}>
          {rec.proceeds.caveats.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      )}

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {isLive && !applied && (
          <button
            type="button"
            onClick={plan}
            style={{ background: L_T.ink, color: L_T.bg, border: 'none', padding: '9px 14px', font: 'inherit', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer' }}
          >
            [ I sold it · log it on the {target ? loanName(target) : 'loan'} ]
          </button>
        )}
        {applied && (
          <span role="status" style={{ fontSize: 12, color: L_T.positive }}>
            Logged. <a href="/activity" style={{ color: L_T.accent }}>[ACTIVITY →]</a>
          </span>
        )}
        {onDrillIn && <LBracket onClick={() => onDrillIn(rec)}>WORK IT OUT BELOW ↓</LBracket>}
      </div>
    </div>
  );
}

function SkippedRow({ rec, country, loan }: { rec: LiquidationRecommendation; country: 'IN' | 'US'; loan?: UserPayload['loans'][number] }) {
  const cur = country === 'IN' ? 'INR' : 'USD';
  return (
    <li style={{ borderTop: `1px dashed ${L_T.ruleSoft}`, padding: '8px 0', fontSize: 12, lineHeight: 1.55 }}>
      <strong>{rec.asset_label}</strong> → {loan ? loanLabel(loan) : rec.target_loan_label}
      <span style={{ color: L_T.muted }}>
        {' '}· {rec.skip_reason ?? 'Skipped'} · loan {formatPct(rec.debt_effective_rate)}, asset {formatPct(rec.asset_return_pct)} · {formatCurrency(rec.net_annual_benefit_nominal, cur)} a year
      </span>
    </li>
  );
}
