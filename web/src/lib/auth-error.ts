/** Public sign-in errors, without raw JSON, HTML or API paths. */
export function authErrorMessage(status: number, body: string, retryAfter: string | null): string {
  if (status === 429) {
    const seconds = Number(retryAfter);
    return retryAfter && Number.isFinite(seconds) && seconds > 0 && seconds <= 3600
      ? `Too many sign-in attempts. Wait ${Math.ceil(seconds)} seconds and try again.`
      : 'Sign-in is temporarily busy. Wait a minute and try again.';
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
