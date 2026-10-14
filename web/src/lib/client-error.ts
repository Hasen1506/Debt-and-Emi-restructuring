/** UX50 E-03: which browser errors are worth a report. */
export function shouldReport(name: string, message: string): boolean {
  if (name === 'AbortError') return false;                       // user navigated away
  // Re-test 9 O-1: WebKit's words for a same-origin fetch cut off by a
  // navigation (our API calls are same-origin, so it is never real CORS).
  if (name === 'TypeError' && /due to access control checks|^Load failed$/i.test(message)) return false;
  if (/\b401\b|unauthori[sz]ed/i.test(message)) return false;     // signed out: expected
  if (/ResizeObserver loop/i.test(message)) return false;         // browser noise
  if (/^Script error\.?$/i.test(message)) return false;           // cross-origin, no detail
  return Boolean(name || message);
}
