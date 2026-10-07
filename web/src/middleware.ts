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
 * The matcher excludes /login (the gate's escape hatch), /onboarding
 * (we redirect *to* it), Next.js internals, and static assets.
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

  // /onboarding is reachable without a profile cookie — that's
  // literally what it exists to capture. Loan Check is too: it needs
  // only the loan's own facts, and it is the first thing a new visitor
  // should be able to try.
  if (
    url.pathname.startsWith('/onboarding') ||
    url.pathname.startsWith('/tools/loan-check')
  ) {
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

export const config = {
  matcher: [
    '/((?!login|welcome\\.html|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api|art/).*)',
  ],
};

