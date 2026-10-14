/**
 * Audit 80+ D16 (safe step before E-09b): how long a script-readable copy of
 * the user's figures (profile chunks rightdue_user*, mirrored slices) may live.
 *
 * A guest's only copy is this browser, so it keeps a year. For a signed-in
 * account the server holds the real copy (/api/user/state) and
 * <SessionHydrator/> rewrites the local one on every visit, so the readable
 * copy needs to live no longer than the sign-in itself: SESSION_TTL in
 * api/auth/session.py (30 days). Before, every copy lived 365 days, long
 * after the session that justified it (D16, D21).
 *
 * Keep the account key in step with server-sync.ts ACCOUNT_KEY.
 */
export const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const ACCOUNT_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
export const ACCOUNT_KEY = 'rightdue_account_id';

export function readableCookieMaxAge(): number {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(ACCOUNT_KEY)) return ACCOUNT_COOKIE_MAX_AGE;
  } catch { /* storage blocked: treat as a guest */ }
  return GUEST_COOKIE_MAX_AGE;
}
