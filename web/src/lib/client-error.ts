/**
 * Re-test 9 O-1 / re-test 10 R10-3: WebKit's words for a same-origin
 * request (an /api/ fetch, or Next's ?_rsc= page fetch) cut off by a
 * navigation. Our API calls are same-origin, so it is never real CORS.
 * Shared with the E2E error watchers (e2e/browser-noise.ts).
 */
export const NAVIGATION_NOISE = /due to access control checks|^(TypeError: )?Load failed$/i;

export function isNavigationNoise(message: string): boolean {
  return NAVIGATION_NOISE.test(message.trim());
}

/** A script chunk that didn't load: a deploy replaced the build under an
 *  open tab (the old chunk names now 404), or the navigation cut it off. */
export function isChunkLoadError(name: string, message: string): boolean {
  return name === 'ChunkLoadError' || /^Loading (CSS )?chunk [\w/-]+ failed/i.test(message);
}

/** UX50 E-03: which browser errors are worth a report. */
export function shouldReport(name: string, message: string): boolean {
  if (name === 'AbortError') return false;                       // user navigated away
  if (isNavigationNoise(message)) return false;                    // WebKit: request cut off by a navigation
  if (/\b401\b|unauthori[sz]ed/i.test(message)) return false;     // signed out: expected
  if (/ResizeObserver loop/i.test(message)) return false;         // browser noise
  if (/^Script error\.?$/i.test(message)) return false;           // cross-origin, no detail
  return Boolean(name || message);
}

const RELOAD_KEY = 'rightdue_chunk_reload_at';

/**
 * R10-3: after a deploy, an open tab asks for script chunks the new build
 * no longer has. Reload once to get the new build; never twice within a
 * minute, so a chunk that is really missing can't loop. Returns true when
 * it reloaded. Not while the page is being left (the cut-off chunk is the
 * navigation's, not a deploy's).
 */
export function reloadOnceForChunkError(
  win: { location: { reload: () => void }; sessionStorage: Pick<Storage, 'getItem' | 'setItem'> },
  leaving: boolean,
  now = Date.now(),
): boolean {
  if (leaving) return false;
  try {
    const last = Number(win.sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (now - last < 60_000) return false;
    win.sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    return false; // no storage: can't guard against a loop, so don't reload
  }
  win.location.reload();
  return true;
}
