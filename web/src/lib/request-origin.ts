/**
 * Which browser origins may POST to the session proxy (BUG_REPORT M6).
 *
 * The old check rebuilt "our" origin from `req.nextUrl.protocol` and Host.
 * Behind Render/Cloudflare TLS ends at the proxy, so that was `http://…`
 * while the browser sent `Origin: https://rightdue.app`: every sign-in POST
 * was refused with 403 unless WEB_ORIGIN was set by hand, and a site
 * reachable on two hosts always failed on one of them.
 *
 * Now: WEB_ORIGIN may list several origins (comma-separated). Without it,
 * the request's own origin is rebuilt from X-Forwarded-Proto/-Host (set by
 * the proxy in front of Next) before falling back to the URL and Host.
 */
export interface OriginHeaders {
  get(name: string): string | null;
}

function normalise(origin: string): string | null {
  try {
    const u = new URL(origin.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

const first = (v: string | null) => (v ?? '').split(',')[0].trim();

export function allowedOrigins(
  webOriginEnv: string | undefined,
  headers: OriginHeaders,
  urlProtocol: string,
  urlHost: string,
): string[] {
  if (webOriginEnv && webOriginEnv.trim()) {
    return webOriginEnv.split(',').map(normalise).filter((o): o is string => o !== null);
  }
  const out = new Set<string>();
  const host = first(headers.get('x-forwarded-host')) || first(headers.get('host')) || urlHost;
  const proto = first(headers.get('x-forwarded-proto')).replace(/:$/, '');
  if (proto && host) {
    const o = normalise(`${proto}://${host}`);
    if (o) out.add(o);
  }
  const fallback = normalise(`${urlProtocol.replace(/:$/, '')}://${first(headers.get('host')) || urlHost}`);
  if (fallback) out.add(fallback);
  return [...out];
}

export function isAllowedOrigin(origin: string | null, allowed: string[]): boolean {
  if (!origin) return false;
  const o = normalise(origin);
  return o !== null && allowed.includes(o);
}

/** Every Set-Cookie header of a fetch response, not one comma-joined string. */
export function setCookieHeaders(headers: Headers): string[] {
  const h = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === 'function') return h.getSetCookie();
  const one = headers.get('set-cookie');
  return one ? [one] : [];
}
