import type { MetadataRoute } from 'next';
import { PUBLIC_PAGES, SITE } from '@/lib/site';

/** UX50 E-13: the five public pages. /welcome.html is the landing's file
 *  name, so it's listed as / (its canonical). */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((p) => ({
    url: p === '/' ? `${SITE}/` : `${SITE}${p}`,
    changeFrequency: p === '/' || p === '/tools/loan-check' || p === '/rbi-decision' ? 'weekly' : 'monthly',
    priority: p === '/' ? 1 : p === '/tools/loan-check' ? 0.8 : 0.5,
  }));
}
