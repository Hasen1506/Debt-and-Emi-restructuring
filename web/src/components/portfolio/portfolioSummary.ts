/**
 * Pure summarisation of the user's portfolio for the /portfolio landing.
 *
 * The three skin variants (Ledger / Editorial / Existing) all consume the
 * same `PortfolioSummary` so the numbers stay in lockstep across themes.
 */
import type { AssetPayload, AssetType, Country } from '@/lib/api';

export const ASSET_TYPE_LABEL_IN: Record<AssetType, string> = {
  savings_balance: 'Savings / current',
  fixed_deposit: 'Fixed deposit',
  equity_stocks: 'Equity (direct)',
  equity_mf: 'Equity MF',
  debt_mf: 'Debt MF',
  gold_physical: 'Gold',
  gold_etf: 'Gold ETF',
  sgb: 'Sovereign Gold Bond',
  real_estate: 'Real estate',
  ppf: 'PPF',
  epf: 'EPF',
  nps: 'NPS',
  crypto: 'Crypto',
  other: 'Other',
};

export const ASSET_TYPE_LABEL_US: Record<AssetType, string> = {
  savings_balance: 'HYSA / checking',
  fixed_deposit: 'CD',
  equity_stocks: 'Equity (direct)',
  equity_mf: 'Equity MF / ETF',
  debt_mf: 'Bond fund',
  gold_physical: 'Gold',
  gold_etf: 'Gold ETF',
  sgb: 'SGB',
  real_estate: 'Real estate',
  ppf: 'PPF',
  epf: '401(k) / IRA',
  nps: 'NPS',
  crypto: 'Crypto',
  other: 'Other',
};

export function assetTypeLabel(country: Country, type: string): string {
  const table = country === 'IN' ? ASSET_TYPE_LABEL_IN : ASSET_TYPE_LABEL_US;
  return (table as Record<string, string>)[type] ?? type;
}

export interface PortfolioRow {
  label: string;
  assetType: string;
  value: number;
}

export interface PortfolioSummary {
  totalValue: number;
  count: number;
  byType: { assetType: string; total: number; count: number }[];
  topRow: PortfolioRow | null;
  rows: PortfolioRow[];
}

export function summarisePortfolio(
  assets: AssetPayload[] | undefined,
  country: Country,
): PortfolioSummary {
  const rows: PortfolioRow[] = (assets ?? []).map((a) => ({
    label: a.label?.trim() || assetTypeLabel(country, a.asset_type),
    assetType: String(a.asset_type),
    value: Number(a.current_market_value) || 0,
  }));

  const totalValue = rows.reduce((acc, r) => acc + r.value, 0);
  const byTypeMap = new Map<string, { total: number; count: number }>();
  for (const r of rows) {
    const cur = byTypeMap.get(r.assetType) ?? { total: 0, count: 0 };
    byTypeMap.set(r.assetType, {
      total: cur.total + r.value,
      count: cur.count + 1,
    });
  }
  const byType = Array.from(byTypeMap.entries())
    .map(([assetType, v]) => ({ assetType, ...v }))
    .sort((a, b) => b.total - a.total);

  const topRow =
    rows.length > 0
      ? rows.slice().sort((a, b) => b.value - a.value)[0]
      : null;

  return {
    totalValue,
    count: rows.length,
    byType,
    topRow,
    rows: rows.sort((a, b) => b.value - a.value),
  };
}
