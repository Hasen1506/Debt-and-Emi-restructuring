/**
 * The hairline KPI grid used at the top of every Ledger page (LedgerHome,
 * LedgerPlan, LedgerPortfolio, plus the InsightsSummaryStrip
 * ledger branch). Each cell is `LABEL / value / sub-label`; the grid has a
 * 1px ink-coloured "border" by setting the wrapper background to ink and
 * the cells to canvas with a 1px gap, so the grid lines render as
 * exposed background.
 *
 * Optional `tip` slot on each cell renders next to the label — used by
 * /plan to attach an InfoTip for metrics that need a longer explainer.
 *
 * Not used by the editorial / existing themes — those have their own
 * less-dense KPI treatments.
 */

import type { ReactNode } from 'react';

export interface LedgerKpiCell {
  /** Short uppercase label, e.g. "TOTAL OUTSTANDING". */
  label: string;
  /** The big value, e.g. formatted currency or "5 / 12". */
  value: ReactNode;
  /** Subdued line below the value. Empty string allowed. */
  sub: ReactNode;
  /** Optional value color override — usually `var(--negative)` or
   *  `var(--positive)`. Defaults to `var(--ink)`. */
  tone?: string;
  /** Optional content rendered to the right of the label (typically an
   *  InfoTip). Used by /plan for metrics that warrant a longer explainer. */
  tip?: ReactNode;
}

export function LedgerKpiGrid({
  cells,
  valueFontSize = 18,
  valueLetterSpacing,
}: {
  cells: LedgerKpiCell[];
  /** Default 18 matches Debts / Insights / Plan. LedgerHome uses 17 to
   *  fit more characters into a 4-up grid; pass that explicitly. */
  valueFontSize?: number;
  /** Optional negative tracking on the value — LedgerHome uses -0.01em
   *  for tighter display feel. */
  valueLetterSpacing?: string;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cells.length}, 1fr)`,
        gap: 1,
        background: 'var(--ink)',
        padding: 1,
      }}
    >
      {cells.map((cell) => (
        <div
          key={cell.label}
          style={{ background: 'var(--canvas)', padding: '10px 12px' }}
        >
          <div
            style={{
              fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)',
              color: 'var(--muted)',
              letterSpacing: '0.12em',
              marginBottom: 4,
              display: cell.tip ? 'inline-flex' : undefined,
              alignItems: cell.tip ? 'center' : undefined,
              gap: cell.tip ? 4 : undefined,
            }}
          >
            {cell.label}
            {cell.tip}
          </div>
          <div
            style={{
              fontSize: valueFontSize,
              fontWeight: 700,
              color: cell.tone ?? 'var(--ink)',
              letterSpacing: valueLetterSpacing,
            }}
          >
            {cell.value}
          </div>
          <div style={{ fontSize: 'var(--fs-small)', color: 'var(--muted)', marginTop: 4 }}>
            {cell.sub}
          </div>
        </div>
      ))}
    </div>
  );
}
