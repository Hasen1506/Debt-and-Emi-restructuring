/**
 * The user's own assumptions (roadmap PR D, audit 2026-10-07 §2).
 *
 * Values the app used to hard-code, each shown with its default and
 * editable on Profile → Assumptions. They live on the saved profile, so
 * every engine call already carries them:
 *   - prepay_hurdle      → engine formulas.prepay_recommended (+0.5pp default)
 *   - asset_returns      → engine country_data.lookup_asset_return, web asset-returns
 *   - liquidation_costs  → engine asset_liquidation (selling cost per type)
 *   - assumptions.ef_months         → emergency-fund target = months × monthly spending
 *   - assumptions.ef_save_amount    → a fixed monthly top-up instead of the Plan slider's %
 *   - assumptions.goal_buffer_pct   → the buffer a new goal starts with
 * Empty = the default; "Reset" clears the user's value.
 */
import type { AssetType, Country, UserPayload } from './api';

/** engine/formulas.py PREPAY_RISK_PREMIUM. */
export const DEFAULT_PREPAY_HURDLE = 0.005;
/** The "Standard" tier on Profile's emergency-fund picker. */
export const DEFAULT_EF_MONTHS = 6;

/** engine/country_data.py ASSET_DEFAULT_RETURNS_IN / _US (kept in sync by tests/roadmap-d-values.cjs). */
export const DEFAULT_ASSET_RETURNS: Record<Country, Partial<Record<AssetType, number>>> = {
  IN: {
    savings_balance: 0.035, fixed_deposit: 0.0625, equity_stocks: 0.12, equity_mf: 0.11, debt_mf: 0.07,
    gold_physical: 0.08, gold_etf: 0.08, sgb: 0.08, real_estate: 0.07, ppf: 0.071, epf: 0.0825, nps: 0.09, other: 0.06,
  },
  US: {
    savings_balance: 0.04, fixed_deposit: 0.045, equity_stocks: 0.10, equity_mf: 0.09, debt_mf: 0.05,
    gold_physical: 0.07, gold_etf: 0.07, real_estate: 0.06, ppf: 0, epf: 0, nps: 0, sgb: 0, other: 0.05,
  },
};

/** engine/asset_liquidation.py selling-cost defaults, by asset type and country. */
export const DEFAULT_LIQUIDATION_COSTS: Record<Country, Partial<Record<AssetType, number>>> = {
  IN: { equity_stocks: 0.002, equity_mf: 0.002, gold_physical: 0.03, gold_etf: 0.001, sgb: 0.005, debt_mf: 0.01 },
  US: { equity_stocks: 0.001, equity_mf: 0.001, debt_mf: 0.001, gold_physical: 0.03 },
};

export const LIQUIDATION_COST_NOTE: Partial<Record<AssetType, string>> = {
  equity_stocks: 'brokerage + STT (India) or slippage (US)',
  equity_mf: 'brokerage + STT (India) or slippage (US)',
  gold_physical: "jeweller's cut / bullion spread",
  sgb: 'exchange sale cost',
  debt_mf: 'exit load if held under a year (India) or slippage (US)',
};

export interface UiAssumptions {
  ef_months?: number | null;
  ef_save_amount?: string | null;
  goal_buffer_pct?: string | null;
  /** Choices the person made themselves at setup (lib/setup-choices,
   *  sprint G10): 'ef_months', 'ef_split', 'strategy'. */
  confirmed?: string[];
  /** When they last made them, 'YYYY-MM-DD'. */
  confirmed_at?: string;
}

type WithAssumptions = Pick<UserPayload, 'country'> & {
  prepay_hurdle?: string | null;
  asset_returns?: Record<string, string>;
  liquidation_costs?: Record<string, string>;
  assumptions?: UiAssumptions;
};

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function assetReturn(u: WithAssumptions, type: AssetType | string): number {
  return num(u.asset_returns?.[type]) ?? DEFAULT_ASSET_RETURNS[u.country]?.[type as AssetType] ?? 0.06;
}

export function efMonths(u: WithAssumptions): number {
  const m = num(u.assumptions?.ef_months);
  return m != null && m >= 1 && m <= 24 ? Math.round(m) : DEFAULT_EF_MONTHS;
}

/** A new goal's buffer: the user's default when set, else the kind's preset. */
export function goalBuffer(u: WithAssumptions | null | undefined, presetBuffer: string): string {
  const b = num(u?.assumptions?.goal_buffer_pct);
  return b != null && b >= 0 && b <= 1 ? String(b) : presetBuffer;
}

/**
 * The share of spare cash that goes to the emergency fund this month:
 * the user's fixed amount as a share of spare cash when they set one
 * (capped at all of it), else the Plan slider's split.
 */
export function efTopUpShare(u: WithAssumptions, sliderSplit: string, surplus: number): string {
  const amt = num(u.assumptions?.ef_save_amount);
  if (amt == null || amt <= 0) return sliderSplit;
  if (!(surplus > 0)) return '1.00';
  return Math.min(1, amt / surplus).toFixed(4);
}

/** Validate one edit: a rate within [lo, hi] as a fraction, or empty (= default). */
export function parseRateInput(pct: string, lo: number, hi: number): { ok: true; value: string | null } | { ok: false; error: string } {
  const t = pct.trim();
  if (t === '') return { ok: true, value: null };
  const n = Number(t);
  if (!Number.isFinite(n)) return { ok: false, error: 'Enter a number, or leave it empty for the default.' };
  const frac = n / 100;
  if (frac < lo || frac > hi) return { ok: false, error: `Between ${lo * 100}% and ${hi * 100}%.` };
  return { ok: true, value: String(Number(frac.toFixed(6))) };
}

/** Drop empty entries so a cleared value goes back to the default. */
export function cleanMap(m: Record<string, string | null | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v != null && v !== '')) as Record<string, string>;
}
