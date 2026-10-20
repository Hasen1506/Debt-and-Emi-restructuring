'use client';

/**
 * The payoff order in the masthead, as a read-only summary (audit 80+ B20
 * named the order; it is chosen once, on Plan, where the comparison and
 * the rules editor live). Home, Plan, Cash flow and Profile all show this
 * line. EDIT opens that one control.
 */
import { LBracket, L_MONO, L_T } from '@/components/ledger/primitives';
import type { StrategyName } from '@/lib/strategy';

/** The words on the summary: short enough for one row at 390. */
export const PAYOFF_SEGMENT: Record<StrategyName, string> = {
  avalanche: 'Cheapest',
  snowball: 'Smallest',
  rules: 'Mine',
};

export function PayoffOrderSwitch({
  strategy,
}: {
  strategy: StrategyName;
  /** Kept so the masthead can still pass the shared order; Plan says it. */
  sameOrder?: string[] | null;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontFamily: L_MONO }}>
      <span id="rd-payoff-order-label" style={{ fontSize: 'var(--fs-label)', letterSpacing: '0.1em', textTransform: 'uppercase', color: L_T.muted }}>
        Payoff order
      </span>
      <span data-testid="payoff-order-summary" style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: L_T.ink }}>
        {PAYOFF_SEGMENT[strategy]}
      </span>
      <LBracket href="/plan?set=order#plan-assumption" label="Edit payoff order on Plan">EDIT</LBracket>
    </span>
  );
}
