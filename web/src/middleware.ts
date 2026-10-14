/**
 * Route gates for the dashboard.
 *
 * Two gates, applied in order:
 *
 * 1. Auth gate. If `rightdue_session` is missing, redirect to /login
 *    with `?next=<original-path>` so we land them back where they were
 *    after sign-in. Skipped when `NEXT_PUBLIC_DISABLE_AUTH=true` —
 *    used while the production deploy lacks an email-sending domain so
 *    the OTP flow can't complete. Re-enable by unsetting the env var.
 *
 * 2. Onboarding gate. If `rightdue_user` (the profile cookie) is
 *    missing, send them to /onboarding. /login synchronously hydrates
 *    this cookie from the server blob before navigating, so returning
 *    users on a new device shouldn't see this redirect. Genuinely new
 *    users will, which is correct.
 *
 * Can't pay (/cant-pay) is public too (Audit 80 A17): the rules and blank
 * letters need no profile.
 *
 * Loan Check (/tools/loan-check) is public: it needs only the loan's own
 * facts and is the first thing a new visitor should be able to try. It used
 * to sit behind the auth gate despite saying so (BUG_REPORT M5).
 *
 * Signed out, only the app's own pages (lib/app-routes.ts) go to /login;
 * any other path falls through to Next's 404 (UX50 E-13).
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
import { NextRequest, NextResponse } from 'next/server';
import { renameRequestCookies } from './lib/storage-migration';
import { LANDING_COUNTRY_COOKIE, senseCountry } from './lib/landing-country';
import { isGatedAppPath } from './lib/app-routes';

const SESSION_COOKIE = 'rightdue_session';
const PROFILE_COOKIE = 'rightdue_user';
const AUTH_DISABLED = process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true';

/**
 * finoptima_* → rightdue_* (critique #58, one release): a request still
 * carrying old cookie names is answered as if it had the new ones, and the
 * browser is told to store them under the new names.
 */
export function middleware(req: NextRequest) {
  const proto = (req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol).replace(/:$/, '');
  const rename = renameRequestCookies(req.headers.get('cookie'), proto === 'https');
  if (!rename) return gate(req);
  const headers = new Headers(req.headers);
  headers.set('cookie', rename.header);
  const migrated = new NextRequest(req.url, { headers });
  const res = gate(migrated, headers);
  for (const c of rename.setCookies) res.headers.append('Set-Cookie', c);
  return res;
}

function gate(req: NextRequest, requestHeaders?: Headers): NextResponse {
  const url = req.nextUrl;
  const next = () => (requestHeaders ? NextResponse.next({ request: { headers: requestHeaders } }) : NextResponse.next());

  if (isPublicTool(url.pathname) || isPublicPage(url.pathname)) {
    const res = next();
    // A17: signed-out Can't pay picks India or USA rules from the same
    // non-identifying country cookie the landing page uses.
    if (isCantPay(url.pathname) && !req.cookies.get(LANDING_COUNTRY_COOKIE)) {
      res.cookies.set(LANDING_COUNTRY_COOKIE, senseCountry(req.headers), {
        path: '/',
        maxAge: 60 * 60 * 24,
        sameSite: 'lax',
        secure: url.protocol === 'https:',
      });
    }
    return res;
  }

  if (!AUTH_DISABLED && !req.cookies.get(SESSION_COOKIE)) {
    // Signed-out visitors to the root see the public landing page
    // (web/public/welcome.html) instead of being bounced to /login, so
    // rightdue.app explains the product to anyone who visits.
    if (url.pathname === '/') {
      const landing = url.clone();
      landing.pathname = '/welcome.html';
      landing.search = '';
      const res = requestHeaders ? NextResponse.rewrite(landing, { request: { headers: requestHeaders } }) : NextResponse.rewrite(landing);
      // Which country's version the page opens on (sprint G10): a guess
      // from the CDN country header or Accept-Language, never stored
      // against the visitor; their own toggle on the page wins.
      if (!req.cookies.get(LANDING_COUNTRY_COOKIE)) {
        res.cookies.set(LANDING_COUNTRY_COOKIE, senseCountry(req.headers), {
          path: '/',
          maxAge: 60 * 60 * 24,
          sameSite: 'lax',
          secure: url.protocol === 'https:',
        });
      }
      return res;
    }
    // UX50 E-13 / A-14: a path that isn't one of the app's pages (a typo,
    // an old link, /robots.txt's neighbours) gets the real 404, not a
    // sign-in wall that leads to a 404 after signing in.
    if (!isGatedAppPath(url.pathname)) return next();
    const dest = url.clone();
    dest.pathname = '/login';
    dest.search = `?next=${encodeURIComponent(url.pathname + url.search)}`;
    return NextResponse.redirect(dest);
  }

  // /onboarding is reachable without a profile cookie (signed in): that's
  // literally what it exists to capture.
  if (url.pathname === '/onboarding' || url.pathname.startsWith('/onboarding/')) {
    return next();
  }

  if (!req.cookies.get(PROFILE_COOKIE)) {
    const dest = url.clone();
    dest.pathname = '/onboarding';
    dest.search = '';
    return NextResponse.redirect(dest);
  }

  return next();
}

/** Pages anyone may use without signing in. The glossary (sprint G10,
 *  grill #43) is linked from the public landing page. */
export function isPublicTool(pathname: string): boolean {
  return (
    pathname === '/tools/loan-check' ||
    pathname.startsWith('/tools/loan-check/') ||
    pathname === '/rbi-decision' ||   // audit 80+ A19: the public MPC page
    pathname === '/glossary' ||
    isCantPay(pathname)
  );
}

/** Can't pay (Audit 80 A17/B3): its rules and blank letters are public, like
 *  Loan Check; it personalises itself only when a saved profile exists. */
export function isCantPay(pathname: string): boolean {
  return pathname === '/cant-pay' || pathname.startsWith('/cant-pay/');
}

/** The privacy notice and terms (grill #51), readable before signing in
 *  (DPDP Act s.5: the notice comes before consent), and "Your data", which
 *  also lets a guest clear this browser; it checks the session itself. */
export function isPublicPage(pathname: string): boolean {
  return pathname === '/privacy' || pathname === '/terms' || pathname === '/account';
}

export const config = {
  matcher: [
    '/((?!(?:login|api|art)(?:/|$)|_next/static|_next/image|welcome\\.html$|favicon\\.ico$|icon\\.svg$|robots\\.txt$|sitemap\\.xml$|manifest\\.webmanifest$|og\\.png$|apple-touch-icon\\.png$|apple-icon\\.png$|icon-(?:192|512|maskable-512)\\.png$|og-loan-check\\.png$|\\.well-known/|fonts/).*)',
  ],
};

