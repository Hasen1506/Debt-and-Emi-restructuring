/**
 * Route gates for the dashboard.
 *
 * Two gates, applied in order:
 *
 * 1. Auth gate. If `finoptima_session` is missing, redirect to /login
 *    with `?next=<original-path>` so we land them back where they were
 *    after sign-in. Skipped when `NEXT_PUBLIC_DISABLE_AUTH=true` —
 *    used while the production deploy lacks an email-sending domain so
 *    the OTP flow can't complete. Re-enable by unsetting the env var.
 *
 * 2. Onboarding gate. If `finoptima_user` (the profile cookie) is
 *    missing, send them to /onboarding. /login synchronously hydrates
 *    this cookie from the server blob before navigating, so returning
 *    users on a new device shouldn't see this redirect. Genuinely new
 *    users will, which is correct.
 *
 * Loan Check (/tools/loan-check) is public: it needs only the loan's own
 * facts and is the first thing a new visitor should be able to try. It used
 * to sit behind the auth gate despite saying so (BUG_REPORT M5).
 *
 * The matcher excludes /login (the gate's escape hatch), /api, /art,
 * Next.js internals and static files, each anchored to a whole path
 * segment: an unanchored "login" also skipped /loginfoo, and the favicon
 * (/icon.svg) was redirected to /login for signed-out visitors.
 *
 * Middleware can only check cookie *presence*, not session validity —
 * a stolen/expired token would still pass this gate, then 401 on the
 * first authed API call. That's an acceptable tradeoff for phase 2;
 * tightening it would require an async DB lookup on every request.
 */
import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'finoptima_session';
const PROFILE_COOKIE = 'finoptima_user';
const AUTH_DISABLED = process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true';

export function middleware(req: NextRequest) {
  const url = req.nextUrl;

  if (isPublicTool(url.pathname) || isPublicPage(url.pathname)) return NextResponse.next();

  if (!AUTH_DISABLED && !req.cookies.get(SESSION_COOKIE)) {
    // Signed-out visitors to the root see the public landing page
    // (web/public/welcome.html) instead of being bounced to /login, so
    // rightdue.app explains the product to anyone who visits.
    if (url.pathname === '/') {
      const landing = url.clone();
      landing.pathname = '/welcome.html';
      landing.search = '';
      return NextResponse.rewrite(landing);
    }
    const dest = url.clone();
    dest.pathname = '/login';
    dest.search = `?next=${encodeURIComponent(url.pathname + url.search)}`;
    return NextResponse.redirect(dest);
  }

  // /onboarding is reachable without a profile cookie (signed in): that's
  // literally what it exists to capture.
  if (url.pathname === '/onboarding' || url.pathname.startsWith('/onboarding/')) {
    return NextResponse.next();
  }

  if (!req.cookies.get(PROFILE_COOKIE)) {
    const dest = url.clone();
    dest.pathname = '/onboarding';
    dest.search = '';
    return NextResponse.redirect(dest);
  }

  return NextResponse.next();
}

/** Pages anyone may use without signing in. */
export function isPublicTool(pathname: string): boolean {
  return pathname === '/tools/loan-check' || pathname.startsWith('/tools/loan-check/');
}

/** The privacy notice and terms (grill #51), readable before signing in
 *  (DPDP Act s.5: the notice comes before consent), and "Your data", which
 *  also lets a guest clear this browser; it checks the session itself. */
export function isPublicPage(pathname: string): boolean {
  return pathname === '/privacy' || pathname === '/terms' || pathname === '/account';
}

export const config = {
  matcher: [
    '/((?!(?:login|api|art)(?:/|$)|_next/static|_next/image|welcome\\.html$|favicon\\.ico$|icon\\.svg$|robots\\.txt$|sitemap\\.xml$).*)',
  ],
};

