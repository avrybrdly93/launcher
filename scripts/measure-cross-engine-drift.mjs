// Cross-engine floating-point drift measurement (P2.45).
//
// Runs the identical deterministic fixture (scripts/cross-engine-drift-fixture.mjs)
// under Node and, via Playwright, under Chromium and Firefox, then compares
// every recorded trajectory sample against the Node reference. Per the
// blueprint's determinism contract (§2.6, §8.4 line ~1127/1131), engines are
// expected to agree to a *documented tolerance* (1e-13 relative) rather than
// bit-for-bit -- different JS engines may order/vectorize transcendental math
// (exp, pow, trig, used inside atmosphere density and drag) differently at
// the ULP level even for identical IEEE-754 double inputs.
//
// This is a *soft* check, matching the P2.43 benchmark script's philosophy:
// an engine whose drift exceeds the threshold prints a `::warning::`
// annotation but never fails the build (validation text: "test warns if
// exceeded", not "test fails"). A browser engine that isn't installed
// (common outside the real CI runner, e.g. a dev sandbox with only Chromium
// available) is skipped with a warning rather than crashing the script.
//
// Results are written to scripts/cross-engine-drift-results.json -- the
// "documented" half of the validation criterion -- so the measured numbers
// are a checked-in, reviewable artifact rather than only a transient CI log
// line.
//
// Requires packages/{engine,solverkit}/dist to already be built (`pnpm
// typecheck`, already a prior CI step), same precondition as P2.43's script.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as esbuild from "esbuild";

const rootDir = join(import.meta.dirname, "..");
const resultsPath = join(rootDir, "scripts", "cross-engine-drift-results.json");
const fixtureEntry = join(rootDir, "scripts", "cross-engine-drift-fixture.mjs");

const RELATIVE_DRIFT_THRESHOLD = 1e-13;
/** Below this magnitude, compare absolute rather than relative difference (avoids a divide-by-near-zero blowup, e.g. around the ground-impact y crossing). */
const RELATIVE_FLOOR = 1e-9;

const { computeDriftFixtureTrajectory } = await import(fixtureEntry);
const reference = computeDriftFixtureTrajectory();

const bundle = await esbuild.build({
  entryPoints: [fixtureEntry],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "__ballistaDrift",
  write: false,
});
const bundleCode = bundle.outputFiles[0].text;

function maxRelativeDrift(reference, sample) {
  if (reference.nSteps !== sample.nSteps) {
    return {
      maxDrift: Infinity,
      detail: `nSteps mismatch: ${reference.nSteps} vs ${sample.nSteps}`,
    };
  }
  let maxDrift = 0;
  let detail = "";
  const series = [reference.t, ...reference.channels];
  const sampleSeries = [sample.t, ...sample.channels];
  for (let s = 0; s < series.length; s++) {
    const a = series[s];
    const b = sampleSeries[s];
    for (let i = 0; i < a.length; i++) {
      const scale = Math.max(Math.abs(a[i]), RELATIVE_FLOOR);
      const drift = Math.abs(a[i] - b[i]) / scale;
      if (drift > maxDrift) {
        maxDrift = drift;
        detail = `series=${s === 0 ? "t" : `channel[${s - 1}]`} index=${i} reference=${a[i]} sample=${b[i]}`;
      }
    }
  }
  return { maxDrift, detail };
}

async function measureBrowserEngine(name, launcher) {
  let browser;
  try {
    browser = await launcher.launch();
  } catch (err) {
    console.warn(
      `::warning::${name} unavailable, skipping cross-engine drift check: ${err.message}`,
    );
    return { engine: name, status: "unavailable", reason: err.message };
  }
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><title>drift</title>");
    await page.addScriptTag({ content: bundleCode });
    const sample = await page.evaluate(() =>
      window.__ballistaDrift.computeDriftFixtureTrajectory(),
    );
    const version = browser.version();
    const { maxDrift, detail } = maxRelativeDrift(reference, sample);
    return { engine: name, status: "measured", version, maxRelativeDrift: maxDrift, detail };
  } finally {
    await browser.close();
  }
}

const { chromium, firefox } = await import("playwright");

const results = [];
for (const [name, launcher] of [
  ["chromium", chromium],
  ["firefox", firefox],
]) {
  results.push(await measureBrowserEngine(name, launcher));
}

console.log(
  `Cross-engine drift vs Node reference (threshold: relative drift < ${RELATIVE_DRIFT_THRESHOLD}):`,
);
const exceeded = [];
for (const r of results) {
  if (r.status === "unavailable") {
    console.log(`  ${r.engine.padEnd(10)} unavailable (${r.reason})`);
    continue;
  }
  console.log(
    `  ${r.engine.padEnd(10)} version=${r.version.padEnd(20)} maxRelativeDrift=${r.maxRelativeDrift.toExponential(3)}`,
  );
  if (r.maxRelativeDrift > RELATIVE_DRIFT_THRESHOLD) {
    exceeded.push(r);
  }
}

if (exceeded.length > 0) {
  for (const r of exceeded) {
    console.warn(
      `::warning::Cross-engine drift: ${r.engine} exceeded the ${RELATIVE_DRIFT_THRESHOLD} relative-drift threshold vs Node (measured ${r.maxRelativeDrift.toExponential(3)}, worst at ${r.detail}).`,
    );
  }
  console.warn(
    `${exceeded.length} engine(s) exceeded the drift threshold -- soft warn only, not failing CI.`,
  );
} else {
  console.log("All measured engines are within the drift threshold.");
}

writeFileSync(
  resultsPath,
  JSON.stringify(
    {
      schemaVersion: 1,
      recordedAt: new Date().toISOString().slice(0, 10),
      thresholdRelativeDrift: RELATIVE_DRIFT_THRESHOLD,
      provenance:
        'Measured by `node scripts/measure-cross-engine-drift.mjs`, comparing the same gravity+quadratic-drag dopri5 trajectory computed under Node against the identical fixture bundled (esbuild) and run inside Playwright-driven Chromium/Firefox. A browser not installed in the environment that produced this file is recorded as "unavailable" rather than measured -- see the `status` field per engine.',
      results,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Wrote measured results to ${resultsPath}`);

// Soft warn (P2.45's own validation text: "test warns if exceeded", not
// "test fails"): always exit 0 so a genuine but tiny cross-engine ULP
// difference -- expected, not a bug -- never blocks a push to main.
process.exit(0);
