/** @type {import('next').NextConfig} */
const nextConfig = {
  // Kissinger GraphQL URL is consumed server-side only; expose it via
  // the KISSINGER_API_URL env var and do NOT prefix it with NEXT_PUBLIC_
  // so it is never leaked to the browser.
  experimental: {
    // Silence "Dynamic server usage" warnings caused by reading env vars.
    serverComponentsExternalPackages: [],
  },
};

export default nextConfig;
