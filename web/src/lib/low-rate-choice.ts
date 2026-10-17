/**
 * Audit 80+ A4: what the user chose once only cheap debt is left (every
 * loan under 10% a year): the share of the extra they keep instead of
 * prepaying. '' = not chosen yet (the plan prepays everything and Plan asks;
 * there is no default). Kept like the debt budget: its own cookie, synced to
 * the account. The return they typed to compare is kept on this device only.
 */
const COOKIE_NAME = 'rightdue_low_rate_share';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const RETURN_KEY = 'rightdue_low_rate_return';

export const LOW_RATE_SHARES = ['0', '0.25', '0.5', '0.75', '1'] as const;

export function normalizeLowRateShare(v: string | null | undefined): string {
  const s = String(v ?? '').trim();
  return (LOW_RATE_SHARES as readonly string[]).includes(s) ? s : '';
}

export function readLowRateShareClient(): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  return normalizeLowRateShare(m ? decodeURIComponent(m[1]) : null);
}

export function writeLowRateShareClient(value: string, sync = true) {
  if (typeof document === 'undefined') return;
  const v = normalizeLowRateShare(value);
  document.cookie = v
    ? `${COOKIE_NAME}=${v}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
    : `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
  if (sync) void import('./server-sync').then(({ syncSliceToServer }) => syncSliceToServer('low_rate_share', v));
}

export async function loadLowRateShareServer(): Promise<string> {
  const { cookies } = await import('next/headers');
  return normalizeLowRateShare((await cookies()).get(COOKIE_NAME)?.value);
}

/** The yearly return after tax the user typed (a fraction as text), or ''. */
export function readAssumedReturn(): string {
  try {
    const v = localStorage.getItem(RETURN_KEY) ?? '';
    return /^0(\.\d{1,4})?$/.test(v) && Number(v) <= 0.3 ? v : '';
  } catch {
    return '';
  }
}

export function writeAssumedReturn(v: string) {
  try {
    if (v) localStorage.setItem(RETURN_KEY, v);
    else localStorage.removeItem(RETURN_KEY);
  } catch {
    /* private mode: the comparison still works this visit */
  }
}

/** "Keep 25%, prepay 75%" in words. */
export function shareWords(share: string): string {
  const k = Math.round(Number(share) * 100);
  if (k === 0) return 'Prepay all of it';
  if (k === 100) return 'Keep all of it';
  return `Keep ${k}%, prepay ${100 - k}%`;
}
