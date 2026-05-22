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
import { THEME_TOKENS } from '@/styles/theme-tokens';

type Variant = ThemeName;

export function ThemedContainer({
  variant,
  children,
  style,
}: {
  variant: Variant;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const t = THEME_TOKENS[variant];
  return (
    <div
      style={{
        fontFamily: t.fontFamily,
        fontSize: t.fontSize,
        lineHeight: 1.55,
        border: t.containerBorder,
        borderLeft: t.leftAccent || t.containerBorder,
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
  children,
  trailing,
}: {
  variant: Variant;
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
        color: t.color,
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
