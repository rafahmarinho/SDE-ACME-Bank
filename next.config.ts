import type { NextConfig } from "next";

// Also allow the configured Supabase origin (local stack or custom domain), not only *.supabase.co.
const supabaseOrigin = (() => {
  try {
    const { origin } = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return `${origin} ${origin.replace(/^http/, "ws")}`;
  } catch {
    return "";
  }
})();

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
          {
            key: "Content-Security-Policy",
            value:
              `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' ${process.env.NODE_ENV === "development" ? "'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://images.unsplash.com; font-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co ${supabaseOrigin}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`,
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
