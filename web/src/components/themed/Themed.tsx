'use client';

/**
 * Themed presentational primitives — one component per concept, dispatching
 * to the per-theme token table in `@/styles/theme-tokens`. Use these to
 * write a surface ONCE for all three themes:
 *
 *   <ThemedContainer variant={theme}>
 *     <ThemedLabel variant={theme}>Today</ThemedLabel>
 *     <ThemedKpiGrid>
 *       <ThemedKpi label="You have" value="₹2.40L" detail="3 accounts" />
 *       …
 *     </ThemedKpiGrid>
 *   </ThemedContainer>
 *
 * Existing /debts /plan /home triplets each implement their own version
 * of these patterns inline; the migration plan is to peel them off
 * component-by-component, with this file as the receiving end.
 *
 * The pilot conversion is TodayCard — see web/src/components/debts/
 * TodayCard.tsx. Pattern is proven; the rest is mechanical.
 */

import type { ThemeName } from '@/lib/theme';
import { THEME_TOKENS, TONE_COLOR, type ThemedTone } from '@/styles/theme-tokens';

type Variant = ThemeName;

/**
 * Container resolves the visual chrome (border / radius / padding / font) for
 * the given theme. `tone` tints the left-accent stripe + the label color when
 * the caller's child label inherits from `currentColor` — useful for cards
 * that read as positive (cash advisor), negative (warning), or warning
 * (advance-tax penalty).
 */
export function ThemedContainer({
  variant,
  tone = 'neutral',
  children,
  style,
}: {
  variant: Variant;
  tone?: ThemedTone;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const t = THEME_TOKENS[variant];
  const accentColor = TONE_COLOR[tone];
  // For non-neutral tones, recolour the left-accent stripe to the tone.
  const leftAccent = t.leftAccent
    ? t.leftAccent.replace('var(--accent)', accentColor)
    : t.containerBorder;
  return (
    <div
      style={{
        fontFamily: t.fontFamily,
        fontSize: t.fontSize,
        lineHeight: 1.55,
        border: t.containerBorder,
        borderLeft: leftAccent,
        borderRadius: t.radius,
        padding: t.padding,
        background: variant === 'editorial' ? 'transparent' : 'var(--card)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function ThemedLabel({
  variant,
  tone = 'neutral',
  children,
  trailing,
}: {
  variant: Variant;
  tone?: ThemedTone;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const t = THEME_TOKENS[variant].label;
  return (
    <div
      style={{
        fontSize: t.fontSize,
        letterSpacing: t.letterSpacing,
        textTransform: t.textTransform,
        color: tone === 'neutral' ? t.color : TONE_COLOR[tone],
        marginBottom: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      {t.prefix}
      {children}
      {trailing}
    </div>
  );
}

/** Headline text (one bigger line). Used by cards that lead with prose
 *  rather than a KPI grid (CashAdvisor, DebtFreeRedirectPrompt). */
export function ThemedHeadline({
  variant,
  children,
}: {
  variant: Variant;
  children: React.ReactNode;
}) {
  const t = THEME_TOKENS[variant].value;
  return (
    <div
      style={{
        fontSize: variant === 'ledger' ? 12 : 14,
        fontWeight: t.fontWeight,
        lineHeight: 1.55,
        marginTop: 4,
      }}
    >
      {children}
    </div>
  );
}

/** Muted detail paragraph below a headline. Drops the size down. */
export function ThemedDetail({
  variant,
  children,
  style,
}: {
  variant: Variant;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const t = THEME_TOKENS[variant].detail;
  return (
    <div
      style={{
        fontSize: t.fontSize,
        color: t.color,
        marginTop: 6,
        lineHeight: 1.55,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function ThemedKpiGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}

export function ThemedKpi({
  variant,
  label,
  value,
  detail,
  valueColor,
}: {
  variant: Variant;
  label: string;
  value: string;
  detail: string;
  valueColor?: string;
}) {
  const t = THEME_TOKENS[variant];
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: t.label.color,
          letterSpacing: t.label.letterSpacing,
          textTransform: t.label.textTransform,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: t.value.fontSize,
          fontWeight: t.value.fontWeight,
          color: valueColor ?? 'var(--ink)',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: t.detail.fontSize,
          color: t.detail.color,
          marginTop: 4,
        }}
      >
        {detail}
      </div>
    </div>
  );
}

export function ThemedButton({
  variant,
  children,
  onClick,
  type = 'button',
}: {
  variant: Variant;
  children: React.ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
}) {
  const t = THEME_TOKENS[variant].button;
  return (
    <button
      type={type}
      onClick={onClick}
      style={{
        background: t.background,
        color: t.color,
        border: t.border,
        borderRadius: t.radius,
        fontSize: t.fontSize,
        letterSpacing: t.letterSpacing,
        textTransform: t.textTransform,
        padding: '5px 11px',
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}
