/**
 * The user's own payoff rules (roadmap PR E; replaces Hybrid).
 *
 * Mirrors engine/ordering.py `PayoffRules` + `apply_rules`:
 *  - `custom_order`: the full order the user set (loan positions in
 *    user.loans); loans it leaves out follow by the marginal cost of the
 *    next payment (lib/marginal-cost), highest first.
 *    When set, the other rules are off.
 *  - `pinned`: loans moved to the front, in this order.
 *  - `small_first_below`: clear any loan under this balance (user's
 *    currency) first, smallest first. null = off.
 * Everything the rules don't place goes by the marginal cost of the next payment.
 *
 * Stored in a cookie (first paint) and synced as the `payoff_rules` slice,
 * like the strategy itself. A user who had Hybrid is migrated to the rule
 * "clear loans under ₹50,000 / $1,000 first", which is exactly Hybrid.
 */
import type { Country } from './api';

export interface PayoffRules {
  small_first_below: string | null;
  pinned: number[];
  custom_order: number[];
}

export const RULES_COOKIE = 'finoptima_payoff_rules';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** engine/ordering.py HYBRID_SMALL_BALANCE_IN / _US. */
export const HYBRID_SMALL: Record<string, number> = { IN: 50000, US: 1000 };

/** The rule a Hybrid user is migrated to (and the default for "Your rules"). */
export function hybridRules(country: Country | string): PayoffRules {
  return { small_first_below: String(HYBRID_SMALL[country] ?? HYBRID_SMALL.IN), pinned: [], custom_order: [] };
}

const ints = (v: unknown): number[] =>
  Array.isArray(v) ? Array.from(new Set(v.filter((x) => Number.isInteger(x) && x >= 0 && x < 50))) : [];

/** Parse what's stored; anything unreadable is null (the caller defaults). */
export function parseRules(raw: unknown): PayoffRules | null {
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const s = o.small_first_below;
  const small = s == null || s === '' ? null : Number(s) > 0 && Number.isFinite(Number(s)) ? String(s) : null;
  return { small_first_below: small, pinned: ints(o.pinned), custom_order: ints(o.custom_order) };
}

/** Rules for the engine: the saved ones, or Hybrid's rule when none are saved. */
export function rulesOrDefault(rules: PayoffRules | null, country: Country | string): PayoffRules {
  return rules ?? hybridRules(country);
}

/** Drop positions that no longer name a loan (a loan was deleted). */
export function rulesForLoans(rules: PayoffRules, loanCount: number): PayoffRules {
  const keep = (xs: number[]) => xs.filter((i) => i < loanCount);
  return { ...rules, pinned: keep(rules.pinned), custom_order: keep(rules.custom_order) };
}

/**
 * Order loan positions `idx` by the rules (engine/ordering.apply_rules).
 * `rate(i)` is the effective rate, `bal(i)` the balance in the user's currency.
 */
export function applyRules(idx: number[], rules: PayoffRules, rate: (i: number) => number, bal: (i: number) => number): number[] {
  const open = new Set(idx);
  const byRate = (xs: number[]) => [...xs].sort((a, b) => rate(b) - rate(a));
  if (rules.custom_order.length > 0) {
    const front = Array.from(new Set(rules.custom_order)).filter((i) => open.has(i));
    return [...front, ...byRate(idx.filter((i) => !front.includes(i)))];
  }
  const front = Array.from(new Set(rules.pinned)).filter((i) => open.has(i));
  let rest = idx.filter((i) => !front.includes(i));
  const below = rules.small_first_below != null ? Number(rules.small_first_below) : 0;
  if (below > 0) {
    const small = rest.filter((i) => bal(i) < below).sort((a, b) => bal(a) - bal(b));
    rest = rest.filter((i) => !small.includes(i));
    front.push(...small);
  }
  return [...front, ...byRate(rest)];
}

/** One line describing the rules, for the switcher and the masthead. */
export function describeRules(rules: PayoffRules, money: (n: number) => string, loanName: (i: number) => string): string {
  if (rules.custom_order.length > 0) return `Your order: ${rules.custom_order.map(loanName).join(', ')}; the rest by highest rate.`;
  const parts: string[] = [];
  if (rules.pinned.length > 0) parts.push(`${rules.pinned.map(loanName).join(', ')} first`);
  if (rules.small_first_below != null && Number(rules.small_first_below) > 0) parts.push(`loans under ${money(Number(rules.small_first_below))} cleared first, smallest first`);
  parts.push(parts.length ? 'then the highest rate' : 'Highest rate first (no rules set)');
  const s = parts.join('; ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

// ─── Storage ────────────────────────────────────────────────────────────────

export function readRulesClient(): PayoffRules | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${RULES_COOKIE}=([^;]*)`));
  return m ? parseRules(decodeURIComponent(m[1])) : null;
}

export function writeRulesClient(rules: PayoffRules) {
  if (typeof document === 'undefined') return;
  const v = JSON.stringify(rules);
  document.cookie = `${RULES_COOKIE}=${encodeURIComponent(v)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  void import('./server-sync').then(({ syncSliceToServer }) => syncSliceToServer('payoff_rules', rules));
}

export async function loadRulesServer(): Promise<PayoffRules | null> {
  const { cookies } = await import('next/headers');
  const v = (await cookies()).get(RULES_COOKIE)?.value;
  return v ? parseRules(decodeURIComponent(v)) : null;
}
