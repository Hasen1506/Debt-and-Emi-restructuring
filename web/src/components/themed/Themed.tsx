'use client';

/**
 * Card-style presentational primitives (container, label, headline,
 * detail, KPI, button) on the ledger token set. Used by the smaller
 * surfaces on /debts and /plan so they share one border and label style:
 *
 *   <ThemedContainer tone="accent">
 *     <ThemedLabel>Cash advisor</ThemedLabel>
 *     <ThemedHeadline>Move ₹40,000 …</ThemedHeadline>
 *   </ThemedContainer>
 */

import { TOKENS, TONE_COLOR, type ThemedTone } from '@/styles/theme-tokens';


/**
 * Container resolves the visual chrome (border / radius / padding / font) for
 * the given theme. `tone` tints the left-accent stripe + the label color when
 * the caller's child label inherits from `currentColor` — useful for cards
 * that read as positive (cash advisor), negative (warning), or warning
 * (advance-tax penalty).
 */
export function ThemedContainer({
  tone = 'neutral',
  children,
  style,
}: {
  tone?: ThemedTone;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const t = TOKENS;
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
        background: 'var(--card)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function ThemedLabel({
  tone = 'neutral',
  children,
  trailing,
}: {
  tone?: ThemedTone;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const t = TOKENS.label;
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
  children,
}: {
  children: React.ReactNode;
}) {
  const t = TOKENS.value;
  return (
    <div
      style={{
        fontSize: 12,
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
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const t = TOKENS.detail;
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
