/**
 * Cookies the browser sets for RightDue carry `Secure` on HTTPS (BUG_REPORT M9).
 *
 * The profile, activity and settings cookies are written from page scripts
 * (`document.cookie = ...`) in more than twenty places, so they cannot be
 * HttpOnly, and none of them said `Secure`: on any plain-HTTP request the
 * whole debt profile went out in clear text. Rather than edit every writer
 * (and miss the next one), the cookie setter is wrapped once at start-up and
 * adds `; Secure` whenever the page itself is served over HTTPS. Local
 * development over http://localhost keeps working unchanged.
 */

/** `cookie` with `; Secure` added when the page is HTTPS and it is not already there. */
export function withSecureFlag(cookie: string, protocol: string | undefined): string {
  if (protocol !== 'https:') return cookie;
  if (/;\s*secure\s*(;|$)/i.test(cookie)) return cookie;
  return `${cookie.replace(/;\s*$/, '')}; Secure`;
}

let installed = false;

/** Wrap `document.cookie`'s setter once. Safe to call more than once and on the server. */
export function installSecureCookieDefault(): boolean {
  if (installed) return true;
  if (typeof document === 'undefined' || typeof Document === 'undefined') return false;
  const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (!desc || !desc.set || !desc.get || !desc.configurable) return false;
  const { get, set } = desc;
  Object.defineProperty(Document.prototype, 'cookie', {
    configurable: true,
    enumerable: desc.enumerable,
    get() {
      return get.call(this);
    },
    set(value: string) {
      const protocol = typeof location !== 'undefined' ? location.protocol : undefined;
      set.call(this, withSecureFlag(String(value), protocol));
    },
  });
  installed = true;
  return true;
}
