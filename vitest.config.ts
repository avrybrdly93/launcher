import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Fixed to the config file's own directory (not cwd) so `pnpm -r test` works:
// pnpm invokes each package's `vitest run` from inside that package's
// directory, and a cwd-relative include glob would then resolve against
// packages/engine/packages/*/src/... and find nothing.
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
