import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  // Relative base: the build gets embedded at arbitrary subpaths (e.g.
  // aves-studios' /ballista/) as well as served from a domain root, so asset
  // URLs must resolve relative to wherever index.html ends up.
  base: "./",
  plugins: [preact()],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
