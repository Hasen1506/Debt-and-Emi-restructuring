/** UX50 E-03: which browser errors are worth a report. */
export function shouldReport(name: string, message: string): boolean {
  if (name === 'AbortError') return false;                       // user navigated away
  if (/\b401\b|unauthori[sz]ed/i.test(message)) return false;     // signed out: expected
  if (/ResizeObserver loop/i.test(message)) return false;         // browser noise
  if (/^Script error\.?$/i.test(message)) return false;           // cross-origin, no detail
  return Boolean(name || message);
}
