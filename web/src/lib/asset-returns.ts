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
import { DEFAULT_ASSET_RETURNS } from './assumptions';

// One web copy of the engine's tables (lib/assumptions, checked against
// engine/country_data.py by tests/roadmap-d-values.cjs). This file's own
// copy had drifted: an Indian FD at 7% here, 6.25% in the engine.
const ASSET_DEFAULT_RETURNS_IN = DEFAULT_ASSET_RETURNS.IN;
const ASSET_DEFAULT_RETURNS_US = DEFAULT_ASSET_RETURNS.US;

export function defaultAssetCagr(
  assetType: AssetType | string,
  country: Country,
  overrides?: Record<string, string>,
): number {
  // The user's own return for this type (Profile → Assumptions, roadmap PR D).
  const own = overrides?.[assetType];
  if (own != null && own !== '' && Number.isFinite(Number(own))) return Number(own);
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
  overrides?: Record<string, string>,
): number {
  const current = Number(asset.current_market_value || '0');
  if (monthsForward <= 0 || current === 0) return current;
  const cagr =
    asset.appreciation_cagr != null && asset.appreciation_cagr !== ''
      ? Number(asset.appreciation_cagr)
      : defaultAssetCagr(asset.asset_type, country, overrides);
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
  overrides?: Record<string, string>,
): number {
  return (assets ?? [])
    .filter((a) => a.user_marks_liquid !== false)
    .reduce((s, a) => s + projectAssetValue(a, country, monthsForward, overrides), 0);
}
