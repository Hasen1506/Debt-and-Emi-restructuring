import type { MetadataRoute } from 'next';

/** UX50 E-13: the public pages are crawlable; the app and the API aren't. */

import { PUBLIC_PAGES, SITE } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: [...PUBLIC_PAGES],
        disallow: ['/api/', '/plan', '/profile', '/activity', '/account', '/goals', '/portfolio', '/onboarding', '/cant-pay', '/tax', '/login', '/welcome.html'],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
