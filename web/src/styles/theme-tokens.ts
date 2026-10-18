/**
 * Presentation tokens for the themed primitives in `@/components/themed`.
 * Ledger is the only look, so this is one token set; the primitives keep
 * card-style surfaces (cash advisor, stale-card nudge, tax sleeve)
 * consistent without each file restating borders and label styles.
 */

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
    /** Optional text before the label. None now: a "$" here read as
     *  dollars on rupee plans. */
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

export const TOKENS: ThemeTokens = {
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
};
