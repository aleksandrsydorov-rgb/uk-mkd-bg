import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Production Docker / VPS images use the traced standalone server.
  output: "standalone",
};

export default nextConfig;
