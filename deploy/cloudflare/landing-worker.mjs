/**
 * RightDue instant landing page (grill #49). A Cloudflare Worker on the
 * free plan, routed ONLY to `rightdue.app/` and `rightdue.app/welcome.html`.
 *
 * Render's free instance sleeps after 15 minutes idle and takes about a
 * minute to wake (https://render.com/docs/free). A first-time visitor to a
 * finance site should not stare at a spinner, so for signed-out visitors:
 *
 *   1. welcome.html comes straight from Cloudflare's edge cache (no Render);
 *   2. in the background the Worker pings /api/health, so Render is already
 *      waking while the visitor reads; by the time they click "Start" the
 *      app is up;
 *   3. a cached copy older than REFRESH_AFTER_S is refreshed in the
 *      background (stale-while-revalidate), so a deploy shows within about
 *      an hour of traffic; copies are kept up to KEEP_S.
 *
 * Signed-in visitors (a session cookie), other methods, and any query
 * string (e.g. a ?country= toggle) pass straight through to the app.
 * The cache key includes the visitor's country bucket (IN / US / other)
 * so a country-aware landing (grill #1) stays correct.
 *
 * Audit 80+ D20: while a Free service is spun down, Render answers
 * /robots.txt itself with "User-agent: * / Disallow: /" and the request never
 * reaches the app (https://render.com/docs/free, "Automatic robots.txt
 * responses", read 14 Oct 2026). A crawler that mostly sees that indexes
 * slowly or drops the site. So the Worker also answers /robots.txt and
 * /sitemap.xml itself, from the same lists as web/src/app/robots.ts and
 * web/src/app/sitemap.ts (web/tests/a80-w08-trust.cjs keeps them equal). These
 * two never touch Render and never wake it, so crawlers cost no instance hours.
 *
 * Not deployed by this repo: see DEPLOY.md, "Instant landing page".
 */
export const LANDING_PATHS = new Set(['/', '/welcome.html']);
// L1 renames the cookie (finoptima_session -> rightdue_session) with a
// one-release migration; either one means "signed in".
export const SESSION_COOKIES = ['rightdue_session', 'finoptima_session'];
export const REFRESH_AFTER_S = 3600;
export const KEEP_S = 7 * 24 * 3600;
const STORED_AT = 'x-rightdue-landing-stored-at';

// Mirrors of web/src/lib/site.ts (SITE, PUBLIC_PAGES) and the disallow list in
// web/src/app/robots.ts. Change all three together (the web test checks).
export const SITE = 'https://rightdue.app';
export const PUBLIC_PAGES = ['/', '/tools/loan-check', '/rbi-decision', '/glossary', '/privacy', '/terms'];  // W4 A19 MPC page
export const ROBOTS_DISALLOW = ['/api/', '/plan', '/profile', '/activity', '/account', '/goals', '/portfolio', '/onboarding', '/cant-pay', '/tax', '/login', '/welcome.html'];
export const CRAWL_PATHS = new Set(['/robots.txt', '/sitemap.xml']);

export function robotsTxt() {
  return [
    'User-Agent: *',
    ...PUBLIC_PAGES.map((p) => `Allow: ${p}`),
    ...ROBOTS_DISALLOW.map((p) => `Disallow: ${p}`),
    '',
    `Host: ${SITE}`,
    `Sitemap: ${SITE}/sitemap.xml`,
    '',
  ].join('\n');
}

export function sitemapXml() {
  const rows = PUBLIC_PAGES.map((p) => {
    const loc = p === '/' ? `${SITE}/` : `${SITE}${p}`;
    const freq = p === '/' || p === '/tools/loan-check' || p === '/rbi-decision' ? 'weekly' : 'monthly';
    const priority = p === '/' ? 1 : p === '/tools/loan-check' ? 0.8 : 0.5;
    return `<url>\n<loc>${loc}</loc>\n<changefreq>${freq}</changefreq>\n<priority>${priority}</priority>\n</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`;
}

export function crawlResponse(request) {
  const url = new URL(request.url);
  if (!(request.method === 'GET' || request.method === 'HEAD') || !CRAWL_PATHS.has(url.pathname)) return null;
  const isRobots = url.pathname === '/robots.txt';
  const body = isRobots ? robotsTxt() : sitemapXml();
  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'Content-Type': isRobots ? 'text/plain; charset=utf-8' : 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'X-RightDue-Edge': 'crawl',
    },
  });
}

export function hasSession(cookieHeader) {
  if (!cookieHeader) return false;
  return cookieHeader.split(';').some((part) => {
    const [name, ...rest] = part.trim().split('=');
    return SESSION_COOKIES.includes(name) && rest.join('=').length > 0;
  });
}

export function countryBucket(country) {
  return country === 'IN' || country === 'US' ? country : 'XX';
}

export function servesFromEdge(request) {
  const url = new URL(request.url);
  return (request.method === 'GET' || request.method === 'HEAD')
    && LANDING_PATHS.has(url.pathname)
    && url.search === ''
    && !hasSession(request.headers.get('Cookie'));
}

export function cacheKey(request) {
  const url = new URL(request.url);
  return new Request(`${url.origin}/__rightdue_landing/${countryBucket(request.cf?.country)}`);
}

function isCacheable(res) {
  return res.status === 200
    && (res.headers.get('Content-Type') || '').includes('text/html')
    && !res.headers.get('Set-Cookie');
}

async function store(cache, key, res, nowMs) {
  const copy = new Response(res.body, res);
  copy.headers.set('Cache-Control', `public, max-age=0, s-maxage=${KEEP_S}`);
  copy.headers.set(STORED_AT, String(nowMs));
  await cache.put(key, copy);
}

async function fromOrigin(request) {
  // Pass the visitor's own request (cookies, Accept-Language) to the app.
  return fetch(request, { cf: { cacheTtl: 0 } });
}

export default {
  async fetch(request, env, ctx, now = Date.now) {
    const crawl = crawlResponse(request);
    if (crawl) return crawl;
    if (!servesFromEdge(request)) return fetch(request);
    const origin = new URL(request.url).origin;
    // Start waking Render now, whatever happens next.
    ctx.waitUntil(fetch(`${origin}/api/health`, { cf: { cacheTtl: 0 } }).catch(() => {}));

    const cache = caches.default;
    const key = cacheKey(request);
    const hit = await cache.match(key);
    if (hit) {
      const age = (now() - Number(hit.headers.get(STORED_AT) || 0)) / 1000;
      if (age > REFRESH_AFTER_S) {
        ctx.waitUntil(fromOrigin(request.clone())
          .then((res) => (isCacheable(res) ? store(cache, key, res, now()) : undefined))
          .catch(() => {}));
      }
      const out = new Response(hit.body, hit);
      out.headers.set('Cache-Control', 'no-cache');
      out.headers.set('X-RightDue-Edge', age > REFRESH_AFTER_S ? 'stale' : 'hit');
      out.headers.delete(STORED_AT);
      return out;
    }

    // Nothing cached at this edge yet: this one visitor waits, as today.
    const res = await fromOrigin(request);
    if (isCacheable(res)) {
      ctx.waitUntil(store(cache, key, res.clone(), now()));
      const out = new Response(res.body, res);
      out.headers.set('X-RightDue-Edge', 'miss');
      return out;
    }
    return res;
  },
};
