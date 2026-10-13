'use client';

/**
 * Three-way payoff-strategy chooser for the Plan page.
 *
 * Writes the choice to a cookie via writeStrategyClient() and asks Next.js
 * to re-fetch the server component so the new schedule appears with the
 * same render path as a fresh page load. No client-side simulation —
 * the engine still owns the math.
 *
 * Two variants:
 *   • 'inline' — segmented pill control, used in ExistingPlan / EditorialPlan
 *   • 'ledger' — bracketed `[AVALANCHE] · [YOUR RULES] · [SNOWBALL]` for LedgerPlan
 *     (with the rules editor under it when "Your rules" is picked)
 *
 * Both surfaces share the same state + cookie write so a user who toggles
 * themes keeps their strategy preference.
 */
import { OfflineStrategyNote, useStrategyRefresh } from '@/components/useStrategyRefresh';
import {
  STRATEGIES,
  STRATEGY_LABEL,
  STRATEGY_PLAIN,
  STRATEGY_SHORT,
  writeStrategyClient,
  type StrategyName,
} from '@/lib/strategy';
import { InfoTip } from '@/components/ToolPrimitives';
import { monthIndexToCountryLabel } from '@/lib/today';
import type { Country, UserPayload } from '@/lib/api';
import { PayoffRulesEditor, rulesCost } from '@/components/plan/PayoffRulesEditor';

/**
 * Per-strategy headline metrics — close month + total interest — keyed by
 * strategy name. The `null` debt-free-month case means horizon ran out
 * before clearance (rare; only happens when surplus is too thin to clear
 * within 100y).
 */
export type StrategyCompare = Record<
  StrategyName,
  { debtFreeMonth: number | null; totalInterest: string }
>;

const STRATEGY_EXPLAINER: Record<StrategyName, React.ReactNode> = {
  avalanche: (
    <>
      <strong>Avalanche (cheapest path)</strong> — pay minimums on every loan, then throw all
      extra cash at the loan where the <em>next</em> payment saves the most: its
      interest compounded monthly, plus GST on card interest, minus any tax
      break the payment gives up and any prepayment fee. Fees already paid
      (processing, insurance) don&apos;t count: they don&apos;t change what the
      next payment saves. A loan still in its lock-in goes last. When a loan
      clears, cascade to the next. This is the cheapest path for the interest
      still ahead.
    </>
  ),
  snowball: (
    <>
      <strong>Snowball (smallest first)</strong> — pay minimums, then throw extra at the
      <em> smallest balance</em> first. You'll pay slightly more interest than
      Avalanche, but you'll close out loans faster and feel quick wins. Pick
      this if motivation matters more than optimal math.
    </>
  ),
  rules: (
    <>
      <strong>Your rules (your own order)</strong> — pin a loan to the front,
      clear any loan under an amount first, or set the whole order. Whatever
      the rules don&apos;t place goes by what the next payment saves (as Avalanche). The plan shows
      what your rules cost against Avalanche. (This replaces Hybrid, which is
      the rule &quot;clear loans under ₹50,000 / $1,000 first&quot;.)
    </>
  ),
};

function formatInterest(value: string, country?: Country): string {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n === 0) return '—';
  const sym = country === 'US' ? '$' : '₹';
  if (country === 'US') {
    if (n >= 1_000_000) return `${sym}${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${sym}${(n / 1_000).toFixed(0)}k`;
    return `${sym}${n.toFixed(0)}`;
  }
  if (n >= 10_000_000) return `${sym}${(n / 10_000_000).toFixed(2)}Cr`;
  if (n >= 100_000) return `${sym}${(n / 100_000).toFixed(2)}L`;
  if (n >= 1_000) return `${sym}${(n / 1_000).toFixed(0)}k`;
  return `${sym}${n.toFixed(0)}`;
}

/** True when every strategy gives the same debt-free month and (near enough) interest. */
function allSame(compare: StrategyCompare): boolean {
  const rows = STRATEGIES.map((s) => compare[s]);
  const first = Number(rows[0]?.totalInterest ?? 0);
  // Within 0.1% counts as the same: the rows show ₹5.06L either way.
  return rows.every(
    (r) =>
      r?.debtFreeMonth === rows[0]?.debtFreeMonth &&
      Math.abs(Number(r?.totalInterest ?? 0) - first) <= Math.max(1, first * 0.001),
  );
}

function CompareRow({
  strategy,
  isActive,
  compare,
  country,
  mono,
}: {
  strategy: StrategyName;
  isActive: boolean;
  compare: StrategyCompare;
  country?: Country;
  mono: boolean;
}) {
  const entry = compare[strategy];
  const dateLabel =
    entry?.debtFreeMonth != null
      ? monthIndexToCountryLabel(entry.debtFreeMonth, country ?? 'IN')
      : 'beyond horizon';
  const interestLabel = formatInterest(entry?.totalInterest ?? '0', country);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 1fr auto',
        gap: 8,
        fontFamily: mono ? 'var(--font-mono)' : undefined,
        fontSize: 12,
        padding: '2px 0',
        color: isActive ? 'var(--ink)' : 'var(--muted)',
        fontWeight: isActive ? 600 : 400,
      }}
    >
      <span style={{ letterSpacing: mono ? '0.08em' : undefined, textTransform: mono ? 'uppercase' : undefined }}>
        {isActive && '▸ '}
        {STRATEGY_LABEL[strategy]}
      </span>
      <span>{dateLabel}</span>
      <span style={{ color: 'var(--muted)' }}>{interestLabel} interest</span>
    </div>
  );
}

