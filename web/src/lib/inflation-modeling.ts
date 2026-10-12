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

import MARKET from './market-data.json';

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
 * own rate on Plan: each central bank's latest published forecast, from
 * market-data.json (RBI's MPC resolution: CPI for the financial year; the
 * Fed's Summary of Economic Projections: median PCE inflation next year).
 * scripts/refresh_market_data.py re-reads both every week.
 */
function forecast(country: 'IN' | 'US') {
  const f = MARKET.inflation[country];
  return { rate: f.rate, who: f.who, what: f.what, asOf: f.as_of };
}

export const INFLATION_FORECAST = {
  IN: forecast('IN'),
  US: forecast('US'),
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

// ─── Long-run anchor (grill #39, sprint G4) ─────────────────────────────────

/**
 * Each central bank's own long-run inflation target: the anchor for plans
 * that run many years, where a one-year forecast compounded for 20 years
 * would overstate costs. Both are in engine/data_freshness.json, which
 * fails a test when they go unchecked for a year.
 *  - India: CPI target 4% (band 2–6%), 1 Apr 2026 – 31 Mar 2031, Gazette
 *    S.O. 1580(E) of 25 Mar 2026 under RBI Act s.45ZA.
 *  - US: 2% PCE, FOMC Statement on Longer-Run Goals, reaffirmed 27 Jan 2026.
 * Update rule: the forecast above refreshes weekly; these change only when
 * the notification (next review by Mar 2031) or the FOMC statement does.
 */
export const INFLATION_LONG_RUN = {
  IN: { rate: '0.04', who: 'RBI', what: 'inflation target (4%, band 2–6%) to March 2031', url: 'https://www.rbi.org.in/scripts/bs_viewbulletin.aspx?Id=24174' },
  US: { rate: '0.02', who: 'the Fed', what: 'longer-run goal (2% PCE prices)', url: 'https://www.federalreserve.gov/monetarypolicy/files/FOMC_LongerRunGoals.pdf' },
} as const;

/**
 * The line shown beside the debt-free date (grill #39): when inflation
 * modelling is off, say plainly that the plan holds spending flat; when on,
 * say at what rate it grows. `monthlySpend` is already formatted (₹45,000).
 */
export function spendingAssumptionLine(
  mode: InflationModeling,
  monthlySpend: string,
  ratePct?: string,
): string {
  if (mode === 'off') {
    return `Assumes your spending stays at ${monthlySpend} a month. Turn on rising prices on Plan to see the date with inflation.`;
  }
  return ratePct
    ? `Assumes your spending of ${monthlySpend} a month grows ${ratePct}% a year with prices.`
    : `Assumes your spending of ${monthlySpend} a month grows with prices.`;
}
