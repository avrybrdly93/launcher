import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { build, preview, type PreviewServer } from "vite";
import type { SweepJob } from "@ballista/runtime";
import { PRESET_SCENARIOS, type ScenarioSpec } from "@ballista/engine";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SweepPoolTestResult } from "./worker-pool-harness/main.js";

// Real-browser validation of P3.39's criterion ("11x11 (theta,v0) sweep
// runs off-main; UI interactive throughout (long-task probe < 50 ms)"): a
// real Worker's off-main-thread execution is fundamentally not something
// jsdom (no real threads) can demonstrate, so -- like canvas-viewport.test.ts
// and app-shell.responsive.test.ts -- this drives an actual Chromium page,
// here loading the dedicated worker-pool-harness entry rather than the app
// shell itself.

const SANDBOX_CHROMIUM_PATH = "/opt/pw-browsers/chromium";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const harnessRoot = path.join(appRoot, "src", "worker-pool-harness");

let browser: Browser;
let server: PreviewServer;
let harnessUrl: string;
let outDir: string;

beforeAll(async () => {
  outDir = mkdtempSync(path.join(tmpdir(), "ballista-worker-pool-"));
  const configFile = path.join(appRoot, "vite.config.ts");
  await build({
    root: harnessRoot,
    configFile,
    logLevel: "warn",
    build: { outDir, emptyOutDir: true },
  });
  server = await preview({
    root: harnessRoot,
    configFile,
    logLevel: "warn",
    build: { outDir },
    preview: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  const address = server.resolvedUrls?.local[0];
  if (!address) throw new Error("vite preview server did not report a local URL");
  harnessUrl = address;
  browser = await chromium.launch(
    existsSync(SANDBOX_CHROMIUM_PATH) ? { executablePath: SANDBOX_CHROMIUM_PATH } : {},
  );
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve, reject) =>
    server.httpServer.close((err) => (err ? reject(err) : resolve())),
  );
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

const DRAG_FREE = PRESET_SCENARIOS.find((s) => s.model.forceIds.length === 1)!;
const BASE_SCENARIO: ScenarioSpec = {
  ...DRAG_FREE,
  initialConditions: { ...DRAG_FREE.initialConditions, x0: 0, y0: 0 },
};

const SWEEP_JOB: SweepJob = {
  baseScenario: BASE_SCENARIO,
  thetaDegGrid: Array.from({ length: 11 }, (_, i) => 10 + i * 7),
  v0Grid: Array.from({ length: 11 }, (_, i) => 10 + i * 4),
};

describe("worker pool v1: 11x11 sweep runs off-main (P3.39 validation criterion)", () => {
  it("completes a real 121-point sweep through real Workers while the main thread stays interactive (long-task probe < 50 ms)", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(harnessUrl);
      await page.waitForFunction(() => "runSweepPoolTest" in window);

      const result: SweepPoolTestResult = await page.evaluate(
        (job) => window.runSweepPoolTest(job),
        SWEEP_JOB,
      );

      expect(result.rangeLength).toBe(121);
      expect(result.apexHeightLength).toBe(121);
      // The sweep itself must have taken measurable time (otherwise a
      // heartbeat gap bound proves nothing -- there'd be nothing to block
      // on); if this ever drops near 0 the scenario/grid needs beefing up,
      // not the assertion below loosening.
      expect(result.elapsedMs).toBeGreaterThan(5);
      expect(result.maxHeartbeatGapMs).toBeLessThan(50);
    } finally {
      await page.close();
    }
  });
});
