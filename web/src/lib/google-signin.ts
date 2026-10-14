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

/** Where "Continue with Google" goes, carrying a same-site `next` and,
 *  audit80 D2/D7, what the user agreed to on the sign-in page (notice and
 *  terms versions, the 18+ tick), which the callback records. */
export function googleStartHref(
  next: string | null | undefined,
  origin = 'https://rightdue.app',
  consent?: { notice_version: string; terms_version: string; age_confirmed: boolean },
): string {
  const dest = next ? safeRedirect(next, origin) : '/';
  const q = new URLSearchParams();
  if (dest && dest !== '/') q.set('next', dest);
  if (consent) {
    q.set('nv', consent.notice_version);
    q.set('tv', consent.terms_version);
    if (consent.age_confirmed) q.set('age', '1');
  }
  const qs = q.toString();
  return qs ? `${GOOGLE_START_PATH}?${qs}` : GOOGLE_START_PATH;
}
