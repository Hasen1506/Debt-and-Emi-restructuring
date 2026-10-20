/**
 * R10-3: WebKit reports a same-origin request cut off by a navigation (an
 * /api/ fetch, Next's ?_rsc= page fetch or prefetch) as a page error
 * "… due to access control checks." It isn't the app's error. One rule, shared with the app's error reporter (lib/client-error).
 */
import { isChunkLoadError, isNavigationNoise } from '../src/lib/client-error';

export function isWebKitNavigationNoise(message: string): boolean {
  // Only a cut-off request to our own routes; a bare "Load failed" is not
  // filtered here, since a real failed fetch reads the same.
  return isNavigationNoise(message) && /(_rsc=|\/api\/|_next\/).*access control checks/.test(message);
}

/** Next's "Loading chunk N failed" for a route this document is not
 *  showing. WebKit reports the script still loading for the page just
 *  left once the next navigation aborts it (a11y, WebKit, CI run
 *  39378714202: leaving /plan for / reported the plan page chunk). A
 *  chunk for the page that is open, or a chunk error with no route in
 *  it, is still a real miss. */
export function isCutOffChunk(message: string, currentPath: string): boolean {
  const body = message.replace(/^pageerror:\s*/, '');
  if (!isChunkLoadError('', body)) return false;
  const found = body.match(/_next\/static\/chunks\/app\/(.+?)\/page-/);
  if (!found) return false;
  const theirs = '/' + found[1].replace(/\/$/, '');
  const here = (currentPath.split('?')[0].replace(/\/$/, '') || '/');
  return here !== theirs;
}

/** A chunk error whose script request the browser aborted (ERR_ABORTED,
 *  NS_BINDING_ABORTED). A 404 is not an abort, so a chunk the open page
 *  cannot load is still reported. Shared numbered chunks
 *  (`/chunks/4434-….js`) have no route in the name; the abort is the
 *  only signal that the navigation cut them off. */
export function isAbortedChunkError(message: string, abortedUrls: ReadonlySet<string>): boolean {
  const body = message.replace(/^pageerror:\s*/, '');
  if (!isChunkLoadError('', body)) return false;
  const url = body.match(/https?:\/\/[^)\s]+/)?.[0];
  if (!url || abortedUrls.has(url)) return !!url && abortedUrls.has(url);
  try {
    const path = new URL(url).pathname;
    for (const aborted of abortedUrls) if (new URL(aborted).pathname === path) return true;
  } catch {
    return false;
  }
  return false;
}
