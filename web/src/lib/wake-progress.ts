/**
 * Sign-in on the free-plan API: the first request after a quiet spell can
 * hang for 30-60 s while the server starts. Live QA (7 Oct) saw only a
 * silent "SENDING…" for that long. After a short grace period the page
 * says the server is waking up and shows how far along a typical start is.
 */
export const WAKE_HINT_AFTER_MS = 2500;
/** A typical cold start; the bar holds at 95% if it takes longer. */
export const WAKE_EXPECTED_MS = 60000;

export interface WakeProgress {
  show: boolean;
  /** 0-95, for a progress bar. */
  pct: number;
  seconds: number;
  message: string;
}

export function wakeProgress(elapsedMs: number, action: 'send' | 'verify' = 'send'): WakeProgress {
  const ms = Math.max(0, elapsedMs);
  const seconds = Math.floor(ms / 1000);
  if (ms < WAKE_HINT_AFTER_MS) return { show: false, pct: 0, seconds, message: '' };
  const pct = Math.min(95, Math.round((ms / WAKE_EXPECTED_MS) * 100));
  const what = action === 'send' ? 'send your code' : 'check your code';
  const message =
    ms < WAKE_EXPECTED_MS
      ? `Waking up the server so we can ${what}. This can take up to a minute the first time (${seconds}s).`
      : `Still waking up (${seconds}s). Keep this page open; we'll ${what} as soon as it's ready.`;
  return { show: true, pct, seconds, message };
}

/** Seconds before "Resend code" is offered again. */
export const RESEND_COOLDOWN_S = 30;
