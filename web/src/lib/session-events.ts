export const SESSION_CHANGED_EVENT = 'rightdue:session-changed';

export function notifySessionChanged(): void {
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}

/**
 * True on the sign-in page. It shows no account data and leaves with a full
 * page load once signed in (app/login/page.tsx), so it is never refreshed:
 * in Firefox that load cancels a refresh still in flight, Next falls back to
 * a browser navigation of /login itself, and that replaced the load. The
 * person was signed in but back on the sign-in form (CI run 38488716548,
 * account-persistence :61).
 */
export function onSignInPage(): boolean {
  return typeof window !== 'undefined' && window.location.pathname === '/login';
}
