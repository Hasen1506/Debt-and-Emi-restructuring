/**
 * Per-plan toggle: auto-reinvest projected annual tax savings into the
 * highest-effective-APR debt every year through the simulation horizon?
 *
 * Mirrors `hike-modeling.ts` — cookie-backed so the Plan server component
 * can render the right trajectory on first byte without a roundtrip.
 *
 * When ON, the Plan page pre-computes per-year tax savings via
 * `projectAnnualTaxSavings()` (uses user marginal_rate + regime + per-loan
 * deductible-interest projection) and posts the resulting month/amount
 * events to /api/simulate as `reinvest_events`. The engine routes each
 * event to the highest-effective-APR active loan at the matching month.
 *
 * Default OFF because:
 *   • Under India's new tax regime (default for most users from FY24+),
 *     most loan-interest deductions are not available — toggle-on would
 *     project zero saving, surfacing a feature with no effect.
 *   • US users typically don't itemise (standard deduction usually wins),
 *     so even Schedule A mortgage interest isn't "real" cash back for many.
 *
 * Users on old regime (India) or itemising filers (US) flip it on
 * explicitly when they want the reinvest applied.
 */

export type TaxReinvestSetting = 'on' | 'off';

export const DEFAULT_TAX_REINVEST: TaxReinvestSetting = 'off';
const COOKIE_NAME = 'rightdue_tax_reinvest';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function isTaxReinvest(v: string | null | undefined): v is TaxReinvestSetting {
  return v === 'on' || v === 'off';
}

export function writeTaxReinvestClient(value: TaxReinvestSetting) {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  void import('./server-sync').then(({ syncSliceToServer }) =>
    syncSliceToServer('tax_reinvest', value),
  );
}

// ─── Server-side ────────────────────────────────────────────────────────────

export async function loadTaxReinvestServer(): Promise<TaxReinvestSetting> {
  const { cookies } = await import('next/headers');
  const v = (await cookies()).get(COOKIE_NAME)?.value;
  return isTaxReinvest(v) ? v : DEFAULT_TAX_REINVEST;
}
