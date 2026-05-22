'use client';

/**
 * Shared chrome for the binary toggles on /plan (Hike, Inflation, Tax-reinvest,
 * FX drift). Each toggle file is now a thin config wrapper that just declares
 * what label, options, cookie writer, helper text, and disabled-reason it has;
 * this component owns the pill chrome, the bracketed ledger variant, the
 * `useTransition` + `router.refresh()` wiring, and the disabled/pending UX.
 *
 * Not used by StrategySwitcher (carries per-option metric chips), EfSplitSlider
 * (range input), or PlanStartPicker (dropdown). Those are intentionally bespoke.
 *
 * The variant prop here is `'inline' | 'ledger'` — separate from the
 * `ThemeName` used by Themed.tsx primitives, because the toggle's "inline" mode
 * is the same rounded pill regardless of whether /plan is in existing or
 * editorial mode.
 */

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

type ControlVariant = 'inline' | 'ledger';

export function ThemedSegmentedControl<T extends string>({
  variant = 'inline',
  label,
  options,
  active,
  onPick,
  disabledReason,
  helper,
}: {
  variant?: ControlVariant;
  /** Plain-case label like "Hike model" — uppercased automatically in ledger. */
  label: string;
  options: { value: T; label: string }[];
  active: T;
  /** Sync cookie writer. Component wraps with router.refresh() inside a
   *  transition so the server component re-runs the simulation. */
  onPick: (value: T) => void;
  /** When present, the control is rendered disabled and `disabledReason`
   *  replaces the helper text. */
  disabledReason?: string;
  /** Normal-state helper text shown to the right (ledger) or below (inline)
   *  the pill. Parent builds this from active state, rates, etc. */
  helper?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const disabled = disabledReason != null;

  function pick(v: T) {
    if (v === active || pending || disabled) return;
    onPick(v);
    startTransition(() => router.refresh());
  }

  const helperText = pending
    ? variant === 'ledger'
      ? 'recomputing…'
      : 'Recomputing schedule…'
    : disabled
      ? disabledReason
      : helper;

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
        <span>{label.toUpperCase()}</span>
        {options.map((opt, i) => {
          const selected = opt.value === active;
          return (
            <span key={opt.value} style={{ display: 'inline-flex', gap: 4 }}>
              {i > 0 && <span>·</span>}
              <button
                type="button"
                onClick={() => pick(opt.value)}
                disabled={pending || disabled}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: disabled
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
                  opacity: disabled ? 0.4 : 1,
                }}
              >
                [{opt.label.toUpperCase()}]
              </button>
            </span>
          );
        })}
        {helperText && (
          <span
            style={{
              color: 'var(--muted)',
              letterSpacing: '0.02em',
              fontWeight: 400,
              textTransform: 'none',
              fontSize: 11,
            }}
          >
            {helperText}
          </span>
        )}
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
        {options.map((opt) => {
          const selected = opt.value === active;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => pick(opt.value)}
              disabled={pending || disabled}
              style={{
                padding: '6px 14px',
                fontSize: 13,
                background: selected ? 'var(--accent)' : 'transparent',
                color: selected ? 'var(--canvas)' : 'var(--ink)',
                border: 'none',
                borderRight: '1px solid var(--border)',
                cursor: disabled
                  ? 'not-allowed'
                  : pending
                    ? 'wait'
                    : selected
                      ? 'default'
                      : 'pointer',
                fontWeight: selected ? 600 : 400,
                opacity: disabled ? 0.5 : 1,
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {helperText && (
        <span
          className="muted"
          style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 480 }}
        >
          {helperText}
        </span>
      )}
    </div>
  );
}
