// Response headers for every page (grill #58): a Content-Security-Policy and
// frame-ancestors so no other site can load RightDue in a frame (sign-in and
// money figures must never be framed, a "clickjacking" risk), plus the usual
// hardening headers. next.config.mjs `headers()` applies them in production
// builds; `next dev` sends none, so local preview tools keep working.
//
// A Content-Security-Policy (CSP) tells the browser which places a page may
// load scripts, styles, fonts and frames from. Anything else is blocked, so
// an injected script from another site cannot run or send data out.
//
// Why 'unsafe-inline' for scripts: Next.js App Router pages carry small
// inline scripts that hydrate the page, and public/welcome.html has one. A
// per-request nonce would remove the need, but it forces every page to be
// rendered on each request (no static pages) on a 512 MB free instance.
// Scripts from other origins are still blocked, 'unsafe-eval' is not
// allowed, and connect-src keeps data from being sent anywhere but here.
//
// Sources: Next.js "Content Security Policy" guide; Turnstile needs
// script-src and frame-src https://challenges.cloudflare.com
// (developers.cloudflare.com/turnstile/reference/content-security-policy,
// read 12 Oct 2026). Fonts come from Google Fonts (app/layout.tsx).

const TURNSTILE = 'https://challenges.cloudflare.com';

/** The API's origin when the browser calls it on another origin (a split
 *  deploy or the E2E run set an absolute NEXT_PUBLIC_API_BASE_URL; see
 *  src/lib/api-base.ts). Unset or relative: the page's own origin, 'self'. */
function apiOrigin(env) {
  const base = (env.NEXT_PUBLIC_API_BASE_URL || '').trim();
  if (!/^https?:\/\//i.test(base)) return [];
  try { return [new URL(base).origin]; } catch { return []; }
}

/** @param {Record<string, string | undefined>} env */
export function contentSecurityPolicy(env = process.env) {
  const turnstile = Boolean((env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '').trim());
  const directives = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", ...(turnstile ? [TURNSTILE] : [])],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
    'img-src': ["'self'", 'data:', 'blob:'],
    'connect-src': ["'self'", ...apiOrigin(env), ...(turnstile ? [TURNSTILE] : [])],
    'frame-src': turnstile ? [TURNSTILE] : ["'none'"],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    // UX50 E-09: inline event-handler attributes (onclick="…") never run;
    // React and welcome.html attach handlers in script, so nothing uses them.
    // This closes the commonest HTML-injection-to-script path even while
    // 'unsafe-inline' stays for Next's hydration scripts (see above).
    'script-src-attr': ["'none'"],
    'upgrade-insecure-requests': [],
  };
  return Object.entries(directives).map(([k, v]) => (v.length ? `${k} ${v.join(' ')}` : k)).join('; ');
}

// UX50 E-08: HSTS on every response, pages included (only /api/* had it).
// Two years, subdomains (send.rightdue.app is mail-only; www redirects over
// HTTPS) and preload, so the domain can be submitted at hstspreload.org.
export const HSTS = 'max-age=63072000; includeSubDomains; preload';

/** @param {Record<string, string | undefined>} env */
export function securityHeaders(env = process.env) {
  return [
    { key: 'Strict-Transport-Security', value: HSTS },
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(env) },
    // Older browsers that ignore frame-ancestors.
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ];
}

/** next.config.mjs headers(): pages and static files, not the /api/* paths
 *  (FastAPI sets its own stricter policy on those, api/security.py). */
export function headerRules(env = process.env) {
  if (env.NODE_ENV !== 'production') return [];
  return [
    { source: '/((?!api/).*)', headers: securityHeaders(env) },
    // Next's own /api routes (session, quote, healthz) and the FastAPI
    // replies proxied through it: HSTS only; the API sets its own CSP.
    { source: '/api/:path*', headers: [{ key: 'Strict-Transport-Security', value: HSTS }] },
  ];
}
