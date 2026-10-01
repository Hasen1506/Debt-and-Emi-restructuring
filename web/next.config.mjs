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
    ];
  },
};

export default nextConfig;
