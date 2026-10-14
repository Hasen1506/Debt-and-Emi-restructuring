/**
 * The one in-app privacy statement (Audit 80 B8). It was worded four ways
 * (Setup said "stay in this browser ... unless you sign in", though every
 * Setup user is signed in). Setup, Profile and the login page render this
 * component; the full notice (W8's /privacy) stays the source of detail.
 * The facts come from lib/privacy-facts STORAGE, so a region move changes
 * this line too.
 */
import { ACCOUNT_PATH, PRIVACY_PATH } from '@/lib/privacy-facts';

export const PRIVACY_PROMISE =
  'Saved to your RightDue account (a database in Singapore) and in this browser. Sent to our server only to work out your plan. Never sold or shared.';

export function PrivacyPromise({ style }: { style?: React.CSSProperties }) {
  return (
    <p data-testid="privacy-promise" style={{ margin: 0, lineHeight: 1.6, ...style }}>
      {PRIVACY_PROMISE} <a href={ACCOUNT_PATH}>Download or delete it</a> · <a href={PRIVACY_PATH}>privacy notice</a>
    </p>
  );
}
