/**
 * UX50 E-07: the "Report a problem" link. A mailto with the page and the
 * build, never any figures (the body has only what the user types).
 */
// Audit 80 B9: a role mailbox, not the founder's name. FOUNDER: create the
// support@ alias (forwarding to the same inbox) before this ships.
export const SUPPORT_EMAIL = 'support@rightdue.app';

export function reportProblemHref(path: string, version?: string | null): string {
  // Only the path: a query string can carry figures (e.g. ?amount=).
  const page = (path || '/').split(/[?#]/)[0].slice(0, 120);
  const v = (version || '').replace(/[^0-9a-f]/gi, '').slice(0, 7) || 'unknown';
  const subject = `RightDue problem on ${page}`;
  const body = `What happened:\n\n\n(Page: ${page}, version: ${v})`;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
