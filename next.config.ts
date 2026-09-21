import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pins the workspace root to this project so Turbopack doesn't infer it
  // from an unrelated lockfile higher up the local filesystem tree.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
