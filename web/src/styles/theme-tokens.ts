/**
 * Per-theme presentation tokens — extracts the visual differences between
 * Ledger / Editorial / Existing into one table so a component can ship
 * once instead of three near-identical files.
 *
 * USE THIS for new components. Existing components (LedgerDebts /
 * EditorialDebts / ExistingDebts triplets) are scheduled to migrate
 * incrementally — TodayCard is the pilot conversion that proves the
 * pattern. See `web/src/components/debts/TodayCard.tsx`.
 *
 * Idea: each theme has the same conceptual containers (Section, Card,
 * Label, Accent button) but different visual treatments. By naming the
 * conceptual containers and parameterising the visuals here, a new
 * surface (`<ThemedCard variant={theme}>…</ThemedCard>`) ships once,
 * and the theme switcher remains a single CSS-variable swap.
 *
 * The presentational primitives live in `@/components/themed/*.tsx`.
 */

import type { ThemeName } from '@/lib/theme';

/** Tone tints the accent stripe / label color of a themed container.
 *  Maps to css vars so the existing palette stays the source of truth. */
export type ThemedTone = 'neutral' | 'accent' | 'positive' | 'negative' | 'warning';

export const TONE_COLOR: Record<ThemedTone, string> = {
  neutral: 'var(--ink)',
  accent: 'var(--accent)',
  positive: 'var(--positive)',
  negative: 'var(--negative)',
  warning: 'var(--warning)',
};

export interface ThemeTokens {
  /** Font family applied to the whole container (cascades to text). */
  fontFamily: string;
  /** Base type size inside the container. */
  fontSize: number;
  /** Border treatment for the container. Used for section + card. */
  containerBorder: string;
  /** Left-accent stripe — Ledger uses a hard inset, Editorial a thin
   *  border-left, Existing skips it. Empty string = no stripe. */
  leftAccent: string;
  /** Border radius for cards. Ledger keeps a hard edge; others round. */
  radius: number;
  /** Default container padding. */
  padding: string;
  /** Section-label styles: uppercase + letter-spacing for the
   *  mono-typographic themes, plain for the warm-card theme. */
  label: {
    fontSize: number;
    letterSpacing: string;
    textTransform: 'uppercase' | 'none';
    color: string;
    /** Optional Ledger-style "$" or Editorial-style centred header
     *  prefix the caller can splice in. */
    prefix?: string;
  };
  /** Big-number value style used in KPI cells. */
  value: {
    fontSize: number;
    fontWeight: number;
  };
  /** Detail subline below the value. */
  detail: {
    fontSize: number;
    color: string;
  };
  /** Accent CTA button style. */
  button: {
    background: string;
    color: string;
    border: string;
    radius: number;
    fontSize: number;
    letterSpacing: string;
    textTransform: 'uppercase' | 'none';
  };
}

export const THEME_TOKENS: Record<ThemeName, ThemeTokens> = {
  ledger: {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    containerBorder: '1px solid var(--ink)',
    leftAccent: '',
    radius: 0,
    padding: '12px 14px',
    label: {
      fontSize: 11,
      letterSpacing: '0.18em',
      textTransform: 'uppercase',
      color: 'var(--muted)',
      prefix: '$ ',
    },
    value: { fontSize: 18, fontWeight: 700 },
    detail: { fontSize: 11, color: 'var(--muted)' },
    button: {
      background: 'var(--accent)',
      color: 'var(--canvas)',
      border: 'none',
      radius: 0,
      fontSize: 10,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
    },
  },
  editorial: {
    fontFamily: 'inherit',
    fontSize: 14,
    containerBorder: 'none',
    leftAccent: '3px solid var(--accent)',
    radius: 0,
    padding: '0 0 0 14px',
    label: {
      fontSize: 11,
      letterSpacing: '0.15em',
      textTransform: 'uppercase',
      color: 'var(--accent)',
    },
    value: { fontSize: 18, fontWeight: 600 },
    detail: { fontSize: 12, color: 'var(--muted)' },
    button: {
      background: 'transparent',
      color: 'var(--accent)',
      border: '1px solid var(--accent)',
      radius: 4,
      fontSize: 11,
      letterSpacing: '0',
      textTransform: 'none',
    },
  },
  existing: {
    fontFamily: 'inherit',
    fontSize: 14,
    containerBorder: '1px solid var(--border)',
    leftAccent: '',
    radius: 8,
    padding: '14px',
    label: {
      fontSize: 11,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: 'var(--muted)',
    },
    value: { fontSize: 18, fontWeight: 700 },
    detail: { fontSize: 11, color: 'var(--muted)' },
    button: {
      background: 'var(--accent)',
      color: 'var(--canvas)',
      border: 'none',
      radius: 4,
      fontSize: 12,
      letterSpacing: '0',
      textTransform: 'none',
    },
  },
};