export function StrategySwitcher({
  active,
  variant = 'inline',
  compare,
  country,
  user,
  money,
}: {
  active: StrategyName;
  variant?: 'inline' | 'ledger';
  /** The saved profile: names the loans in the rules editor ('rules' only). */
  user?: UserPayload;
  /** Formats an amount in the user's currency for the rules' cost line. */
  money?: (n: number) => string;
  /** Per-strategy headline metrics. When provided, the switcher renders a
   *  compact 3-row comparison below the picker so the decision is visible
   *  without flipping strategies one-by-one to A/B. */
  compare?: StrategyCompare;
  /** User country — drives the close-month label (M YYYY) format + currency
   *  symbol on the interest column. Defaults to country-aware label helper's
   *  fallback when omitted. */
  country?: Country;
}) {
  // R6B-9: offline, the choice is saved and the refresh waits for the connection.
  const { pending, offline, refresh } = useStrategyRefresh();

  function pick(s: StrategyName) {
    if (s === active || pending) return;
    writeStrategyClient(s);
    // Server component re-renders with the new cookie value.
    refresh();
  }

  if (variant === 'ledger') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 12,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.08em',
          color: 'var(--muted)',
        }}
      >
        <span style={{ color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          STRATEGY
          <InfoTip>
            <strong>How we attack your debts.</strong> Pick one; the schedule
            and chart update to match.
            <div style={{ marginTop: 8 }}>
              {STRATEGY_EXPLAINER.avalanche}
            </div>
            <div style={{ marginTop: 8 }}>
              {STRATEGY_EXPLAINER.snowball}
            </div>
            <div style={{ marginTop: 8 }}>
              {STRATEGY_EXPLAINER.rules}
            </div>
          </InfoTip>
        </span>
        {STRATEGIES.map((s, i) => {
          const selected = s === active;
          return (
            <span key={s} style={{ display: 'inline-flex', gap: 4 }}>
              {i > 0 && <span style={{ color: 'var(--muted)' }}>·</span>}
              <button
                type="button"
                onClick={() => pick(s)}
                disabled={pending}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: pending ? 'wait' : selected ? 'default' : 'pointer',
                  color: selected ? 'var(--ink)' : 'var(--muted)',
                  fontWeight: selected ? 700 : 400,
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.08em',
                  textDecoration: selected ? 'none' : 'underline',
                  textDecorationStyle: 'dotted',
                }}
              >
                [{STRATEGY_LABEL[s].toUpperCase()} · {STRATEGY_PLAIN[s].toUpperCase()}]
              </button>
            </span>
          );
        })}
        <span
          style={{
            color: 'var(--muted)',
            letterSpacing: '0.02em',
            fontWeight: 400,
            textTransform: 'none',
            fontSize: 11,
          }}
        >
          {pending ? 'Working it out…' : STRATEGY_SHORT[active]}
        </span>
      </div>
      <OfflineStrategyNote show={offline} />
      {compare && allSame(compare) && (
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          All three clear your debt in the same month at the same cost, so the
          choice doesn&apos;t matter for your loans.
        </div>
      )}
      {compare && !allSame(compare) && (
        <div
          style={{
            paddingLeft: 6,
            borderLeft: '2px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
          }}
        >
          {STRATEGIES.map((s) => (
            <CompareRow
              key={s}
              strategy={s}
              isActive={s === active}
              compare={compare}
              country={country}
              mono
            />
          ))}
        </div>
      )}
      {active === 'rules' && user && (
        <PayoffRulesEditor
          user={user}
          cost={compare ? rulesCost(compare.rules, compare.avalanche) : null}
          avalancheMonth={compare?.avalanche?.debtFreeMonth ?? null}
          money={money ?? ((n) => `${country === 'US' ? '$' : '₹'}${Math.round(n).toLocaleString(country === 'US' ? 'en-US' : 'en-IN')}`)}
        />
      )}
      </div>
    );
  }

  // inline — segmented pill (used by ExistingPlan / EditorialPlan)
  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 6,
        fontSize: 12,
      }}
    >
      <span
        className="muted"
        style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        Payoff strategy
        <InfoTip>
          <strong>How we attack your debts.</strong> Pick one; the schedule
          and chart update to match.
          <div style={{ marginTop: 8 }}>{STRATEGY_EXPLAINER.avalanche}</div>
          <div style={{ marginTop: 8 }}>{STRATEGY_EXPLAINER.snowball}</div>
          <div style={{ marginTop: 8 }}>{STRATEGY_EXPLAINER.rules}</div>
        </InfoTip>
      </span>
      <div
        style={{
          display: 'inline-flex',
          border: '1px solid var(--border)',
          borderRadius: 6,
          overflow: 'hidden',
          background: 'var(--card)',
        }}
      >
        {STRATEGIES.map((s) => {
          const selected = s === active;
          return (
            <button
              key={s}
              type="button"
              onClick={() => pick(s)}
              disabled={pending}
              style={{
                padding: '6px 14px',
                fontSize: 13,
                background: selected ? 'var(--accent)' : 'transparent',
                color: selected ? 'var(--canvas)' : 'var(--ink)',
                border: 'none',
                borderRight: '1px solid var(--border)',
                cursor: pending ? 'wait' : selected ? 'default' : 'pointer',
                fontWeight: selected ? 600 : 400,
              }}
            >
              {STRATEGY_LABEL[s]}
            </button>
          );
        })}
      </div>
      <span
        className="muted"
        style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 480 }}
      >
        {pending ? 'Working it out…' : STRATEGY_SHORT[active]}
      </span>
      <OfflineStrategyNote show={offline} />
      {compare && (
        <div
          style={{
            marginTop: 4,
            paddingLeft: 8,
            borderLeft: '2px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
            maxWidth: 360,
          }}
        >
          {STRATEGIES.map((s) => (
            <CompareRow
              key={s}
              strategy={s}
              isActive={s === active}
              compare={compare}
              country={country}
              mono={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
