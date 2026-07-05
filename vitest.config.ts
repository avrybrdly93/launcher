import { defineConfig } from "vitest/config";

export default defineConfig({
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
