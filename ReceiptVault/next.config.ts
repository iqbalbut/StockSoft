import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Native / WASM packages stay outside the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "sharp", "pg"],
  experimental: { serverActions: { bodySizeLimit: "50mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
