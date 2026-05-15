/**
 * Per-plan toggle: model the user's expected annual hike, or treat income
 * as flat across the horizon?
 *
 * Stored in a cookie so the Plan page renders the right schedule on first
 * byte without a roundtrip — same pattern as `theme.ts` and `strategy.ts`.
 *
 * When OFF, the Plan server component zeroes out `annual_hike_rate` before
 * calling /api/simulate, so the engine simulates flat income. The user's
 * stored profile is never mutated — the toggle is render-time only.
 */

export type HikeModeling = 'on' | 'off';

export const DEFAULT_HIKE_MODELING: HikeModeling = 'on';
const COOKIE_NAME = 'finoptima_hike_modeling';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function isHikeModeling(v: string | null | undefined): v is HikeModeling {
  return v === 'on' || v === 'off';
}

// ─── Client-side ────────────────────────────────────────────────────────────

export function readHikeModelingClient(): HikeModeling {
  if (typeof document === 'undefined') return DEFAULT_HIKE_MODELING;
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  const v = match ? decodeURIComponent(match[1]) : null;
  return isHikeModeling(v) ? v : DEFAULT_HIKE_MODELING;
}

export function writeHikeModelingClient(value: HikeModeling) {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

// ─── Server-side ────────────────────────────────────────────────────────────

export async function loadHikeModelingServer(): Promise<HikeModeling> {
  const { cookies } = await import('next/headers');
  const v = cookies().get(COOKIE_NAME)?.value;
  return isHikeModeling(v) ? v : DEFAULT_HIKE_MODELING;
}
