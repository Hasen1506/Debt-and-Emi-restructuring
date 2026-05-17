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
  const v = cookies().get(COOKIE_NAME)?.value;
  return isInflationModeling(v) ? v : DEFAULT_INFLATION_MODELING;
}

/**
 * Country-default CPI rate that the toggle applies when enabled. Refreshed
 * with `as_of` so stale values are obvious in code review.
 *   • India: RBI MPC April 2026 projection, FY26-27 headline CPI ~5.5%
 *   • US: FOMC SEP March 2026 median PCE projection ~3.0%
 *
 * These are conservative central-bank projections, not historicals — a
 * defensible default for projections, easy for users to override later
 * via the manual `inflation_rate` field in setup.
 */
export const INFLATION_DEFAULTS = {
  IN: '0.055',
  US: '0.030',
} as const;

export const INFLATION_DEFAULTS_AS_OF = '2026-05';
