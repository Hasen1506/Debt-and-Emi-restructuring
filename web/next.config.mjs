// Single-service deploy (Dockerfile, render.yaml `rightdue`): FastAPI runs in
// the same container and Next.js proxies the API paths to it, so the browser
// only ever talks to one origin and only one service has to wake up.
// Read at build time: rewrites are written into the build's route manifest.
import { assertAuthEnabledForProduction } from './auth-guard.mjs';
import { headerRules } from './security-headers.mjs';

// Grill #66: never build a production bundle with sign-in switched off.
assertAuthEnabledForProduction(process.env);

const API_INTERNAL_URL = (process.env.API_INTERNAL_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework (X-Powered-By), grill #58.
  poweredByHeader: false,
  typedRoutes: false,
  // The Docker image runs the minimal standalone server (smaller and lighter
  // on the 512 MB free plan). Off elsewhere so `next start` (CI, E2E, local)
  // behaves as before.
  ...(process.env.NEXT_OUTPUT_STANDALONE === '1' ? { output: 'standalone' } : {}),
  experimental: {
    // Proxied API calls (a KFS PDF read, a first plan on a cold CPU) may take
    // longer than the 30 s default; matches the /api/session proxy's 60 s.
    proxyTimeout: 60000,
  },
  // `fallback` rewrites run only after every page, route handler and public
  // file has been checked, so Next's own /api/session/* and
  // /api/holdings/quote still win and every other /api/* path (including
  // /api/health, which the Render health check uses) reaches FastAPI.
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [{ source: '/api/:path*', destination: `${API_INTERNAL_URL}/api/:path*` }],
    };
  },
  // CSP, frame-ancestors and hardening headers on every page (grill #58).
  async headers() {
    return headerRules(process.env);
  },
  // Old addresses keep working after the five-tab redesign (docs/history/REDESIGN.md).
  async redirects() {
    return [
      { source: '/insights', destination: '/activity', permanent: false },
      { source: '/insights/:path*', destination: '/activity/:path*', permanent: false },
      { source: '/onboarding/assets', destination: '/profile/assets', permanent: false },
      // Open positions are on Home since R2.
      { source: '/debts', destination: '/#positions', permanent: false },
      // Plan decisions are rows in Activity's history since R4.
      { source: '/decisions', destination: '/activity', permanent: false },
      { source: '/tools', destination: '/goals#tools', permanent: false },
      // Roadmap PR I: Big purchase is a mode of New debt check; Right time is retired.
      { source: '/tools/purchase', destination: '/tools/new-debt?mode=purchase', permanent: false },
      { source: '/tools/right-time', destination: '/tools/new-debt', permanent: false },
      // Tax is Profile's "Where you live and tax" section since V5. A
      // server redirect, not a page that redirects while rendering:
      // Firefox aborted that navigation midway.
      { source: '/tax', destination: '/profile#pf-tax', permanent: false },
    ];
  },
};

export default nextConfig;
