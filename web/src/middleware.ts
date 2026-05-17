/**
 * Route gates for the dashboard.
 *
 * Two gates, applied in order:
 *
 * 1. Auth gate. If `finoptima_session` is missing, redirect to /login
 *    with `?next=<original-path>` so we land them back where they were
 *    after sign-in.
 *
 * 2. Onboarding gate. Once signed in, if `finoptima_user` (the profile
 *    cookie) is missing, send them to /onboarding. /login synchronously
 *    hydrates this cookie from the server blob before navigating, so
 *    returning users on a new device shouldn't see this redirect.
 *    Genuinely new users will, which is correct.
 *
 * The matcher excludes /login (the gate's escape hatch), /onboarding
 * (we redirect *to* it), Next.js internals, and static assets. Any
 * other route requires both cookies.
 *
 * Middleware can only check cookie *presence*, not session validity —
 * a stolen/expired token would still pass this gate, then 401 on the
 * first authed API call. That's an acceptable tradeoff for phase 2;
 * tightening it would require an async DB lookup on every request.
 */
import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'finoptima_session';
const PROFILE_COOKIE = 'finoptima_user';

export function middleware(req: NextRequest) {
  const url = req.nextUrl;

  if (!req.cookies.get(SESSION_COOKIE)) {
    const dest = url.clone();
    dest.pathname = '/login';
    dest.search = `?next=${encodeURIComponent(url.pathname + url.search)}`;
    return NextResponse.redirect(dest);
  }

  // /onboarding is reachable signed-in but without a profile cookie
  // — that's literally what it exists to capture.
  if (url.pathname.startsWith('/onboarding')) {
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
    '/((?!login|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api).*)',
  ],
};
