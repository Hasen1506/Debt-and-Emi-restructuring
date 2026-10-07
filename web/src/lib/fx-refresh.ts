/**
 * Keeping exchange rates current (roadmap PR B, audit 2026-10-07 §11).
 *
 * The rate was fetched once, when a foreign loan was added, and never again:
 * a ₹ loan on a $ profile kept its first day's rate for good, with no date on
 * it. Now every rate carries {as_of, fetched_at, source}; one older than 24 h
 * is refreshed when the app opens (and checked again while it stays open);
 * the user can refresh by hand; a rate the user typed is left alone until
 * they do. A failed fetch keeps the last rate and says so. Nothing here ever
 * writes a rate of 1 or below 0 — a loan with no rate stays a gap, which
 * blocks the plan and asks for a rate (the engine refuses parity too).
 */
import type { FxMeta, UserPayload } from './api';
import { loanCurrency, userDefaultCurrency } from './currency';

export const FX_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Older than this, the rate line turns into a warning. */
export const FX_STALE_WARN_MS = 7 * FX_MAX_AGE_MS;

type FxUser = Pick<UserPayload, 'country' | 'loans' | 'fx_to_user_currency' | 'fx_meta'>;
export type FxLookup = (base: string, quote: string) => Promise<{ rate: string; source?: string; as_of?: string | null }>;

/** Foreign currencies with a loan still owing. */
export function foreignCurrencies(user: FxUser): string[] {
  const own = userDefaultCurrency(user.country);
  return Array.from(new Set(user.loans.map((l) => loanCurrency(l, user.country)).filter((c) => c !== own)));
}

const validRate = (r: unknown) => {
  const n = Number(r);
  return Number.isFinite(n) && n > 0;
};

/** Currencies whose rate is missing, or fetched more than 24 h ago (typed rates excepted). */
export function fxDueForRefresh(user: FxUser, nowMs: number): string[] {
  return foreignCurrencies(user).filter((c) => {
    if (!validRate(user.fx_to_user_currency?.[c])) return true;
    const meta = user.fx_meta?.[c];
    if (meta?.manual) return false;
    const at = meta ? Date.parse(meta.fetched_at) : NaN;
    return !Number.isFinite(at) || nowMs - at >= FX_MAX_AGE_MS;
  });
}

export interface FxRefreshResult<U> {
  user: U;
  refreshed: string[];
  failed: string[];
}

/**
 * Fetch today's rate for `currencies` (default: the ones due). A rate the
 * provider can't give keeps the old one (and its date); a parity or fallback
 * answer for two different currencies is refused, never stored.
 */
export async function refreshFxRates<U extends FxUser>(
  user: U,
  lookup: FxLookup,
  nowMs: number,
  currencies: string[] = fxDueForRefresh(user, nowMs),
): Promise<FxRefreshResult<U>> {
  const own = userDefaultCurrency(user.country);
  const rates = { ...(user.fx_to_user_currency ?? {}) };
  const meta: Record<string, FxMeta> = { ...(user.fx_meta ?? {}) };
  const refreshed: string[] = [];
  const failed: string[] = [];
  await Promise.all(
    currencies.map(async (c) => {
      if (c === own) return;
      try {
        const r = await lookup(c, own);
        if (!validRate(r.rate) || r.source === 'parity' || r.source === 'fallback' || Number(r.rate) === 1) throw new Error('no usable rate');
        rates[c] = String(r.rate);
        meta[c] = { as_of: r.as_of ?? null, fetched_at: new Date(nowMs).toISOString(), source: r.source ?? 'live' };
        refreshed.push(c);
      } catch {
        failed.push(c);
      }
    }),
  );
  if (refreshed.length === 0) return { user, refreshed, failed };
  return { user: { ...user, fx_to_user_currency: rates, fx_meta: meta }, refreshed, failed };
}

/**
 * Profile's save: date each foreign rate. Unchanged from the saved profile:
 * keeps its date. Equal to the quote Profile just fetched: dated by the
 * provider. Anything else was typed: dated today and marked manual.
 */
export function dateProfileRates<U extends FxUser>(
  user: U,
  prev: FxUser | null,
  quotes: Record<string, { rate: string; source?: string; as_of?: string | null } | undefined>,
  nowMs: number,
): U {
  const meta: Record<string, FxMeta> = {};
  const at = new Date(nowMs).toISOString();
  for (const c of foreignCurrencies(user)) {
    const rate = user.fx_to_user_currency?.[c];
    if (!validRate(rate)) continue;
    const prevMeta = prev?.fx_meta?.[c];
    const q = quotes[c];
    if (prevMeta && String(prev?.fx_to_user_currency?.[c]) === String(rate)) meta[c] = prevMeta;
    else if (q && Number(q.rate) === Number(rate)) meta[c] = { as_of: q.as_of ?? null, fetched_at: at, source: q.source ?? 'live' };
    else meta[c] = { as_of: at.slice(0, 10), fetched_at: at, source: 'manual', manual: true };
  }
  return { ...user, fx_meta: meta };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const SOURCE: Record<string, string> = { frankfurter: 'ECB via Frankfurter', 'open-er-api': 'open.er-api.com', manual: 'entered by you' };

/** "as of 6 Oct 2026 · ECB via Frankfurter", or "date unknown" for a rate saved before dates were kept. */
export function fxAsOfLabel(meta: FxMeta | undefined): string {
  if (!meta) return 'date unknown, saved before rates were dated';
  const when = meta.as_of ?? meta.fetched_at;
  return `as of ${day(when)} · ${SOURCE[meta.source] ?? meta.source}`;
}

/** Older than a week (or undated): say so beside the rate. */
export function fxIsStale(meta: FxMeta | undefined, nowMs: number): boolean {
  if (!meta) return true;
  const at = Date.parse(meta.fetched_at);
  return !Number.isFinite(at) || nowMs - at >= FX_STALE_WARN_MS;
}

/** Every foreign rate present and under 24 h old (typed rates kept): what app open runs. */
export function ensureFxRates<U extends FxUser>(user: U, lookup: FxLookup, nowMs: number): Promise<FxRefreshResult<U>> {
  return refreshFxRates(user, lookup, nowMs, fxDueForRefresh(user, nowMs));
}
