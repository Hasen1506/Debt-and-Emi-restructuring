/**
 * Sign in with Google (live test #6): the web side. The server decides
 * whether it is on (GOOGLE_SIGNIN and the OAuth client in api/auth/google.py);
 * /login asks it through GOOGLE_CONFIG_PATH and shows the button only then.
 * These are plain page navigations to FastAPI through Next's /api fallback
 * rewrite (next.config.mjs), so Google's redirect and the session cookie
 * land on the site's own origin.
 */
import { safeRedirect } from './safe-redirect';

export const GOOGLE_CONFIG_PATH = '/api/auth/google/config';
export const GOOGLE_START_PATH = '/api/auth/google/start';

/** Where "Continue with Google" goes, carrying a same-site `next`. */
export function googleStartHref(next: string | null | undefined, origin = 'https://rightdue.app'): string {
  const dest = next ? safeRedirect(next, origin) : '/';
  return dest && dest !== '/' ? `${GOOGLE_START_PATH}?next=${encodeURIComponent(dest)}` : GOOGLE_START_PATH;
}
