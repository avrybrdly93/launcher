import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Pinned to this file's directory (rather than left to default to cwd) so
// `pnpm -r test` -- which runs each package's `vitest run` from inside that
// package's own directory -- resolves the same repo-root-relative `include`
// glob as running `pnpm test` from the repo root.
const repoRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: repoRoot,
  test: {
    include: ["packages/*/src/**/*.test.{ts,tsx}"],
    environment: "node",
    // --expose-gc lets zero-allocation hot-path tests (e.g. P1.21) force a
    // collection and measure heapUsed deltas deterministically.
    poolOptions: {
      threads: { execArgv: ["--expose-gc"] },
      forks: { execArgv: ["--expose-gc"] },
    },
  },
});
