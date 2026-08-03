import type { NextConfig } from "next";

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
