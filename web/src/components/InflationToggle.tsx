'use client';

/**
 * Two-state toggle on /plan: model expense inflation, or treat expenses
 * as flat across the horizon?
 *
 * Mirrors HikeToggle / TaxReinvestToggle — writes a cookie via
 * writeInflationModelingClient() and refreshes the route so the server
 * component re-runs the simulation with `inflate_expenses=true`. Engine
 * compounds user.inflation_rate into the surplus computation each month.
 *
 * `disabled` is set when user.inflation_rate is zero — no inflation
 * configured, nothing to compound. We still render the toggle (consistent
 * with HikeToggle's no-hike state) with an explainer.
 */
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  writeInflationModelingClient,
  type InflationModeling,
} from '@/lib/inflation-modeling';

const LABEL: Record<InflationModeling, string> = {
  on: 'Inflate expenses',
  off: 'Flat expenses',
};

const SHORT: Record<InflationModeling, string> = {
  on: 'Your monthly expenses grow at the country-default CPI rate each year. Surplus shrinks over time → debt-free month pushes out.',
  off: "Expenses stay flat for the entire horizon. Realistic for short-tenure plans, optimistic for 10-20yr home loans.",
};

export function InflationToggle({
  active,
  inflationRatePct,
  variant = 'inline',
}: {
  active: InflationModeling;
  /** "5.5%" — for display only. */
  inflationRatePct: string;
  variant?: 'inline' | 'ledger';
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const noInflation = inflationRatePct === '0%' || inflationRatePct === '';

  function pick(s: InflationModeling) {
    if (s === active || pending || noInflation) return;
    writeInflationModelingClient(s);
    startTransition(() => router.refresh());
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
        <span>INFLATION</span>
        {(['on', 'off'] as InflationModeling[]).map((s, i) => {
          const selected = s === active;
          return (
            <span key={s} style={{ display: 'inline-flex', gap: 4 }}>
              {i > 0 && <span>·</span>}
              <button
                type="button"
                onClick={() => pick(s)}
                disabled={pending || noInflation}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: noInflation
                    ? 'not-allowed'
                    : pending
                      ? 'wait'
                      : selected
                        ? 'default'
                        : 'pointer',
                  color: selected ? 'var(--ink)' : 'var(--muted)',
                  fontWeight: selected ? 700 : 400,
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.08em',
                  textDecoration: selected ? 'none' : 'underline',
                  textDecorationStyle: 'dotted',
                  opacity: noInflation ? 0.4 : 1,
                }}
              >
                [{LABEL[s].toUpperCase()}]
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
          {pending
            ? 'recomputing…'
            : noInflation
              ? 'no inflation set — adjust in setup to enable'
              : active === 'on'
                ? `expenses +${inflationRatePct}/yr`
                : 'flat expenses across horizon'}
        </span>
      </div>
    );
  }

  // inline — segmented pill
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
        {(['on', 'off'] as InflationModeling[]).map((s) => {
          const selected = s === active;
          return (
            <button
              key={s}
              type="button"
              onClick={() => pick(s)}
              disabled={pending || noInflation}
              style={{
                padding: '6px 14px',
                fontSize: 13,
                background: selected ? 'var(--accent)' : 'transparent',
                color: selected ? 'var(--canvas)' : 'var(--ink)',
                border: 'none',
                borderRight: '1px solid var(--border)',
                cursor: noInflation
                  ? 'not-allowed'
                  : pending
                    ? 'wait'
                    : selected
                      ? 'default'
                      : 'pointer',
                fontWeight: selected ? 600 : 400,
                opacity: noInflation ? 0.5 : 1,
              }}
            >
              {LABEL[s]}
            </button>
          );
        })}
      </div>
      <span className="muted" style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 480 }}>
        {pending
          ? 'Recomputing schedule…'
          : noInflation
            ? 'Inflation rate is 0 in setup. Set a value to model expense growth.'
            : active === 'on'
              ? `${SHORT.on} (${inflationRatePct} per year.)`
              : SHORT.off}
      </span>
    </div>
  );
}
