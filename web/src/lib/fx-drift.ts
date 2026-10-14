/**
 * Per-plan toggle: model long-run FX drift for non-residence-currency
 * loans, or treat FX as flat at today's spot for the whole horizon?
 *
 * Only meaningful for hybrid users (NRI-US with INR loans, etc.). For
 * single-currency users the toggle is hidden by the parent component.
 *
 * Default: inflation differential between the loan-currency country and
 * the residence country. For NRI-US (USD residence, INR loans):
 *   India CPI 5.5% − US CPI 3.0% ≈ 2.5%/yr → USD/INR drift +2.5%/yr,
 *   i.e. 1 INR is worth ~2.5% fewer USD each year. Theoretical PPP
 *   anchor; matches market 1Y forward implied drift to within ~0.2pp.
 *
 * Users can override the default by editing the rate on the toggle's
 * detail row. We don't allow per-currency overrides — for the only
 * supported hybrid pair (NRI-US with INR loans) a single drift is enough.
 */

export type FxDriftSetting = 'on' | 'off';

// E5 (audit 80): on by default. An NRI's plan used to hold the rupee at
// today's rate for decades, hiding the one assumption that matters most to
// them; the toggle still turns it off.
export const DEFAULT_FX_DRIFT: FxDriftSetting = 'on';
const COOKIE_NAME = 'rightdue_fx_drift';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function isFxDrift(v: string | null | undefined): v is FxDriftSetting {
  return v === 'on' || v === 'off';
}

// ─── Client-side ────────────────────────────────────────────────────────────

export function readFxDriftClient(): FxDriftSetting {
  if (typeof document === 'undefined') return DEFAULT_FX_DRIFT;
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  const v = match ? decodeURIComponent(match[1]) : null;
  return isFxDrift(v) ? v : DEFAULT_FX_DRIFT;
}

export function writeFxDriftClient(value: FxDriftSetting) {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  void import('./server-sync').then(({ syncSliceToServer }) =>
    syncSliceToServer('fx_drift', value),
  );
}

// ─── Server-side ────────────────────────────────────────────────────────────

export async function loadFxDriftServer(): Promise<FxDriftSetting> {
  const { cookies } = await import('next/headers');
  const v = (await cookies()).get(COOKIE_NAME)?.value;
  return isFxDrift(v) ? v : DEFAULT_FX_DRIFT;
}

/**
 * Default drift rate per (residence, loan-currency) pair. Keyed by
 * loan-currency since the engine indexes drift by the same key as
 * fx_to_user_currency. Only the single supported hybrid pair is
 * configured today; other pairs fall through to 0.
 *
 * Source: the gap between India's and the US's inflation. The forecasts
 *   in `INFLATION_FORECAST` (RBI 5.0% for 2026-27, the Fed 2.3% for 2027)
 *   put it at 2.7 points next year; 2.5 is kept as the longer-run gap.
 *   Refresh with `INFLATION_FORECAST`.
 */
export const FX_DRIFT_DEFAULTS_AS_OF = '2026-10-12';
/** Twin of engine/cross_border.py INR_SLIDE_A_YEAR["USD"], as the engine's sign. */
export const INR_SLIDE_VS_USD = '-0.035';
export const INR_SLIDE_LABEL = 'INR −3.5%/yr (20-yr average)';

export function defaultDriftForLoanCurrency(
  loanCurrency: string,
  residenceCountry: 'IN' | 'US',
): string {
  // Engine convention: drift applies to `fx_to_user_currency[loan_ccy]`,
  // which is "residence-ccy per 1 unit of loan-ccy". For NRI-US with INR
  // loans the rate is USD-per-INR (~0.012). If the rupee depreciates,
  // each INR buys fewer USD → rate goes DOWN → drift is NEGATIVE.
  //
  // The user-facing label says "USD/INR +2.5%/yr" (more INR per USD =
  // depreciation) but on the wire we store -0.025 on INR.
  // E5 (audit 80): one number for the rupee's slide everywhere. The NRI
  // tool (engine/cross_border.py INR_SLIDE_A_YEAR) uses the 20-year ECB
  // average, 3.5% a year against the dollar (USD 46.45 → 96.73, 1 Sep 2006
  // → 9 Oct 2026); the plan used a 2.5% inflation gap, so the same loan
  // cost two different amounts on two screens. Differential test:
  // web/tests/a80-w10-nri.cjs.
  if (residenceCountry === 'US' && loanCurrency === 'INR') return INR_SLIDE_VS_USD;
  return '0';
}
