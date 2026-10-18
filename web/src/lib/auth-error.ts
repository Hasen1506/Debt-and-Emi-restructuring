/** Shown while the sleeping API starts. No sign-in code has been created yet, so a retry is safe. */
export const SIGN_IN_STARTING_MESSAGE = 'Sign-in is waking up. Please wait 30 seconds and try again.';

/** Shown when the server's daily cap on NEW sign-ups is reached (audit80
 *  D13): existing accounts can still sign in, so say that. */
export const SIGN_UP_PAUSED_MESSAGE = 'New sign-ups are paused for today because of unusually many requests. If you already have an account, check the email address; otherwise please try again tomorrow.';

/** Older servers: the daily cap paused every sign-in code. */
export const SIGN_IN_PAUSED_MESSAGE = 'New sign-in codes are paused for today because of unusually many requests. Your saved data is safe. Please try again tomorrow.';

/** Public sign-in errors, without raw JSON, HTML or API paths. */
export function authErrorMessage(status: number, body: string, retryAfter: string | null): string {
  if (status === 429) {
    // UX2-7: the server's own "Too many attempts. Request a new code." / "Too many
    // wrong codes for this email today" says what happened; "busy" didn't.
    try {
      const detail = JSON.parse(body)?.detail;
      const own = typeof detail === 'string' ? detail : detail?.message;
      if (typeof own === 'string' && /^Too many (attempts|wrong codes)\b/.test(own)) return own.slice(0, 300);
    } catch { /* not our JSON */ }
    const seconds = Number(retryAfter);
    return retryAfter && Number.isFinite(seconds) && seconds > 0 && seconds <= 3600
      ? `Too many sign-in attempts. Wait ${Math.ceil(seconds)} seconds and try again.`
      : 'Sign-in is temporarily busy. Wait a minute and try again.';
  }
  if (status === 503) {
    try {
      const code = JSON.parse(body)?.detail?.code;
      if (code === 'sign_in_starting') return SIGN_IN_STARTING_MESSAGE;
      // The day's cap on sign-in codes was reached (api/auth/routes.py, grill #59).
      if (code === 'sign_in_paused') return SIGN_IN_PAUSED_MESSAGE;
      if (code === 'sign_up_paused') return SIGN_UP_PAUSED_MESSAGE;
    } catch { /* Keep arbitrary upstream errors private. */ }
  }
  if (status >= 500) return 'Sign-in is temporarily unavailable. Try again in a minute.';
  try {
    const detail = JSON.parse(body)?.detail;
    const message = typeof detail === 'string' ? detail : detail?.message;
    if (typeof message === 'string' && message.trim()) return message.slice(0, 500);
  } catch { /* The hosting layer may return a page rather than JSON. */ }
  return status === 401
    ? 'Your session has expired. Sign in again.'
    : 'Sign-in could not be completed. Please try again.';
}
