import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright";
import { build, preview, type PreviewServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { tryLaunch, type BrowserTarget } from "./e2e-browser.js";
import { chromium } from "playwright";
import {
  SUPPRESSIBLE_FEATURES,
  enumerateSuppressionCombinations,
  suppressionInitScript,
  type SuppressibleFeatureId,
  type SuppressionCombination,
} from "./progressive-enhancement-matrix.js";

/**
 * P7.29's browser half: the real, built app loaded once per cell of the
 * suppression matrix, with every combination of no-WASM, no-GPU and no-SAB
 * applied before a single line of application code runs.
 *
 * **The criterion is "all combinations functional", so "functional" is asserted
 * and not inferred.** A page that loads without throwing is not evidence the
 * app works — every route in this app renders its shell before it has solved
 * anything, so a suite that waited for a selector would stay green through a
 * totally broken integrator. Each cell therefore requires a *result*: the
 * simulator must report a trajectory with a positive point count and a positive
 * flight time (a solve actually ran), and the Monte Carlo route's capability
 * panel must resolve to a headline rather than sitting on its "detecting"
 * line (the async probe completed rather than hanging, which is the failure a
 * missing `navigator.gpu` would most plausibly cause).
 *
 * **Every cell is shown to bite before anything about the app is asserted.**
 * The suppressions are strings evaluated in the page, and a string that
 * silently did nothing would leave eight green cells all exercising the same
 * one. So each page is asked, in-page, whether the features are actually gone,
 * and the assertion that they are comes first. `navigator.gpu` is the concrete
 * reason this matters: it is an accessor on `Navigator.prototype`, so `delete
 * navigator.gpu` succeeds and removes nothing.
 *
 * **The baseline cell is in the matrix, not beside it.** With no suppressions it
 * is the control: if it fails along with the other seven, the suite is
 * reporting a broken app rather than a broken fallback path, and a matrix with
 * no control cannot tell those two apart.
 *
 * **Chromium only, deliberately, and the reason is not convenience.** This
 * suite's subject is the app's behaviour when a platform feature is *absent*,
 * and it produces that absence itself rather than relying on the browser to
 * lack it. Running the same eight cells in a second engine would multiply the
 * wall clock of a build-and-preview suite by two to re-test suppression
 * scripts that do not vary by engine. `app.e2e.test.ts` and
 * `app-routes.e2e.test.ts` remain the cross-engine coverage; this one is the
 * cross-*capability* coverage. Firefox has no binary in this container either
 * way, and a cell that silently skipped would be a coverage claim with nothing
 * behind it.
 */

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CHROMIUM_TARGET: BrowserTarget = { name: "chromium", type: chromium };

let server: PreviewServer;
let appUrl: string;
let outDir: string;
let browser: Browser | undefined;

/**
 * Which of the three features this browser offers with NO suppression applied.
 *
 * Measured rather than assumed, and it is the most important number this suite
 * produces about itself. A suppression for a feature the browser does not have
 * is a no-op, and its absence probe then passes for a reason the script had
 * nothing to do with -- the cell runs, and it tests nothing it claims to. This
 * container is a live example: on the preview server's own origin, headless
 * Chromium here exposes `WebAssembly` and `navigator.gpu` but NOT
 * `SharedArrayBuffer`, since the preview server sends no COOP/COEP headers. So
 * two of the three suppressions bite here and `no-SAB` is the no-op.
 *
 * **The measurement is taken on the page under test, and that is not an
 * incidental detail.** Run against `about:blank` in this same container, the
 * identical probes report `navigator.gpu` as `undefined` -- absent from the
 * instance and from `Navigator.prototype` alike -- while the app's own
 * `http://127.0.0.1` origin exposes it. A native-availability figure taken on a
 * blank page would have understated this suite's real coverage by a third and
 * would have looked entirely reasonable. Probe the origin the app runs on.
 *
 * So the matrix's eight cells are always eight real page loads of the app with
 * the fallback path exercised, but the number of *suppressions that changed
 * anything* is a property of the machine. It is measured here, asserted on
 * below, and printed, so a run's coverage claim is the measured one rather than
 * the hoped-for one.
 */
let nativelyPresent: readonly SuppressibleFeatureId[] = [];

beforeAll(async () => {
  outDir = mkdtempSync(path.join(tmpdir(), "ballista-app-pe-"));
  const configFile = path.join(appRoot, "vite.config.ts");
  await build({
    root: appRoot,
    configFile,
    logLevel: "warn",
    build: { outDir, emptyOutDir: true },
  });
  server = await preview({
    root: appRoot,
    configFile,
    logLevel: "warn",
    build: { outDir },
    preview: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  const address = server.resolvedUrls?.local[0];
  if (!address) throw new Error("vite preview server did not report a local URL");
  appUrl = address;

  browser = await tryLaunch(CHROMIUM_TARGET);
  if (!browser) {
    console.warn(
      "[progressive-enhancement.e2e] Skipping: no usable Chromium binary in this environment (expected in CI, which installs it explicitly).",
    );
    return;
  }

  // The native baseline, taken on a page with no init script at all.
  const probePage = await browser.newPage();
  try {
    await probePage.goto(appUrl);
    const present: SuppressibleFeatureId[] = [];
    for (const feature of SUPPRESSIBLE_FEATURES) {
      const absent = await probePage.evaluate<boolean, string>(
        (probe) => Boolean(new Function(`return (${probe});`)()),
        feature.absenceProbe,
      );
      if (!absent) present.push(feature.id);
    }
    nativelyPresent = present;
    console.warn(
      `[progressive-enhancement.e2e] natively present here: ${
        present.length === 0 ? "(none)" : present.join(", ")
      }; the other suppressions are no-ops in this environment.`,
    );
  } finally {
    await probePage.close();
  }
  // P0.106's 180 s, for the same reason app.e2e.test.ts carries it: this hook
  // vite-builds the app and launches a browser, and under the full parallel
  // suite that class of hook has been measured well past the 60 s default while
  // passing standalone minutes later.
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server.httpServer.close((err) => (err ? reject(err) : resolve())),
    );
  }
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

/**
 * A page with `combination`'s suppressions installed, plus a recorder for
 * anything the page throws.
 *
 * `addInitScript` runs before any page script, which is the only ordering that
 * tests what this task is about: a feature removed *after* the app booted would
 * be testing teardown, not progressive enhancement. The baseline cell installs
 * an empty script rather than skipping the call, so all eight cells take the
 * identical path.
 */
async function openCell(
  live: Browser,
  combination: SuppressionCombination,
): Promise<{ page: Page; pageErrors: string[] }> {
  const page = await live.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(suppressionInitScript(combination));
  return { page, pageErrors };
}

/** Asserts, in the page, that every feature this cell suppresses is actually gone. */
async function assertSuppressionsBit(page: Page, combination: SuppressionCombination) {
  for (const feature of combination.features) {
    const absent = await page.evaluate<boolean, string>(
      (probe) => Boolean(new Function(`return (${probe});`)()),
      feature.absenceProbe,
    );
    expect(
      absent,
      `${feature.label}: suppression script ran but the feature is still reachable`,
    ).toBe(true);
  }
}

async function readRunStatus(page: Page): Promise<{ points: number; duration: number }> {
  await page.waitForSelector('[data-testid="run-status"]');
  const text = await page.locator('[data-testid="run-status"]').textContent();
  const match = text?.match(/Trajectory: (\d+) points, T=([\d.]+)s/);
  if (!match) throw new Error(`run-status did not match the expected shape: "${text}"`);
  return { points: Number(match[1]), duration: Number(match[2]) };
}

const COMBINATIONS = enumerateSuppressionCombinations();

describe("P7.29 progressive-enhancement matrix (chromium)", () => {
  it("covers all eight cells, so a dropped cell fails here and not only in review", () => {
    expect(COMBINATIONS).toHaveLength(8);
  });

  it("has at least one suppression that genuinely bites here, so the matrix is not vacuous", async () => {
    if (!browser) return;
    // Without this, a browser that happened to lack all three features would
    // run eight green cells while every absence probe passed for a reason no
    // suppression script caused -- a coverage claim with nothing behind it. The
    // assertion is deliberately "at least one" rather than "all three": whether
    // a given browser HAS a feature is not something this suite can fix, and
    // failing a run for it would be failing the machine, not the code.
    expect(
      nativelyPresent.length,
      "no suppressible feature is natively present in this browser, so every absence probe passes vacuously",
    ).toBeGreaterThan(0);
  });

  it("actually removes every feature this browser does have", async () => {
    if (!browser) return;
    for (const feature of SUPPRESSIBLE_FEATURES) {
      if (!nativelyPresent.includes(feature.id)) continue;
      const cell = COMBINATIONS.find(
        (combination) =>
          combination.features.length === 1 && combination.features[0]?.id === feature.id,
      );
      if (!cell) throw new Error(`no single-feature cell for ${feature.id}`);
      const { page } = await openCell(browser, cell);
      try {
        await page.goto(appUrl);
        // The feature was present on the probe page and must be absent here;
        // that pair is the only thing that shows the script did the removing.
        await assertSuppressionsBit(page, cell);
      } finally {
        await page.close();
      }
    }
  }, 120_000);

  for (const combination of COMBINATIONS) {
    describe(combination.name, () => {
      it("suppresses what it claims to, then still solves the default scenario", async () => {
        if (!browser) return;
        const { page, pageErrors } = await openCell(browser, combination);
        try {
          await page.goto(appUrl);
          await assertSuppressionsBit(page, combination);

          await page.waitForSelector('[data-testid="world-canvas"]');
          const { points, duration } = await readRunStatus(page);
          // A result, not a render: the integrator produced a trajectory.
          expect(points).toBeGreaterThan(0);
          expect(duration).toBeGreaterThan(0);
          expect(pageErrors).toStrictEqual([]);
        } finally {
          await page.close();
        }
      }, 120_000);

      it("resolves the compute-capability probe to a headline rather than hanging on it", async () => {
        if (!browser) return;
        const { page, pageErrors } = await openCell(browser, combination);
        try {
          await page.goto(`${appUrl}#/monte-carlo`);
          await assertSuppressionsBit(page, combination);

          await page.waitForSelector('[data-testid="monte-carlo-route"]');
          // The panel renders its "detecting" line first and replaces it when
          // the async probe settles. Waiting for the headline is therefore the
          // assertion that the probe COMPLETED -- on a machine with no GPU as
          // much as on one with, which is `probeWebGpu`'s stated contract and
          // the thing most likely to break when `navigator.gpu` is absent.
          await page.waitForSelector('[data-testid="capability-headline"]');
          expect(await page.locator('[data-testid="capability-pending"]').count()).toBe(0);
          const headline = await page.locator('[data-testid="capability-headline"]').textContent();
          expect(headline?.trim().length ?? 0).toBeGreaterThan(0);
          expect(pageErrors).toStrictEqual([]);
        } finally {
          await page.close();
        }
      }, 120_000);

      it("runs a Monte Carlo study to a range estimate", async () => {
        if (!browser) return;
        const { page, pageErrors } = await openCell(browser, combination);
        try {
          await page.goto(`${appUrl}#/monte-carlo`);
          await assertSuppressionsBit(page, combination);

          await page.waitForSelector('[data-testid="mc-run"]:not([disabled])');
          await page.locator('[data-testid="mc-run"]').click();
          await page.waitForSelector('[data-testid="mc-estimate"]');
          const estimate = await page.locator('[data-testid="mc-range-estimate"]').textContent();
          // An ensemble is the workload Phase 7's GPU path exists to
          // accelerate, so it is the one whose CPU fallback has to be shown
          // working in every cell.
          expect(estimate).toMatch(/\d/);
          expect(pageErrors).toStrictEqual([]);
        } finally {
          await page.close();
        }
      }, 120_000);
    });
  }

  it("reports a GPU-free plan when navigator.gpu is suppressed, and says why", async () => {
    if (!browser) return;
    const noGpu = COMBINATIONS.find((combination) => combination.name === "no-GPU");
    if (!noGpu) throw new Error("the no-GPU cell is missing from the matrix");
    const { page } = await openCell(browser, noGpu);
    try {
      await page.goto(`${appUrl}#/monte-carlo`);
      await assertSuppressionsBit(page, noGpu);
      await page.waitForSelector('[data-testid="capability-headline"]');
      // Functional is the criterion, but a fallback that ran while telling the
      // user it was on the GPU would satisfy "functional" and be a lie. The
      // panel has to name the CPU plan and carry the unsupported explanation.
      //
      // This one bites in this container: `navigator.gpu` IS exposed on the
      // preview origin, so the panel would report the GPU plan without the
      // suppression and reports the CPU one with it. On a browser with no
      // WebGPU at all the cell becomes indistinguishable from `baseline` and
      // the assertion holds for a reason the suppression did not cause -- which
      // is what the natively-present measurement above exists to make visible
      // rather than leave as an assumption. What no cell here ever does is
      // establish something about a machine that can actually RUN a GPU
      // kernel; that is P7.20's, and it needs hardware.
      expect(await page.locator('[data-testid="capability-webgpu-unsupported"]').count()).toBe(1);
      expect(await page.locator('[data-testid="capability-webgpu-supported"]').count()).toBe(0);
      const headline = await page.locator('[data-testid="capability-headline"]').textContent();
      expect(headline).toContain("CPU");
      const reason = await page.locator('[data-testid="capability-plan-reason"]').textContent();
      expect(reason?.trim().length ?? 0).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  }, 120_000);
});
