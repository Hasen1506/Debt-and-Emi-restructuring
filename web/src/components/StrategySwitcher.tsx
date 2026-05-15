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
 *   • 'ledger' — bracketed `[AVALANCHE] · [HYBRID] · [SNOWBALL]` for LedgerPlan
 *
 * Both surfaces share the same state + cookie write so a user who toggles
 * themes keeps their strategy preference.
 */
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  STRATEGIES,
  STRATEGY_LABEL,
  STRATEGY_SHORT,
  writeStrategyClient,
  type StrategyName,
} from '@/lib/strategy';

export function StrategySwitcher({
  active,
  variant = 'inline',
}: {
  active: StrategyName;
  variant?: 'inline' | 'ledger';
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function pick(s: StrategyName) {
    if (s === active || pending) return;
    writeStrategyClient(s);
    startTransition(() => {
      // Server component re-renders with the new cookie value.
      router.refresh();
    });
  }

  if (variant === 'ledger') {
    return (
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
        <span style={{ color: 'var(--muted)' }}>STRATEGY</span>
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
                [{STRATEGY_LABEL[s].toUpperCase()}]
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
          {pending ? 'recomputing…' : STRATEGY_SHORT[active]}
        </span>
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
        {pending ? 'Recomputing schedule…' : STRATEGY_SHORT[active]}
      </span>
    </div>
  );
}
