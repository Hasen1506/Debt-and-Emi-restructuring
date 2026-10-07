/**
 * Holdings tracker helpers — ticker normalization, quote fetching, and
 * asset upserts. The /portfolio HoldingsTracker component is the only
 * consumer. The Yahoo Finance call is proxied through our /api/holdings/quote
 * route to dodge CORS.
 */
import Decimal from 'decimal.js';
import type { AssetPayload, Country } from './api';
import { localIsoDate } from './today';

export interface QuoteResult {
  ticker: string;
  price: number;
  currency: string;
  name: string;
  exchange: string | null;
  ts: string;
}

/**
 * Normalize a user-typed ticker for Yahoo Finance.
 *
 *   India: NSE primary listing → suffix `.NS` when the user typed a bare
 *     symbol AND country is IN. We don't try to guess between NSE / BSE —
 *     NSE has wider coverage. Users wanting BSE can type the full `.BO`.
 *
 *   US: no suffix; uppercase only.
 *
 * Accepts already-suffixed tickers untouched, so "RELIANCE.NS" → "RELIANCE.NS".
 */
export function normalizeTicker(raw: string, country: Country): string {
  const cleaned = raw.trim().toUpperCase();
  if (!cleaned) return cleaned;
  if (cleaned.includes('.')) return cleaned;
  if (country === 'IN') return `${cleaned}.NS`;
  return cleaned;
}

export async function fetchQuote(ticker: string): Promise<QuoteResult> {
  const res = await fetch(
    `/api/holdings/quote?ticker=${encodeURIComponent(ticker)}`,
    { cache: 'no-store' },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'unknown' }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return (await res.json()) as QuoteResult;
}

/**
 * Compose an AssetPayload from a holding entry. Used by the tracker when
 * adding a new holding or after a price refresh.
 *
 * current_market_value = quantity × last_price, in the profile's currency:
 * a quote in another currency is converted at `fx` and keeps its own
 * currency and the rate beside it. It used to be counted 1:1, so ten INR 100
 * shares showed as $1,000 in a US portfolio.
 */
export interface HoldingInput {
  ticker: string;
  quantity: string;
  /** Optional — user-stated average cost per share, in the quote's
   *  currency. Stored as purchase_price. */
  avgCost?: string;
  /** Optional — defaults to today. */
  purchaseDate?: string;
  /** equity_stocks for individual stocks, equity_mf for mutual funds / ETFs. */
  assetType?: 'equity_stocks' | 'equity_mf';
  label?: string;
}

/** A rate into the profile's currency for a quote in another one. */
export interface HoldingFx {
  /** Profile-currency units per 1 quote-currency unit. */
  rate: string;
  /** The rate's date (YYYY-MM-DD). */
  asOf: string;
  /** Today's quote, or the rate saved in the profile. */
  source: 'live' | 'saved';
}

/** A quote in major units: Yahoo quotes London in pence (GBp) and
 *  Johannesburg in cents (ZAc), a hundredth of the currency. */
export function majorUnits(quote: QuoteResult): { price: Decimal; currency: string } {
  const minor: Record<string, string> = { GBp: 'GBP', GBX: 'GBP', ZAc: 'ZAR', ILA: 'ILS' };
  const code = minor[quote.currency];
  if (code) return { price: new Decimal(quote.price).div(100), currency: code };
  return { price: new Decimal(quote.price), currency: quote.currency.toUpperCase() };
}

/** Why a quantity can't be a holding, or null when it can. */
export function quantityError(raw: string): string | null {
  const v = raw.trim();
  if (!v) return 'Enter how many shares or units you own.';
  if (!/^\d*\.?\d+$/.test(v) || !(Number(v) > 0)) {
    return 'Enter a quantity above zero: this lists what you own (short positions aren’t tracked).';
  }
  return null;
}

