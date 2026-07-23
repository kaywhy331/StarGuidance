import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
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
