/**
 * Route gate for dashboard pages.
 *
 * Before this middleware existed, every first-time visitor landed on a fully
 * populated dashboard backed by DEMO_USER — three fake loans, fake account
 * numbers, an effective APR they never entered. That looked like *their*
 * data and broke the mental model of "I need to set this up first".
 *
 * Now: if the `finoptima_user` cookie is missing, every dashboard route
 * redirects to `/onboarding`. Once the user finishes Setup the cookie is
 * written, the redirect stops firing, and they go to /debts to review
 * their entered data.
 */
import { NextResponse, type NextRequest } from 'next/server';

const PROFILE_COOKIE = 'finoptima_user';

export function middleware(req: NextRequest) {
  if (req.cookies.get(PROFILE_COOKIE)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/onboarding';
  url.search = '';
  return NextResponse.redirect(url);
}

// Match every page route EXCEPT /onboarding, Next.js internals, and static
// assets. The matcher uses Next's exclusion syntax so we don't have to list
// every dashboard route by name.
export const config = {
  matcher: [
    '/((?!onboarding|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
