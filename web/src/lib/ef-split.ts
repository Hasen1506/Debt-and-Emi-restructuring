/**
 * Per-user split of monthly surplus between emergency-fund top-up and
 * debt prepayment, when an EF gap exists.
 *
 * Engine consumes `ef_top_up_rate` ∈ [0, 1] — the fraction of surplus
 * diverted to EF each month until `efund_target` is reached. Once the
 * EF target is hit, the engine flips to 100% surplus → debt regardless
 * of this setting.
 *
 * Default 0.3 (30% EF / 70% debt) preserves the pre-existing hardcoded
 * behaviour from /plan. Users can override 0–100% on /plan now that the
 * value is surfaced as a slider rather than baked into one line of code.
 */

export const DEFAULT_EF_SPLIT = '0.3';
const COOKIE_NAME = 'finoptima_ef_split';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function normalize(v: string | null | undefined): string {
  if (!v) return DEFAULT_EF_SPLIT;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1) return DEFAULT_EF_SPLIT;
  return n.toFixed(2);
}

// ─── Client-side ────────────────────────────────────────────────────────────

export function readEfSplitClient(): string {
  if (typeof document === 'undefined') return DEFAULT_EF_SPLIT;
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  return normalize(match ? decodeURIComponent(match[1]) : null);
}

export function writeEfSplitClient(value: string) {
  if (typeof document === 'undefined') return;
  const v = normalize(value);
  document.cookie = `${COOKIE_NAME}=${v}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  void import('./server-sync').then(({ syncSliceToServer }) =>
    syncSliceToServer('ef_split', v),
  );
}

// ─── Server-side ────────────────────────────────────────────────────────────

export async function loadEfSplitServer(): Promise<string> {
  const { cookies } = await import('next/headers');
  return normalize((await cookies()).get(COOKIE_NAME)?.value);
}

/** Months to fill an emergency-fund gap when `split` of each month's
 *  surplus goes to it (the user's Plan slider, not a fixed 30%). 0 when
 *  there's no gap; Infinity when nothing goes to the fund. */
export function efMonthsToFill(target: number, balance: number, surplus: number, split: string | number): number {
  const gap = Math.max(0, target - balance);
  if (gap === 0) return 0;
  const share = Number(normalize(String(split)));
  if (!(surplus > 0) || !(share > 0)) return Infinity;
  return Math.ceil(gap / (surplus * share));
}
