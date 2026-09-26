'use client';

import Decimal from 'decimal.js';
import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/Card';
import {
  api,
  formatCurrency,
  formatPct,
  type LiquidationRankingsResponse,
  type LiquidationRecommendation,
  type LiquidationVerdict,
  type UserPayload,
} from '@/lib/api';
import { computeBreakdown } from '@/lib/effective-apr';
import { usItemises } from '@/lib/deductions';
import { applyToolResult } from '@/lib/apply-tool-result';

interface Props {
  user: UserPayload;
  marginalRate: string;
  isLive: boolean;
  /** Called when the user clicks "drill in" — pre-fills the sandbox form. */
  onDrillIn?: (rec: LiquidationRecommendation) => void;
}

const VERDICT_COLOR: Record<LiquidationVerdict, string> = {
  clear_win:   'var(--positive)',
  conditional: 'var(--accent)',
  marginal:    'var(--muted)',
  dont_sell:   'var(--negative)',
};

const VERDICT_LABEL: Record<LiquidationVerdict, string> = {
  clear_win:   'Clear win',
  conditional: 'Conditional — read the caveats',
  marginal:    'Marginal — small edge',
  dont_sell:   "Don't sell",
};

export function PortfolioRanker({ user, marginalRate, isLive, onDrillIn }: Props) {
  const [data, setData] = useState<LiquidationRankingsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  // Per-loan effective rate dict, indexed by loan position.
  const effectiveRates = useMemo(() => {
    const out: Record<number, string> = {};
    user.loans.forEach((l, i) => {
      const { effective } = computeBreakdown(
        l, marginalRate, user.country, user.tax_regime, usItemises(user),
      );
      out[i] = effective.toFixed(4);
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
      <Card>
        <p className="muted">
          Portfolio ranker needs both assets and debts. Add a debt at{' '}
          <a href="/onboarding?step=loans">/onboarding</a>.
        </p>
      </Card>
    );
  }

  if (busy) {
    return (
      <Card>
        <p className="muted">Ranking {user.assets.length} asset(s) against {user.loans.length} debt(s)…</p>
      </Card>
    );
  }

  if (err) {
    return (
      <Card>
        <p style={{ color: 'var(--negative)' }}>Ranking failed: {err}</p>
      </Card>
    );
  }

  if (!data) return null;

  const hasRecs = data.recommendations.length > 0;
  const hasSkipped = data.considered_but_skipped.length > 0;

  return (
    <Card>
      <div style={{ marginBottom: 12 }}>
        <h2 className="h2" style={{ margin: 0 }}>Portfolio rankings</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
          Every asset paired against every debt; after-tax net annual benefit
          ranks the list. Skipped pairings sit below.
        </p>
      </div>

      {!hasRecs && (
        <p className="muted" style={{ fontSize: 13 }}>
          No pairing came back as worth doing. Expand the &quot;considered but
          skipped&quot; section to see why.
        </p>
      )}

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
          <button
            onClick={() => setShowSkipped((s) => !s)}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--accent)', cursor: 'pointer',
              fontSize: 12, textDecoration: 'underline', padding: 0,
            }}
          >
            {showSkipped ? 'Hide' : 'Show'} other moves we considered ({data.considered_but_skipped.length})
          </button>
          {showSkipped && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {data.considered_but_skipped.map((rec, idx) => (
                <SkippedRow
                  key={`${rec.asset_index}-${rec.target_loan_index}-${idx}`}
                  rec={rec}
                  country={user.country}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
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

  function plan() {
    // Logs the recommendation against the chosen debt as a partial/full payoff.
    const target = loans[rec.target_loan_index];
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
      note: `Asset sold (${rec.asset_label}) — ${formatCurrency(rec.proceeds.net_proceeds, cur)} → ${target?.bank ?? 'loan'}`,
      loans,
      country,
    });
    setApplied(true);
  }

  return (
    <div
      style={{
        border: `1px solid ${color}`,
        borderRadius: 8,
        padding: 14,
        background: 'var(--canvas)',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600 }}>
          {rec.asset_label} → {rec.target_loan_label}
        </div>
        <div style={{ color, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>
          {label}
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>
        {rec.proceeds.explanation}
      </p>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10,
      }}>
        <MiniStat label="Net proceeds"  value={formatCurrency(rec.proceeds.net_proceeds, cur)} />
        <MiniStat label="Debt cleared"  value={formatCurrency(rec.debt_cleared_amount, cur)} />
        <MiniStat label="Interest saved (yr 1)"
                  value={formatCurrency(rec.interest_saved_yr1_nominal, cur)} />
        <MiniStat label="Net annual benefit"
                  value={formatCurrency(rec.net_annual_benefit_nominal, cur)}
                  color={Number(rec.net_annual_benefit_nominal) > 0 ? 'var(--positive)' : 'var(--negative)'} />
      </div>

      {rec.proceeds.caveats.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--muted-ink, #666)' }}>
          {rec.proceeds.caveats.map((c, i) => <li key={i} style={{ marginBottom: 2 }}>{c}</li>)}
        </ul>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
        {isLive && !applied && (
          <button
            onClick={plan}
            className="btn btn-primary"
            style={{ padding: '6px 12px', fontSize: 13 }}
          >
            Apply — log payoff to {loans[rec.target_loan_index]?.bank ?? 'loan'}
          </button>
        )}
        {applied && (
          <span className="muted" style={{ fontSize: 12, color: 'var(--positive)' }}>
            ✓ Logged to your activity ledger
          </span>
        )}
        {onDrillIn && (
          <button
            onClick={() => onDrillIn(rec)}
            style={{
              padding: '6px 10px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--ink)', cursor: 'pointer', fontSize: 12,
            }}
          >
            Open in sandbox
          </button>
        )}
      </div>
    </div>
  );
}

function SkippedRow({ rec, country }: { rec: LiquidationRecommendation; country: 'IN' | 'US' }) {
  const cur = country === 'IN' ? 'INR' : 'USD';
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 6,
      padding: '8px 12px', fontSize: 12,
      display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
    }}>
      <span>
        <strong>{rec.asset_label}</strong> → {rec.target_loan_label}
      </span>
      <span className="muted" style={{ flex: '1 1 200px' }}>
        {rec.skip_reason ?? 'Skipped'}
        {' '}· debt {formatPct(rec.debt_effective_rate)} vs asset {formatPct(rec.asset_return_pct)}
        {' '}· would net {formatCurrency(rec.net_annual_benefit_nominal, cur)}/yr
      </span>
    </div>
  );
}

function MiniStat({ label, value, color = 'var(--ink)' }: {
  label: string; value: string; color?: string;
}) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11 }}>{label}</div>
      <div className="num" style={{ fontSize: 15, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}
