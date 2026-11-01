import type { NextConfig } from "next";

// The Content-Security-Policy is set per request in src/proxy.ts, because it carries a nonce.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // The proxy buffers request bodies in memory; cap that buffer just above the largest API body
    // (16 KB for CSP reports, 8 KB for banking actions). Routes refuse anything larger with 413.
    proxyClientMaxBodySize: "32kb",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
