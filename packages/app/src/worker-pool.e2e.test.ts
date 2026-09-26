import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { build, preview, type PreviewServer } from "vite";
import type { McDashboardStudySpec, SweepJob } from "@ballista/runtime";
import { PRESET_SCENARIOS, uncertainScenarioSpecSchema, type ScenarioSpec } from "@ballista/engine";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McPoolTestResult, SweepPoolTestResult } from "./worker-pool-harness/main.js";

// Real-browser validation of P3.39's criterion ("11x11 (theta,v0) sweep
// runs off-main; UI interactive throughout (long-task probe < 50 ms)") and of
// P0.119's ("the dashboard study runs in a worker; the UI thread stays
// responsive under a 2048-replicate run"): a
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
  // P0.106: 180 s, not 60 s. This hook vite-builds the app and launches
  // Chromium; standalone it takes 2.3 s in this container, but under the
  // 254-file parallel suite the same class of hook has been measured at 48.6 s
  // (P4.38, canvas-viewport) and has crossed 60 s outright (app-shell.responsive,
  // 35th run) while passing standalone minutes later. 180 s is ~3.7x the slowest
  // standalone measurement on record, so a genuine hang still fails well before
  // vitest's own limits, while machine load alone no longer can. Ordinary unit
  // tests keep the 5 s default.
}, 180_000);

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

/**
 * The golf drive the dashboard runs, at the replicate count P0.119's criterion
 * names.
 *
 * Built here rather than imported from `monte-carlo-route.tsx` on purpose: that
 * module imports `@ballista/ui` and Preact, which this Node-side test has no
 * reason to pull in. The overlays are the route's own three, and
 * `monte-carlo-route.test.tsx` is what asserts the route's spec is valid and
 * varying -- this test's subject is the thread, not the study.
 */
const MC_GOLF_DRIVE = PRESET_SCENARIOS.find((scenario) =>
  scenario.model.forceIds.includes("magnus"),
)!;

const MC_CRITERION_REPLICATES = 2048;

const MC_STUDY_SPEC: McDashboardStudySpec = {
  study: uncertainScenarioSpecSchema.parse({
    schemaVersion: 1,
    base: {
      ...MC_GOLF_DRIVE,
      initialConditions: { ...MC_GOLF_DRIVE.initialConditions, x0: 0, y0: 0 },
    },
    overlays: [
      {
        path: "initialConditions.vx0",
        distribution: {
          kind: "normal",
          mean: MC_GOLF_DRIVE.initialConditions.vx0,
          stdDev: 1.5,
        },
      },
      {
        path: "initialConditions.vy0",
        distribution: {
          kind: "normal",
          mean: MC_GOLF_DRIVE.initialConditions.vy0,
          stdDev: 1.0,
        },
      },
      {
        path: "initialConditions.spin0",
        distribution: { kind: "normal", mean: 300, stdDev: 25 },
      },
    ],
    replicates: MC_CRITERION_REPLICATES,
    seed: 20260902,
  }),
  target: { kind: "point", center: [250, 0], tolerance: 15 },
};

describe("mc study runs off-main under the criterion's N (P0.119 validation criterion)", () => {
  it(`completes a real ${MC_CRITERION_REPLICATES}-replicate study through a real Worker while the main thread stays interactive (long-task probe < 50 ms)`, async () => {
    const page = await browser.newPage();
    try {
      await page.goto(harnessUrl);
      await page.waitForFunction(() => "runMcPoolTest" in window);

      const result: McPoolTestResult = await page.evaluate(
        (spec) => window.runMcPoolTest(spec),
        MC_STUDY_SPEC,
      );

      expect(result.replicates).toBe(MC_CRITERION_REPLICATES);
      expect(result.rangeLength).toBe(MC_CRITERION_REPLICATES);
      // The study must have taken measurably longer than the probe's own 50 ms
      // bound, or a heartbeat gap under 50 ms would prove nothing -- there
      // would be no interval long enough to stall in. Measured at ~320 ms for
      // this N in this container; if it ever falls below this floor, beef up
      // the study rather than loosening the assertion below.
      expect(result.elapsedMs).toBeGreaterThan(100);
      // THE ASSERTION WITHOUT WHICH THE NEXT ONE IS WORTHLESS, and this is
      // measured rather than argued: a main thread blocked for the study's
      // whole duration never runs a single `setInterval` callback, so the
      // probe's `gaps` array comes back empty and its max-of-empty fallback
      // reports 0 ms -- a perfect score, produced by the exact defect. Pointing
      // the harness at the synchronous `runMcDashboardStudy` passed every other
      // assertion here. A 10 ms heartbeat over `elapsedMs` should tick about
      // `elapsedMs / 10` times; a quarter of that is loose enough for a loaded
      // CI runner and still impossible for a blocked thread.
      expect(result.heartbeatTicks).toBeGreaterThan(result.elapsedMs / 40);
      expect(result.maxHeartbeatGapMs).toBeLessThan(50);
      // And the live estimates still arrive (P6.25) -- a worker that only
      // posted its final result would satisfy the probe above while silently
      // dropping the feature the dashboard was built around.
      expect(result.partialCount).toBeGreaterThan(1);
    } finally {
      await page.close();
    }
  }, 120_000);
});
