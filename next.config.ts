import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Production Docker / VPS images use the traced standalone server.
  output: "standalone",
  // Unset in normal dev and production. A second local server can set it to avoid sharing .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Local acceptance uses http://127.0.0.1:PORT while `next dev` binds as localhost.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
