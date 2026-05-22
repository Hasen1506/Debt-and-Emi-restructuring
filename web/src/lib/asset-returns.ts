/**
 * Per-asset projected appreciation — frontend mirror of engine's
 * `lookup_asset_return` + `project_future_value`. Used by the goal
 * achievability tier-3 computation so the liquidatable corpus reflects
 * what assets will be worth at the goal's target month, not just today.
 *
 * Defaults intentionally match `engine/country_data.py` —
 * ASSET_DEFAULT_RETURNS_IN / ASSET_DEFAULT_RETURNS_US tables. Keep in
 * sync when those change. We don't centralise via an API fetch because
 * the goal card is client-only and we want the calc to be instant.
 */

import type { AssetPayload, AssetType, Country } from './api';

const ASSET_DEFAULT_RETURNS_IN: Partial<Record<AssetType, number>> = {
  savings_balance: 0.035,
  fixed_deposit: 0.07,
  equity_stocks: 0.12,
  equity_mf: 0.11,
  debt_mf: 0.07,
  gold_physical: 0.08,
  sgb: 0.08,
  real_estate: 0.07,
  ppf: 0.071,
  epf: 0.0825,
  nps: 0.09,
  other: 0.06,
};

const ASSET_DEFAULT_RETURNS_US: Partial<Record<AssetType, number>> = {
  savings_balance: 0.04,
  fixed_deposit: 0.045,
  equity_stocks: 0.10,
  equity_mf: 0.09,
  debt_mf: 0.05,
  gold_physical: 0.07,
  real_estate: 0.06,
  ppf: 0,
  epf: 0,
  nps: 0,
  sgb: 0,
  other: 0.05,
};

export function defaultAssetCagr(
  assetType: AssetType | string,
  country: Country,
): number {
  const table =
    country === 'IN' ? ASSET_DEFAULT_RETURNS_IN : ASSET_DEFAULT_RETURNS_US;
  return table[assetType as AssetType] ?? 0.06;
}

/**
 * Compound a single asset's market value forward by `monthsForward` at
 * the user's per-asset CAGR (when set) or the country/asset-type
 * default. monthsForward=0 → returns current value unchanged.
 */
export function projectAssetValue(
  asset: AssetPayload,
  country: Country,
  monthsForward: number,
): number {
  const current = Number(asset.current_market_value || '0');
  if (monthsForward <= 0 || current === 0) return current;
  const cagr =
    asset.appreciation_cagr != null && asset.appreciation_cagr !== ''
      ? Number(asset.appreciation_cagr)
      : defaultAssetCagr(asset.asset_type, country);
  if (!Number.isFinite(cagr) || cagr === 0) return current;
  const monthly = cagr / 12;
  return current * Math.pow(1 + monthly, monthsForward);
}

/**
 * Sum of all liquid (user-marks-liquid !== false) assets, each compounded
 * to the target month. Used by the goal-card to compute T3's liquidation
 * ceiling — what the portfolio will be worth when the goal comes due,
 * not just today.
 */
export function projectedLiquidatableValue(
  assets: AssetPayload[] | undefined,
  country: Country,
  monthsForward: number,
): number {
  return (assets ?? [])
    .filter((a) => a.user_marks_liquid !== false)
    .reduce((s, a) => s + projectAssetValue(a, country, monthsForward), 0);
}
