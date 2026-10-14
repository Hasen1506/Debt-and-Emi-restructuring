/**
 * Shared three-variant chrome for the /plan info panels (ActivityImpactBanner,
 * AdvanceTaxPanel, TaxBreakdown). Each panel was previously re-implementing
 * the same eyebrow + bordered-box + caveat scaffolding once per variant —
 * this primitive owns that scaffolding and lets each panel focus on its body.
 *
 * Variant naming intentionally local (`'ledger' | 'inline' | 'aside'`)
 * rather than the global ThemeName ('ledger' | 'editorial' | 'existing'),
 * matching the call-site convention these panels already use.
 *
 * Not used by ThemedSegmentedControl (two-variant pill/ledger toggle) or
 * the Themed.tsx KPI/Section primitives (different content shape).
 */

import type { ReactNode } from 'react';
import { TONE_COLOR, type ThemedTone } from '@/styles/theme-tokens';

type ShellVariant = 'ledger' | 'inline' | 'aside';

export function PanelShell({
  variant,
  eyebrow,
  tone = 'neutral',
  border = 'solid',
  caveat,
  bookend = false,
  children,
}: {
  variant: ShellVariant;
  /** Short uppercase string for ledger/aside, longer prose-cased title for
   *  inline. Caller decides casing — primitive only handles letter-spacing
   *  + font + size per variant. */
  eyebrow: string;
  /** Drives the accent color: border-left stripe (inline), border color
   *  (ledger dashed box), title color (aside). */
  tone?: ThemedTone;
  /** Ledger-only: dashed for warning/negative call-outs (ActivityImpact,
   *  AdvanceTax), solid for neutral data (TaxBreakdown). Ignored by other
   *  variants. */
  border?: 'solid' | 'dashed';
  /** Optional bottom caveat row — small muted text below the body. */
  caveat?: ReactNode;
  /** Aside-only: add a matching `borderBottom` + `marginBottom` so the
   *  block reads as bookended rather than a top-rule section. Used by
   *  panels that sit mid-page (ActivityImpactBanner). */
  bookend?: boolean;
  children: ReactNode;
}) {
  const toneColor = TONE_COLOR[tone];

  if (variant === 'ledger') {
    return (
      <section style={{ marginTop: 16 }}>
        <div
          style={{
            fontSize: 'var(--fs-label)',
            color: 'var(--muted)',
            letterSpacing: '0.18em',
            marginBottom: 6,
            fontFamily: 'var(--font-mono)',
          }}
        >
          {eyebrow}
        </div>
        <div
          style={{
            border: `1px ${border} ${tone === 'neutral' ? 'var(--border)' : toneColor}`,
            padding: '10px 12px',
            background: 'var(--card)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-dense)',
            color: 'var(--ink)',
            lineHeight: 1.6,
          }}
        >
          {children}
          {caveat && (
            <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 'var(--fs-small)' }}>
              {caveat}
            </div>
          )}
        </div>
      </section>
    );
  }

  if (variant === 'inline') {
    return (
      <div
        style={{
          background: 'var(--card)',
          padding: 14,
          borderRadius: 8,
          border: '1px solid var(--border)',
          borderLeft: tone === 'neutral' ? undefined : `3px solid ${toneColor}`,
          fontSize: 'var(--fs-body)',
          lineHeight: 1.55,
          marginTop: 16,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>{eyebrow}</div>
        {children}
        {caveat && (
          <div className="muted" style={{ fontSize: 'var(--fs-small)', marginTop: 10, lineHeight: 1.5 }}>
            {caveat}
          </div>
        )}
      </div>
    );
  }

  // aside (editorial)
  return (
    <div
      style={{
        marginTop: 28,
        marginBottom: bookend ? 28 : undefined,
        paddingTop: 20,
        paddingBottom: bookend ? 20 : undefined,
        borderTop: '1px solid var(--border)',
        borderBottom: bookend ? '1px solid var(--border)' : undefined,
        fontFamily: 'var(--font-display)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--fs-label)',
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: 'var(--soft)',
          marginBottom: 10,
        }}
      >
        {eyebrow}
      </div>
      {children}
      {caveat && (
        <p
          style={{
            marginTop: 12,
            fontStyle: 'italic',
            fontSize: 'var(--fs-dense)',
            color: 'var(--muted)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {caveat}
        </p>
      )}
    </div>
  );
}
