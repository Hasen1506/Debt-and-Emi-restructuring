/**
 * Per-plan toggle: inflate fixed + variable expenses each month at the
 * country-default CPI, or treat expenses as flat across the horizon?
 *
 * Mirrors hike-modeling.ts — cookie-backed so /plan renders with the
 * right trajectory on first byte. When ON, the server component sends
 * `inflate_expenses=true` to /api/simulate and the engine compounds
 * `user.inflation_rate` monthly into the surplus computation.
 *
 * Default OFF because the legacy plan view treats expenses as flat —
 * users opt into "stress-test for inflation" rather than have their
 * projections quietly stretch right on first load.
 */

export type InflationModeling = 'on' | 'off';

export const DEFAULT_INFLATION_MODELING: InflationModeling = 'off';
const COOKIE_NAME = 'finoptima_inflation_modeling';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function isInflationModeling(v: string | null | undefined): v is InflationModeling {
  return v === 'on' || v === 'off';
}

// ─── Client-side ────────────────────────────────────────────────────────────

export function readInflationModelingClient(): InflationModeling {
  if (typeof document === 'undefined') return DEFAULT_INFLATION_MODELING;
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  const v = match ? decodeURIComponent(match[1]) : null;
  return isInflationModeling(v) ? v : DEFAULT_INFLATION_MODELING;
}

export function writeInflationModelingClient(value: InflationModeling) {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  void import('./server-sync').then(({ syncSliceToServer }) =>
    syncSliceToServer('inflation_modeling', value),
  );
}

// ─── Server-side ────────────────────────────────────────────────────────────

export async function loadInflationModelingServer(): Promise<InflationModeling> {
  const { cookies } = await import('next/headers');
  const v = (await cookies()).get(COOKIE_NAME)?.value;
  return isInflationModeling(v) ? v : DEFAULT_INFLATION_MODELING;
}

/**
 * The forecast the plan uses for rising prices, unless the user sets their
 * own rate on Plan. Each is a central bank's latest published forecast;
 * refresh it (and `asOf`) when a new one comes out.
 *   • India: RBI Monetary Policy Statement, 5 Aug 2026: CPI inflation for
 *     2026-27 projected at 5.0% (down from 5.1% in June; 4.6% in April).
 *   • US: FOMC Summary of Economic Projections, 16 Sep 2026: median PCE
 *     inflation 2.3% in 2027 (3.7% in 2026), 2.0% by 2029.
 */
export const INFLATION_FORECAST = {
  IN: { rate: '0.050', who: 'RBI', what: 'forecast for 2026–27', asOf: '2026-08-05' },
  US: { rate: '0.023', who: 'the Fed', what: 'median forecast for 2027 (PCE prices)', asOf: '2026-09-16' },
} as const;

// ─── The user's own rate ────────────────────────────────────────────────────

const RATE_COOKIE = 'finoptima_inflation_rate';

/** '' for "use the forecast", else a yearly rate as a decimal ('0.06'),
 *  between 0 and 25%. */
export function normalizeInflationRate(v: string | null | undefined): string {
  const t = String(v ?? '').trim();
  if (t === '') return '';
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 0.25 ? String(Number(n.toFixed(4))) : '';
}

export function readInflationRateClient(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp(`(?:^|; )${RATE_COOKIE}=([^;]*)`));
  return normalizeInflationRate(match ? decodeURIComponent(match[1]) : null);
}

export function writeInflationRateClient(value: string) {
  if (typeof document === 'undefined') return;
  const v = normalizeInflationRate(value);
  document.cookie = v
    ? `${RATE_COOKIE}=${v}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
    : `${RATE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  void import('./server-sync').then(({ syncSliceToServer }) => syncSliceToServer('inflation_rate', v));
}

export async function loadInflationRateServer(): Promise<string> {
  const { cookies } = await import('next/headers');
  return normalizeInflationRate((await cookies()).get(RATE_COOKIE)?.value);
}

/** The rate the plan runs on: the user's own, else the forecast. */
export function inflationRateFor(country: 'IN' | 'US', own: string): string {
  return own || INFLATION_FORECAST[country].rate;
}
