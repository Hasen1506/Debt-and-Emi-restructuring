'use client';

/**
 * Two-state toggle on /plan: "model expected hike" vs "lock current income".
 *
 * Mirrors StrategySwitcher — writes a cookie via writeHikeModelingClient()
 * and refreshes the route so the server component re-runs the simulation
 * with the new value. No client-side math; the engine still owns the schedule.
 *
 * Three variants match the Plan layouts:
 *   • 'inline'    — segmented pill (ExistingPlan / EditorialPlan aside)
 *   • 'ledger'    — bracketed `[MODEL HIKE] · [LOCK INCOME]` (LedgerPlan)
 *
 * `disabled` is set when the user's `annual_hike_rate` is 0 — there's no
 * hike to model, so the toggle is a no-op. We still render it so users
 * understand it exists, but greyed-out with an explainer.
 */
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { writeHikeModelingClient, type HikeModeling } from '@/lib/hike-modeling';

const LABEL: Record<HikeModeling, string> = {
  on: 'Model hike',
  off: 'Lock income',
};

const SHORT: Record<HikeModeling, string> = {
  on: 'Projection grows your income each year on your hike month.',
  off: 'Projection assumes your income stays flat for the whole horizon.',
};

export function HikeToggle({
  active,
  hikeRatePct,
  hikeMonthLabel,
  variant = 'inline',
}: {
  active: HikeModeling;
  /** "8%" or similar — for display only. */
  hikeRatePct: string;
  /** "April" — month the hike fires. */
  hikeMonthLabel: string;
  variant?: 'inline' | 'ledger';
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const noHike = hikeRatePct === '0%' || hikeRatePct === '';

  function pick(s: HikeModeling) {
    if (s === active || pending || noHike) return;
    writeHikeModelingClient(s);
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
        <span>HIKE MODEL</span>
        {(['on', 'off'] as HikeModeling[]).map((s, i) => {
          const selected = s === active;
          return (
            <span key={s} style={{ display: 'inline-flex', gap: 4 }}>
              {i > 0 && <span>·</span>}
              <button
                type="button"
                onClick={() => pick(s)}
                disabled={pending || noHike}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: noHike
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
                  opacity: noHike ? 0.4 : 1,
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
            : noHike
              ? 'no hike set — add one in setup to enable'
              : active === 'on'
                ? `${hikeRatePct} every ${hikeMonthLabel}`
                : 'flat income across horizon'}
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
        {(['on', 'off'] as HikeModeling[]).map((s) => {
          const selected = s === active;
          return (
            <button
              key={s}
              type="button"
              onClick={() => pick(s)}
              disabled={pending || noHike}
              style={{
                padding: '6px 14px',
                fontSize: 13,
                background: selected ? 'var(--accent)' : 'transparent',
                color: selected ? 'var(--canvas)' : 'var(--ink)',
                border: 'none',
                borderRight: '1px solid var(--border)',
                cursor: noHike
                  ? 'not-allowed'
                  : pending
                    ? 'wait'
                    : selected
                      ? 'default'
                      : 'pointer',
                fontWeight: selected ? 600 : 400,
                opacity: noHike ? 0.5 : 1,
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
          : noHike
            ? 'You haven’t set a hike rate in setup, so there’s nothing to model. Add one to enable.'
            : active === 'on'
              ? `${SHORT.on} (${hikeRatePct} every ${hikeMonthLabel}.)`
              : SHORT.off}
      </span>
    </div>
  );
}
