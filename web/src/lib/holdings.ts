/**
 * Holdings tracker helpers — ticker normalization, quote fetching, and
 * asset upserts. The /portfolio HoldingsTracker component is the only
 * consumer. The Yahoo Finance call is proxied through our /api/holdings/quote
 * route to dodge CORS.
 */
import Decimal from 'decimal.js';
import type { AssetPayload, Country } from './api';

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
 * current_market_value = quantity × last_price, kept as a string to match
 * the AssetPayload contract (decimals over the wire).
 */
export interface HoldingInput {
  ticker: string;
  quantity: string;
  /** Optional — user-stated average cost per share. Stored as purchase_price. */
  avgCost?: string;
  /** Optional — defaults to today. */
  purchaseDate?: string;
  /** equity_stocks for individual stocks, equity_mf for mutual funds / ETFs. */
  assetType?: 'equity_stocks' | 'equity_mf';
  label?: string;
}

export function holdingToAsset(
  input: HoldingInput,
  quote: QuoteResult,
): AssetPayload {
  const qty = new Decimal(input.quantity || '0');
  const price = new Decimal(quote.price);
  const value = qty.mul(price);
  const purchasePrice = input.avgCost
    ? new Decimal(input.avgCost).mul(qty)
    : value;
  return {
    asset_type: input.assetType ?? 'equity_stocks',
    purchase_price: purchasePrice.toFixed(2),
    purchase_date:
      input.purchaseDate ?? new Date().toISOString().slice(0, 10),
    current_market_value: value.toFixed(2),
    label: input.label || quote.name,
    ticker: input.ticker,
    quantity: qty.toString(),
    last_price: price.toFixed(4),
    last_price_at: quote.ts,
    user_marks_liquid: true,
  };
}

/**
 * Refresh an existing holding's market value from a fresh quote. Preserves
 * the original purchase_price / purchase_date — those reflect the entry
 * event, not the latest valuation.
 */
export function refreshAssetWithQuote(
  asset: AssetPayload,
  quote: QuoteResult,
): AssetPayload {
  const qty = new Decimal(asset.quantity || '0');
  const price = new Decimal(quote.price);
  const value = qty.mul(price);
  return {
    ...asset,
    current_market_value: value.toFixed(2),
    last_price: price.toFixed(4),
    last_price_at: quote.ts,
  };
}

/** Filter the assets list down to ticker-backed holdings. */
export function tickerHoldings(assets: AssetPayload[] | undefined): AssetPayload[] {
  return (assets ?? []).filter(
    (a) => !!a.ticker && (a.asset_type === 'equity_stocks' || a.asset_type === 'equity_mf'),
  );
}
