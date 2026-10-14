/**
 * R10-3: WebKit reports a same-origin request cut off by a navigation (an
 * /api/ fetch, Next's ?_rsc= page fetch or prefetch) as a page error
 * "… due to access control checks." It isn't the app's error. One rule, shared with the app's error reporter (lib/client-error).
 */
import { isNavigationNoise } from '../src/lib/client-error';

export function isWebKitNavigationNoise(message: string): boolean {
  // Only a cut-off request to our own routes; a bare "Load failed" is not
  // filtered here, since a real failed fetch reads the same.
  return isNavigationNoise(message) && /(_rsc=|\/api\/|_next\/).*access control checks/.test(message);
}
