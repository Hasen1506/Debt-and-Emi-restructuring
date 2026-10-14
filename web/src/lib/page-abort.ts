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

function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const abortNow = () => {
    const c = controller;
    controller = new AbortController();
    c?.abort();
  };
  // beforeunload: one task later, once every listener has run, so a
  // "leave this page?" prompt (Profile's unsaved changes) that kept the
  // person here doesn't cut their requests off. The old page keeps running
  // tasks while the next one loads, so this still lands before WebKit
  // cancels the fetches itself. pagehide: at once.
  window.addEventListener('beforeunload', (e) => {
    setTimeout(() => {
      if (!e.defaultPrevented) abortNow();
    }, 0);
  });
  window.addEventListener('pagehide', abortNow);
}

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
 * (a real unload never gets there) and ask again.
 */
export async function pageScoped<T>(run: (signal: AbortSignal | undefined) => Promise<T>, own?: AbortSignal, retryAfterMs = 1000): Promise<T> {
  for (;;) {
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
