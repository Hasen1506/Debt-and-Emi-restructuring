/**
 * The app's own pages: the ones a signed-out visitor is sent to sign in
 * for (UX50 E-13 / A-14). Any other path a signed-out visitor asks for is
 * not a page at all (/cant-pay is public since Audit 80 A17, like Loan Check), so the middleware lets it through and Next answers
 * with the real 404 (app/not-found.tsx) instead of a sign-in wall.
 *
 * web/tests/ux50-f1-public-site.cjs checks this list against the page
 * folders in src/app, so a new page can't slip out from behind the gate.
 */
export const GATED_ROOTS = [
  'activity',
  'goals',
  'onboarding',
  'plan',
  'portfolio',
  'profile',
  'tax',
  'tools',
] as const;

/** Is this one of the app's own (sign-in) pages? `/` counts: signed out,
 *  it's rewritten to the landing before this is asked. */
export function isGatedAppPath(pathname: string): boolean {
  if (pathname === '/' || pathname === '') return true;
  const first = pathname.split('/')[1] ?? '';
  return (GATED_ROOTS as readonly string[]).includes(first);
}
