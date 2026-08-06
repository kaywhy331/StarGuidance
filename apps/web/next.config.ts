import type { NextConfig } from "next";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  `connect-src 'self'${process.env.NODE_ENV === "development" ? " ws: http:" : ""}`,
  "media-src 'self'",
  "manifest-src 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(), payment=()" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  env: {
    // Netlify exposes COMMIT_REF at build time only, and its serverless
    // functions do not receive netlify.toml values at runtime, so the commit is
    // inlined here. Staging verification uses it to prove the deploy preview it
    // is testing was built from the commit under test rather than an earlier
    // one; the health endpoint withholds it outside staging.
    DEPLOYED_COMMIT_REF: process.env.COMMIT_REF ?? "",
  },
  experimental: {
    typedEnv: true,
  },
  headers: async () => [
    { source: "/:path*", headers: securityHeaders },
    {
      source: "/api/:path*",
      headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
    },
  ],
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    "@starguidance/ai",
    "@starguidance/contracts",
    "@starguidance/database",
    "@starguidance/design-system",
    "@starguidance/reading-machine",
    "@starguidance/tarot-content",
    "@starguidance/tarot-domain",
  ],
};

export default nextConfig;
