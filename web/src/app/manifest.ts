import type { MetadataRoute } from 'next';

/** UX50 E-16: installable from the home screen; served without sign-in
 *  (excluded from the middleware matcher). Paper and ink from the palette. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RightDue',
    short_name: 'RightDue',
    description: 'What to pay, on which loan, this month.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#fbfaf3',
    theme_color: '#fbfaf3',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
