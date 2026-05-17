'use client';

/**
 * Two-state toggle on /plan: model FX drift for non-residence-currency
 * loans, or hold spot rate flat across the horizon?
 *
 * Visible only for hybrid users (≥ 2 currencies in play). Single-currency
 * users see nothing — parent component gates rendering.
 *
 * When ON, the engine compounds the per-currency drift rate into the FX
 * conversion each month. For an NRI-US user with an INR home loan, a
 * +2.5%/yr INR drift means EMIs paid in INR cost fewer USD each year as
 * the rupee depreciates.
 */
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { writeFxDriftClient, type FxDriftSetting } from '@/lib/fx-drift';

const LABEL: Record<FxDriftSetting, string> = {
  on: 'Model drift',
  off: 'Flat FX',
};

const SHORT: Record<FxDriftSetting, string> = {
  on: "Foreign-currency loan EMIs are converted using a drift-adjusted FX rate that compounds yearly — captures the long-run inflation differential view.",
  off: 'Foreign-currency loan EMIs use today\'s spot rate for the entire horizon. Simpler, but understates the FX dimension for multi-year loans.',
};

export function FxDriftToggle({
  active,
  driftLabel,
  variant = 'inline',
}: {
  active: FxDriftSetting;
  /** Pretty label like "INR +2.5%/yr" for the helper line. */
  driftLabel: string;
  variant?: 'inline' | 'ledger';
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function pick(s: FxDriftSetting) {
    if (s === active || pending) return;
    writeFxDriftClient(s);
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
        <span>FX DRIFT</span>
        {(['on', 'off'] as FxDriftSetting[]).map((s, i) => {
          const selected = s === active;
          return (
            <span key={s} style={{ display: 'inline-flex', gap: 4 }}>
              {i > 0 && <span>·</span>}
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
            : active === 'on'
              ? driftLabel
              : 'spot FX held flat across horizon'}
        </span>
      </div>
    );
  }

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
        {(['on', 'off'] as FxDriftSetting[]).map((s) => {
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
              {LABEL[s]}
            </button>
          );
        })}
      </div>
      <span className="muted" style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 480 }}>
        {pending
          ? 'Recomputing schedule…'
          : active === 'on'
            ? `${SHORT.on} (${driftLabel}.)`
            : SHORT.off}
      </span>
    </div>
  );
}
