/**
 * Editorial-theme sidebar primitives. Used by the two-column editorial
 * page layouts (EditorialDebts, EditorialInsights) for their "marginalia"
 * notes that flank the main article.
 *
 * Two shapes:
 *  - MarginaliaItem: small italic display title + body. For prose notes.
 *  - MarginaliaKpi:  big display value + small label. For numeric figures.
 *
 * Both render the same border-left + paddingLeft + marginBottom container,
 * so the two shapes stack consistently in a sidebar column.
 */

import type { ReactNode } from 'react';

/** Container used by both shapes. Accent stripe optional (for highlighted
 *  items like the editorial "loudest line"). */
function MarginaliaContainer({
  accent = false,
  children,
}: {
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        borderLeft: `2px solid ${accent ? 'var(--accent)' : 'var(--border)'}`,
        paddingLeft: 12,
        marginBottom: 18,
      }}
    >
      {children}
    </div>
  );
}

/** Prose note: italic display title + body text. */
export function MarginaliaItem({
  title,
  accent = false,
  children,
}: {
  title: string;
  /** When true, the left stripe + title use --accent. Used for the
   *  "loudest line" highlight in EditorialDebts. */
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <MarginaliaContainer accent={accent}>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 13,
          color: accent ? 'var(--accent)' : 'var(--ink)',
          fontStyle: 'italic',
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <div style={{ color: 'var(--ink)', fontSize: 12, lineHeight: 1.55 }}>
        {children}
      </div>
    </MarginaliaContainer>
  );
}

/** Numeric figure: big display value + small label below. */
export function MarginaliaKpi({
  value,
  label,
}: {
  value: ReactNode;
  label: ReactNode;
}) {
  return (
    <MarginaliaContainer>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          color: 'var(--ink)',
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div style={{ marginTop: 4 }}>{label}</div>
    </MarginaliaContainer>
  );
}
