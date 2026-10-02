/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: false,
  },
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
    ];
  },
};

export default nextConfig;
