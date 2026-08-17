import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run ships the traced server and its runtime dependencies without
  // carrying the source tree or a package manager in the final image.
  output: "standalone",
};

export default nextConfig;
