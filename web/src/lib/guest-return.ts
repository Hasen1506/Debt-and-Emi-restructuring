/**
 * First visit vs. a guest's saved data (live test #1, sprint L3).
 *
 * Signed out, the app keeps everything in this browser. The live test
 * opened rightdue.app and landed straight on someone's earlier guest plan,
 * with no way to tell it apart from a fresh start. Now, when a signed-out
 * visitor comes back to Home after a break and this browser holds a saved
 * profile, Home asks first: continue with it, or start fresh (which deletes
 * it from this browser, the same clean-up as signing out).
 *
 * Asked at most once per tab, and again only after `RETURN_AFTER_MS` away,
 * so moving around the app never brings it back.
 */

export const LAST_SEEN_KEY = 'rightdue_guest_last_seen';
export const ANSWERED_KEY = 'rightdue_guest_choice';
/** Away this long counts as coming back: 12 hours. */
export const RETURN_AFTER_MS = 12 * 60 * 60 * 1000;

export interface GuestReturnInput {
  /** Signed in to an account: never asked (the account holds the data). */
  signedIn: boolean;
  /** This browser holds a saved profile (not the demo). */
  hasSavedProfile: boolean;
  /** When this browser last showed the app to a guest, ms; null if never. */
  lastSeenMs: number | null;
  nowMs: number;
  /** Already answered in this tab. */
  answeredThisTab: boolean;
}

export function shouldAskGuest(i: GuestReturnInput): boolean {
  if (i.signedIn || !i.hasSavedProfile || i.answeredThisTab) return false;
  // Saved data with no visit on record: a browser that had the app before
  // this check existed, or someone else's session. Ask.
  if (i.lastSeenMs == null || !Number.isFinite(i.lastSeenMs)) return true;
  return i.nowMs - i.lastSeenMs >= RETURN_AFTER_MS;
}

/** "3 days ago", "yesterday", "earlier today": how long since the last visit. */
export function sinceLabel(lastSeenMs: number | null, nowMs: number): string | null {
  if (lastSeenMs == null || !Number.isFinite(lastSeenMs)) return null;
  const days = Math.floor((nowMs - lastSeenMs) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'earlier today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export const GUEST_COPY = {
  title: 'Welcome back',
  body: 'This browser has a plan saved from an earlier visit, without an account: its loans, income and payments. Is it yours?',
  cont: 'Continue with it',
  fresh: 'Start fresh',
  confirm: 'This deletes the saved plan from this browser. It cannot be undone. Start fresh?',
  confirmYes: 'Yes, delete it and start fresh',
  confirmNo: 'Keep it',
  note: 'Signed out, your plan lives only in this browser. Sign in to keep it in an account.',
};
