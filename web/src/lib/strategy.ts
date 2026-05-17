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
  const v = cookies().get(COOKIE_NAME)?.value;
  return isStrategy(v) ? v : DEFAULT_STRATEGY;
}

export const STRATEGY_LABEL: Record<StrategyName, string> = {
  avalanche: 'Avalanche',
  hybrid: 'Hybrid',
  snowball: 'Snowball',
};

/** One-liner shown next to the active strategy chip. */
export const STRATEGY_SHORT: Record<StrategyName, string> = {
  avalanche: 'Highest effective APR first — fastest payoff.',
  hybrid: 'Small balances first, then highest APR — a quick win, then math.',
  snowball: 'Smallest balance first — pure psychological momentum.',
};

/** Long-form description shown in the picker. */
export const STRATEGY_DESCRIPTION: Record<StrategyName, string> = {
  avalanche:
    'Pay every minimum, throw all surplus at the loan with the highest effective APR. Mathematically the fastest payoff and the lowest total interest. Best when you want the most efficient outcome and can stick with it.',
  hybrid:
    'Clear any loan under ₹50,000 (₹/IN) or $1,000 (US) first to bank a quick win, then switch to avalanche order. Costs a little more interest than pure avalanche, but you get one or two cleared accounts early to keep motivation up.',
  snowball:
    'Pay the smallest balance first regardless of APR. Slowest payoff and highest total interest, but the psychological hit of clearing accounts in sequence keeps some people on the plan.',
};
