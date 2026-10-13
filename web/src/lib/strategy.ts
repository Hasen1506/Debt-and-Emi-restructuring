/**
 * Payoff strategy preference — global to the user.
 *
 * Three strategies mirror engine/ordering.Strategy:
 *  - avalanche  → where the next payment saves the most first: the marginal
 *                 cost of prepaying (lib/marginal-cost, roadmap PR J); default
 *  - rules      → the user's own rules (lib/payoff-rules), then avalanche.
 *                 Replaces Hybrid (roadmap PR E): a saved 'hybrid' is read
 *                 as 'rules' with Hybrid's rule, and rewritten.
 *  - snowball   → smallest balance first (pure behavioural)
 *
 * Stored in a cookie so the Plan page renders the right schedule on first
 * byte without a roundtrip — same pattern as `theme.ts`.
 */

export type StrategyName = 'avalanche' | 'rules' | 'snowball';

// UX50 B-08: one order everywhere (Setup, Profile, the switcher): cheapest, smallest, yours.
export const STRATEGIES: StrategyName[] = ['avalanche', 'snowball', 'rules'];
export const DEFAULT_STRATEGY: StrategyName = 'avalanche';
const COOKIE_NAME = 'rightdue_strategy';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function isStrategy(v: string | null | undefined): v is StrategyName {
  return v === 'avalanche' || v === 'rules' || v === 'snowball';
}

/** A stored value as a strategy: the retired 'hybrid' is 'rules' (its rule
 *  is the default rule set, lib/payoff-rules hybridRules). */
export function normalizeStrategy(v: string | null | undefined): StrategyName {
  if (v === 'hybrid') return 'rules';
  return isStrategy(v) ? v : DEFAULT_STRATEGY;
}

// ─── Client-side ────────────────────────────────────────────────────────────

export function readStrategyClient(): StrategyName {
  if (typeof document === 'undefined') return DEFAULT_STRATEGY;
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  const v = match ? decodeURIComponent(match[1]) : null;
  // Migrate a Hybrid cookie once: rewrite it (and the synced slice) as 'rules'.
  if (v === 'hybrid') writeStrategyClient('rules');
  return normalizeStrategy(v);
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
  return normalizeStrategy(v);
}

export const STRATEGY_LABEL: Record<StrategyName, string> = {
  avalanche: 'Avalanche',
  rules: 'Your rules',
  snowball: 'Snowball',
};

/** Each strategy's name in plain words, shown beside or under the name
 *  (sprint G10, grill #78; founder: "Avalanche means cheapest path
 *  forward, Snowball smallest first"). */
export const STRATEGY_PLAIN: Record<StrategyName, string> = {
  avalanche: 'Cheapest path',
  rules: 'Your own order',
  snowball: 'Smallest first',
};

/** The name with its plain words: "Avalanche (cheapest path)". */
export function strategyName(s: StrategyName): string {
  return `${STRATEGY_LABEL[s]} (${STRATEGY_PLAIN[s].toLowerCase()})`;
}

/** One line on the order: the personas' rule, then what it costs or buys. */
export const STRATEGY_SHORT: Record<StrategyName, string> = {
  avalanche: 'Cheapest path: extra money goes where it saves the most interest first, usually the highest rate. The least interest overall.',
  rules: 'Your own order: put a loan first, clear small balances first, or set the whole order. The rest follows the cheapest path.',
  snowball: 'Smallest first: extra money clears the smallest balance first. Loans close sooner; it usually costs a little more interest.',
};
