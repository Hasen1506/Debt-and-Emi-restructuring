/**
 * Payoff strategy preference — global to the user.
 *
 * Three strategies mirror engine/ordering.Strategy:
 *  - avalanche  → highest effective APR first (default, mathematically fastest)
 *  - hybrid     → small balances (<₹50k in IN / <$1k in US) first, then avalanche
 *  - snowball   → smallest balance first (pure behavioural)
 *
 * Stored in a cookie so the Plan page renders the right schedule on first
 * byte without a roundtrip — same pattern as `theme.ts`.
 */

export type StrategyName = 'avalanche' | 'hybrid' | 'snowball';

export const STRATEGIES: StrategyName[] = ['avalanche', 'hybrid', 'snowball'];
export const DEFAULT_STRATEGY: StrategyName = 'avalanche';
const COOKIE_NAME = 'finoptima_strategy';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function isStrategy(v: string | null | undefined): v is StrategyName {
  return v === 'avalanche' || v === 'hybrid' || v === 'snowball';
}

// ─── Client-side ────────────────────────────────────────────────────────────

export function readStrategyClient(): StrategyName {
  if (typeof document === 'undefined') return DEFAULT_STRATEGY;
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  const v = match ? decodeURIComponent(match[1]) : null;
  return isStrategy(v) ? v : DEFAULT_STRATEGY;
}

export function writeStrategyClient(strategy: StrategyName) {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE_NAME}=${strategy}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  void import('./server-sync').then(({ syncSliceToServer }) =>
    syncSliceToServer('strategy', strategy),
  );
}

// ─── Server-side ────────────────────────────────────────────────────────────

export async function loadStrategyServer(): Promise<StrategyName> {
  const { cookies } = await import('next/headers');
  const v = (await cookies()).get(COOKIE_NAME)?.value;
  return isStrategy(v) ? v : DEFAULT_STRATEGY;
}

export const STRATEGY_LABEL: Record<StrategyName, string> = {
  avalanche: 'Avalanche',
  hybrid: 'Hybrid',
  snowball: 'Snowball',
};

/** One line on the order: the personas' rule, then what it costs or buys. */
export const STRATEGY_SHORT: Record<StrategyName, string> = {
  avalanche: 'Highest rate first, for the least interest.',
  hybrid: 'Small balances first for a quick win, then the highest rate.',
  snowball: 'Smallest balance first. Debts close sooner, for more interest.',
};
