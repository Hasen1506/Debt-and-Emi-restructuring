'use client';

/**
 * Two-state toggle on /plan: "auto-reinvest tax savings" vs "off".
 *
 * Mirrors HikeToggle — writes a cookie via writeTaxReinvestClient() and
 * refreshes the route so the server component re-runs the simulation with
 * fresh reinvest_events. Engine routes each year's saving to the
 * highest-effective-APR active loan at the post-ITR-filing month.
 *
 * Two variants match the Plan layouts:
 *   • 'inline'    — segmented pill (ExistingPlan / EditorialPlan)
 *   • 'ledger'    — bracketed `[AUTO-REINVEST] · [OFF]` (LedgerPlan)
 *
 * `disabled` is set when projected savings sum to zero — e.g. India new
 * regime with no education loan, or US user without an eligible home /
 * education loan, or marginal_rate = 0. We still render the toggle but
 * grey it out with an explainer so users understand the feature exists.
 */
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  writeTaxReinvestClient,
  type TaxReinvestSetting,
} from '@/lib/tax-reinvest';

const LABEL: Record<TaxReinvestSetting, string> = {
  on: 'Auto-reinvest',
  off: 'Off',
};

const SHORT: Record<TaxReinvestSetting, string> = {
  on: 'Each year, projected tax savings on deductible interest are routed back to your highest-effective-APR debt.',
  off: 'No reinvest applied. Tax savings (if any) stay with you to spend freely.',
};

export function TaxReinvestToggle({
  active,
  totalProjectedSaving,
  variant = 'inline',
}: {
  active: TaxReinvestSetting;
  /** Sum of projected tax savings across the horizon, in user-default
   *  currency. Used to render the "₹2.4L over 20 years" label next to the
   *  toggle. Zero/empty disables the toggle. */
  totalProjectedSaving: string;
  variant?: 'inline' | 'ledger';
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const noSavings = totalProjectedSaving === '' || Number(totalProjectedSaving) <= 0;

  function pick(s: TaxReinvestSetting) {
    if (s === active || pending || noSavings) return;
    writeTaxReinvestClient(s);
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
        <span>TAX REINVEST</span>
        {(['on', 'off'] as TaxReinvestSetting[]).map((s, i) => {
          const selected = s === active;
          return (
            <span key={s} style={{ display: 'inline-flex', gap: 4 }}>
              {i > 0 && <span>·</span>}
              <button
                type="button"
                onClick={() => pick(s)}
                disabled={pending || noSavings}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: noSavings
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
                  opacity: noSavings ? 0.4 : 1,
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
            : noSavings
              ? 'no eligible deductions — switch regime or add a deductible loan'
              : active === 'on'
                ? `~${totalProjectedSaving} over horizon → highest APR debt`
                : `~${totalProjectedSaving} unrouted — toggle to apply`}
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
        {(['on', 'off'] as TaxReinvestSetting[]).map((s) => {
          const selected = s === active;
          return (
            <button
              key={s}
              type="button"
              onClick={() => pick(s)}
              disabled={pending || noSavings}
              style={{
                padding: '6px 14px',
                fontSize: 13,
                background: selected ? 'var(--accent)' : 'transparent',
                color: selected ? 'var(--canvas)' : 'var(--ink)',
                border: 'none',
                borderRight: '1px solid var(--border)',
                cursor: noSavings
                  ? 'not-allowed'
                  : pending
                    ? 'wait'
                    : selected
                      ? 'default'
                      : 'pointer',
                fontWeight: selected ? 600 : 400,
                opacity: noSavings ? 0.5 : 1,
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
          : noSavings
            ? 'No eligible deductions projected. India users: switch to old tax regime in setup to unlock Sec 24/80E. US users: only home + student loan interest qualify.'
            : active === 'on'
              ? `${SHORT.on} (~${totalProjectedSaving} over horizon.)`
              : `${SHORT.off} Projected reinvest if enabled: ~${totalProjectedSaving}.`}
      </span>
    </div>
  );
}
