/**
 * Which country's landing page a signed-out visitor sees first (sprint G10,
 * grill #1; founder: "sense where the user is from, and a toggle").
 *
 * Order: a country header a CDN in front of the app adds (Cloudflare's
 * CF-IPCountry, Vercel's x-vercel-ip-country, or a generic x-country-code),
 * then the region in the browser's Accept-Language ("en-US", "hi-IN"), then
 * India. Only IN and US have their own page; any other country gets India's
 * (the app's home market) with the toggle to switch.
 *
 * Nothing is stored about the visitor: the guess rides in a short-lived,
 * non-identifying cookie (rd_country=IN|US) that the static page reads,
 * and the visitor's own toggle choice (localStorage) always wins over it.
 */
export type LandingCountry = 'IN' | 'US';

export const LANDING_COUNTRY_COOKIE = 'rd_country';

type HeaderGet = { get(name: string): string | null };

export function senseCountry(headers: HeaderGet): LandingCountry {
  for (const h of ['cf-ipcountry', 'x-vercel-ip-country', 'x-country-code']) {
    const v = (headers.get(h) || '').trim().toUpperCase();
    if (v === 'US') return 'US';
    if (v === 'IN') return 'IN';
    if (/^[A-Z]{2}$/.test(v) && v !== 'XX' && v !== 'T1') return 'IN';
  }
  const lang = headers.get('accept-language') || '';
  // The first language with a region decides: "en-US,en;q=0.9" → US.
  for (const part of lang.split(',')) {
    const m = part.trim().match(/^[a-z]{2,3}-([a-z]{2})\b/i);
    if (!m) continue;
    const region = m[1].toUpperCase();
    if (region === 'US') return 'US';
    return 'IN';
  }
  return 'IN';
}
