/**
 * Live re-test 8 (14 Oct 2026) helpers, pure so web/tests can check them.
 *  - R8-6: bounds on a person's own assumptions (pay rise, tax rate, fees,
 *    inflation), the same as api/schemas.py, and a clamp so a profile saved
 *    before the bounds still gives a plan.
 *  - R8-7: whole-month fields (lock-in, part-payment gap).
 *  - R8-9: asset amounts (non-negative, readable).
 *  - R8-4: what a country's asset pickers and hints offer.
 */
import { parseAmountText, type AmountCurrency } from './amount';
import { creditScoreError } from './r7-inputs';

/** Bounds in percent; the API holds the same as fractions of 1. */
export const ASSUMPTION_BOUNDS = {
  payRise: { min: -50, max: 50, what: 'A yearly pay rise' },
  businessGrowth: { min: -50, max: 50, what: 'Business growth' },
  tax: { min: 0, max: 60, what: 'A tax rate' },
  fee: { min: 0, max: 10, what: 'A fee' },
  inflation: { min: -10, max: 50, what: 'Inflation' },
  rateDrift: { min: -20, max: 20, what: 'A rate change' },
} as const;

export type AssumptionKind = keyof typeof ASSUMPTION_BOUNDS;

/** Error for a percent Field's value (a fraction string, '' when blank or
 *  unreadable). Null when blank or inside the bounds. */
export function assumptionError(kind: AssumptionKind, fraction: string | null | undefined): string | null {
  const t = (fraction ?? '').trim();
  if (t === '') return null;
  const n = Number(t) * 100;
  const { min, max, what } = ASSUMPTION_BOUNDS[kind];
  if (!Number.isFinite(n)) return `${what} must be a number between ${min}% and ${max}%.`;
  if (n < min) return min === 0 ? `${what} can’t be negative.` : `${what} can’t be below ${min}%.`;
  if (n > max) return `${what} above ${max}% isn’t accepted. Type it as a percent, like 8.`;
  return null;
}

function clampFraction(v: unknown, kind: AssumptionKind): string | undefined {
  if (v === undefined || v === null || v === '') return v as undefined;
  const n = Number(v);
  const { min, max } = ASSUMPTION_BOUNDS[kind];
  if (!Number.isFinite(n)) return '0';
  if (n * 100 < min) return String(min / 100);
  if (n * 100 > max) return String(max / 100);
  return String(v);
}

/**
 * R8-6: a stored profile with assumptions outside the bounds (saved before
 * they existed) is brought inside them before any page uses it, so /plan
 * never sends the engine a value it refuses and never shows a blank
 * "paying this month". Values inside the bounds are returned untouched.
 */
export function clampAssumptions<U extends Record<string, unknown>>(user: U): U {
  if (!user || typeof user !== 'object') return user;
  const out: Record<string, unknown> = { ...user };
  if ('annual_hike_rate' in out) out.annual_hike_rate = clampFraction(out.annual_hike_rate, 'payRise');
  if ('business_cagr' in out) out.business_cagr = clampFraction(out.business_cagr, 'businessGrowth');
  if ('inflation_rate' in out) out.inflation_rate = clampFraction(out.inflation_rate, 'inflation');
  if ('state_marginal_rate' in out) out.state_marginal_rate = clampFraction(out.state_marginal_rate, 'tax');
  if (Array.isArray(out.hike_schedule)) {
    out.hike_schedule = (out.hike_schedule as unknown[]).map((ph) =>
      Array.isArray(ph) && ph.length === 3 ? [ph[0], ph[1], clampFraction(ph[2], 'payRise')] : ph,
    );
  }
  if (out.credit_score !== undefined && out.credit_score !== null) {
    if (creditScoreError(String(out.credit_score), 'IN') !== null) delete out.credit_score;
  }
  if (Array.isArray(out.loans)) {
    out.loans = (out.loans as Array<Record<string, unknown>>).map((l) => {
      if (!l || typeof l !== 'object') return l;
      const nl: Record<string, unknown> = { ...l };
      for (const f of ['prepayment_penalty_pct', 'processing_fee_amortised', 'insurance_premium_pct']) {
        if (f in nl) nl[f] = clampFraction(nl[f], 'fee');
      }
      return nl;
    });
  }
  return out as U;
}

