/**
 * Re-test 10 R10-3: one AbortController for the page's background requests
 * (central rates, auth/me, notify flags). It is aborted as soon as the page
 * starts to go away (beforeunload, then pagehide), so WebKit doesn't log
 * "…/api/… due to access control checks" for a fetch the navigation cut
 * off. R9 aborted only the rates fetch, and only on pagehide, which WebKit
 * fires after it has already logged the cut-off request.
 *
 * A fresh controller replaces the aborted one straight away, so requests
 * made later on the same page still work. A request cut off this way is
 * asked again by pageScoped() if the page is still here a second later:
 * the leave was cancelled (a "leave this page?" prompt) or the page came
 * back from the back/forward cache.
 */

let controller: AbortController | null = null;
let installed = false;
/** When an unprompted leave began (ms), or 0: no leave under way. */
let leavingSince = 0;
/** How long a leave nobody cancelled may take before we assume it was
 *  called off (a download link, Stop) and ask again. A slow next page
 *  (the /plan render) commits well inside this, so a re-asked request
 *  isn't cut off and logged by WebKit after all. */
export const LEAVE_GRACE_MS = 5000;

function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const abortNow = () => {
    const c = controller;
    controller = new AbortController();
    c?.abort();
  };
  // beforeunload: at once (R11-1). WebKit cancels and logs in-flight
  // fetches when the next page commits, which can be before a task queued
  // here would run, so a deferred abort came too late. If a "leave this
  // page?" prompt (Profile's unsaved changes) keeps the person here, the
  // requests cut off now are asked again by pageScoped() a second later.
  // pagehide: at once too (bfcache, and browsers that skip beforeunload).
  window.addEventListener('beforeunload', (e) => {
    abortNow();
    leavingSince = Date.now();
    // Once every listener has run: a prompt that kept the person here
    // means the requests can be asked again after the usual second.
    setTimeout(() => {
      const kept = e.defaultPrevented || (typeof e.returnValue === 'string' && e.returnValue !== '');
      if (kept) leavingSince = 0;
    }, 0);
  });
  window.addEventListener('pagehide', abortNow);
  // Back from the back/forward cache: this page is in use again. Only a
  // restore (persisted) counts: the first load's own pageshow also fires
  // when /plan finishes loading *after* the person already left it (main
  // CI 38517942574, WebKit: 4 auth/me cut off in 20 leaves), and clearing
  // the leave then let its hydration requests out to be cut off and logged.
  window.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) leavingSince = 0;
  });
}

// R12-1: listen from the moment this module loads, not from the first
// request. On a page that is still hydrating when the person leaves, the
// first page-scoped request can come after beforeunload; installing then
// would miss the leave, and that request would be cut off and logged.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') install();

/** The signal that is aborted when this page starts to unload; undefined on the server. */
export function pageSignal(): AbortSignal | undefined {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function' || typeof AbortController === 'undefined') return undefined;
  install();
  controller ??= new AbortController();
  return controller.signal;
}

/** Aborted when any of the signals is. */
export function anySignal(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const list = signals.filter((s): s is AbortSignal => !!s);
  if (list.length <= 1) return list[0];
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof any === 'function') return any(list);
  const c = new AbortController();
  for (const s of list) {
    if (s.aborted) {
      c.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => c.abort(s.reason), { once: true });
  }
  return c.signal;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run a request with the page signal (and the caller's own, if any). When
 * the page signal cut it off and the caller didn't cancel, wait a second
 * and ask again: the leave was cancelled by a "leave this page?" prompt or
 * the page came back from the back/forward cache. While a leave nobody
 * cancelled is still under way (the next page is slow), keep waiting, up
 * to LEAVE_GRACE_MS, so the new request isn't cut off in turn. The same
 * wait comes before the first try (R12-1).
 */
export async function pageScoped<T>(run: (signal: AbortSignal | undefined) => Promise<T>, own?: AbortSignal, retryAfterMs = 1000): Promise<T> {
  for (;;) {
    // R12-1: a request this page starts while it is leaving (it is still
    // hydrating while the next page loads) would get the fresh, live
    // signal and be cut off and logged by WebKit. So the first try waits
    // too, until the leave is called off (the prompt's Stay, a bfcache
    // pageshow) or LEAVE_GRACE_MS passes. If the page does go, it never runs.
    await whileLeaving(own, Math.min(LEAVE_POLL_MS, retryAfterMs));
    if (own?.aborted) throw abortReason(own);
    const page = pageSignal();
    try {
      return await run(anySignal(page, own));
    } catch (e) {
      if (own?.aborted || !page?.aborted) throw e;
      await sleep(retryAfterMs);
      if (own?.aborted) throw e;
    }
  }
}

/** How often a held request looks again whether the leave is over. */
const LEAVE_POLL_MS = 100;

/** True while an unprompted leave is under way (and inside the grace). */
export function isLeaving(): boolean {
  return !!leavingSince && Date.now() - leavingSince < LEAVE_GRACE_MS;
}

async function whileLeaving(own: AbortSignal | undefined, pollMs: number): Promise<void> {
  while (isLeaving() && !own?.aborted) await sleep(pollMs);
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}