export function holdingToAsset(
  input: HoldingInput,
  quote: QuoteResult,
  userCurrency: string,
  fx?: HoldingFx | null,
): AssetPayload {
  const qty = new Decimal(input.quantity || '0');
  const { price, currency } = majorUnits(quote);
  const foreign = currency !== userCurrency;
  if (foreign && !fx) throw new Error(`${input.ticker} is priced in ${currency}: a ${currency}→${userCurrency} rate is needed`);
  const toUser = foreign ? new Decimal(fx!.rate) : new Decimal(1);
  const value = qty.mul(price).mul(toUser);
  const purchasePrice = input.avgCost
    ? new Decimal(input.avgCost).mul(qty).mul(toUser)
    : value;
  return {
    asset_type: input.assetType ?? 'equity_stocks',
    purchase_price: purchasePrice.toFixed(2),
    purchase_date:
      input.purchaseDate ?? localIsoDate(new Date()),
    current_market_value: value.toFixed(2),
    label: input.label || quote.name,
    ticker: input.ticker,
    quantity: qty.toString(),
    last_price: price.toFixed(4),
    last_price_at: quote.ts,
    ...(foreign ? { price_currency: currency, fx_to_user: fx!.rate, fx_as_of: fx!.asOf } : {}),
    user_marks_liquid: true,
  };
}

/**
 * Refresh an existing holding's market value from a fresh quote. Preserves
 * the original purchase_price / purchase_date — those reflect the entry
 * event, not the latest valuation. A foreign quote needs `fx`.
 */
export function refreshAssetWithQuote(
  asset: AssetPayload,
  quote: QuoteResult,
  userCurrency: string,
  fx?: HoldingFx | null,
): AssetPayload {
  const qty = new Decimal(asset.quantity || '0');
  const { price, currency } = majorUnits(quote);
  const foreign = currency !== userCurrency;
  if (foreign && !fx) throw new Error(`${asset.ticker} is priced in ${currency}: a ${currency}→${userCurrency} rate is needed`);
  const value = qty.mul(price).mul(foreign ? new Decimal(fx!.rate) : 1);
  const { price_currency: _pc, fx_to_user: _fx, fx_as_of: _at, ...rest } = asset;
  void _pc; void _fx; void _at;
  return {
    ...rest,
    current_market_value: value.toFixed(2),
    last_price: price.toFixed(4),
    last_price_at: quote.ts,
    ...(foreign ? { price_currency: currency, fx_to_user: fx!.rate, fx_as_of: fx!.asOf } : {}),
  };
}

/**
 * The rate into the profile's currency for a quote, or null when it's in
 * the profile's own. Today's rate from the API, else the rate saved in the
 * profile for that currency. Throws when there's neither: the holding
 * can't be valued, so it isn't added.
 */
export async function fxForQuote(
  quote: QuoteResult,
  userCurrency: string,
  saved: Record<string, string> | undefined,
  lookup: (base: string, quote: string) => Promise<{ rate: string; as_of: string | null }>,
): Promise<HoldingFx | null> {
  const { currency } = majorUnits(quote);
  if (currency === userCurrency) return null;
  try {
    const r = await lookup(currency, userCurrency);
    if (Number(r.rate) > 0) {
      return { rate: r.rate, asOf: r.as_of ?? localIsoDate(new Date()), source: 'live' };
    }
  } catch {
    // fall through to a saved rate
  }
  const kept = saved?.[currency];
  if (kept && Number(kept) > 0) {
    return { rate: kept, asOf: localIsoDate(new Date()), source: 'saved' };
  }
  throw new Error(
    `it's priced in ${currency}, your portfolio is in ${userCurrency}, and today's ${currency}→${userCurrency} rate couldn't be fetched`,
  );
}

/** Filter the assets list down to ticker-backed holdings. */
export function tickerHoldings(assets: AssetPayload[] | undefined): AssetPayload[] {
  return (assets ?? []).filter(
    (a) => !!a.ticker && (a.asset_type === 'equity_stocks' || a.asset_type === 'equity_mf'),
  );
}
