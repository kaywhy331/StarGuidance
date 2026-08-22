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
    // REVIEW_ID is also build-only. Inline only its non-secret identifier for
    // deploy previews so server code can derive a per-site/per-PR guest key
    // without permitting that fallback in branch deploys or production.
    GUEST_TRIAL_PREVIEW_ID:
      process.env.CONTEXT === "deploy-preview" ? (process.env.REVIEW_ID ?? "") : "",
    // A production build gets a separate non-secret marker. Runtime still has
    // to prove APP_ENV=production, a valid Netlify SITE_ID, and a valid managed
    // encryption root before the production guest subroot can be derived.
    GUEST_TRIAL_PRODUCTION_BUILD:
      process.env.CONTEXT === "production" ? "netlify-production-v1" : "",
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
  // PDFKit resolves its standard-font metrics from package data at runtime.
  // Keeping it as a Node dependency lets Next/Netlify trace those AFM assets;
  // bundling the module made the production route fall into its JSON error
  // response even though the same renderer passed in Vitest.
  serverExternalPackages: ["pdfkit"],
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
