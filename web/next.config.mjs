/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  // Old addresses keep working after the five-tab redesign (REDESIGN.md).
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
    ];
  },
};

export default nextConfig;
