/** Where "SAVE · OPEN MY PLAN" lands after onboarding. Home's pay line
 *  first, with a nudge on to the loans and then the plan. A full navigation
 *  (not router.push) so a cached pre-profile redirect can't send the user
 *  back to /onboarding. */
export const ONBOARDING_DONE_HREF = '/?first=1#home-pay';