/** R8-6: a marginal tax rate (fraction text) kept inside 0–60%. */
export function clampTaxRate(rate: string): string {
  return clampFraction(rate, 'tax') ?? rate;
}

/** R8-7: a whole number of months in a range; blank is fine. */
export function wholeMonthsError(raw: string, { min, max }: { min: number; max: number }): string | null {
  const t = (raw ?? '').trim();
  if (t === '') return null;
  const say = `Enter a whole number of months from ${min} to ${max}.`;
  if (!/^\d+$/.test(t)) return say;
  const n = Number(t);
  if (n < min || n > max) return say;
  return null;
}

/** R8-7: the number to store, or undefined while the text isn't valid. */
export function wholeMonthsValue(raw: string, range: { min: number; max: number }): number | undefined {
  const t = (raw ?? '').trim();
  if (t === '' || wholeMonthsError(t, range)) return undefined;
  return Number(t);
}

export const LOCK_IN_RANGE = { min: 0, max: 360 } as const;
export const PART_PAY_FREQ_RANGE = { min: 1, max: 120 } as const;

/** R8-9: an asset amount (market value, purchase price). Blank is the
 *  caller's call (`required`); otherwise a readable amount, not negative. */
export function assetAmountError(raw: string, currency: AmountCurrency, required = false): string | null {
  const t = (raw ?? '').trim();
  if (t === '') return required ? 'Enter what it’s worth today.' : null;
  if (/^-/.test(t)) return 'An amount can’t be negative.';
  const p = parseAmountText(t, currency);
  if (p.value === null) {
    const eg = currency === 'INR' ? '5,00,000 or 5L' : '50,000 or 50k';
    return p.error ?? `Type a number, like ${eg}.`;
  }
  if (Number(p.value) < 0) return 'An amount can’t be negative.';
  return null;
}

/** R8-4: asset kinds that are Indian products. */
export const INDIA_ONLY_ASSET_TYPES: readonly string[] = ['gold_physical', 'gold_etf', 'sgb', 'ppf', 'epf', 'nps'];

/** R8-4: the asset kinds to offer in this country; a kind already chosen
 *  stays so a saved asset never loses its label. */
export function assetKindsFor<T extends string, X>(
  kinds: ReadonlyArray<readonly [T, X]>,
  country: string,
  current?: string,
): Array<readonly [T, X]> {
  if (country !== 'US') return [...kinds];
  return kinds.filter(([t]) => !INDIA_ONLY_ASSET_TYPES.includes(t) || t === current);
}

/** R8-4: Portfolio's empty-state list of what to add. */
export function portfolioHint(country: string): string {
  return country === 'US'
    ? 'Add what you own at its value (savings, funds, 401(k)/IRA, property)'
    : 'Add what you own at its value (FDs, funds, gold, property, PF)';
}

/** R8-9: the asset fields these checks read. */
export type AssetRowLike = { label?: string | null; current_market_value?: string | null; purchase_price?: string | null; purchase_date?: string | null };

/** R8-9: a row the person started filling in (an untouched blank row is
 *  just dropped). */
export function rowStarted(a: AssetRowLike): boolean {
  return [a.label, a.current_market_value, a.purchase_price, a.purchase_date].some((v) => (v ?? '').toString().trim() !== '');
}

/** R8-9: the market value's error: readable, not negative, above 0 once
 *  the row is started. */
export function marketValueError(a: AssetRowLike, ccy: 'INR' | 'USD', tried: boolean): string | null {
  const raw = (a.current_market_value ?? '').trim();
  const live = assetAmountError(raw, ccy);
  if (live) return live;
  if (!tried || !rowStarted(a)) return null;
  if (raw === '') return 'Enter what it’s worth today, or remove this row.';
  if (Number(parseAmountText(raw, ccy).value) <= 0) return 'Enter what it’s worth today (more than 0), or remove this row.';
  return null;
}
