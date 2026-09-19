// SolverKit benchmark trend dashboard + alert thresholds (P7.31).
//
// Reads scripts/benchmark-history.json, renders it to
// scripts/benchmark-trend.svg (the "historical chart artifact" the task's
// criterion names), and grades the newest sample against the median of the
// samples before it ON THE SAME MACHINE. A method that fell further than the
// history's `alert.regressionPct` prints a GitHub Actions `::warning::`
// annotation; this script always exits 0, the same deliberate soft warn
// scripts/check-benchmark-regression.mjs makes and for the same reason.
//
// ## How this differs from check-benchmark-regression.mjs, which it does not replace
//
// That script measures. This one does not: it reads what previous runs
// recorded. That script compares today against ONE snapshot; this one compares
// against a median, because the metric's measured same-machine spread (34.8%
// on dopri5 over seven runs, 2026-09-19) is larger than that script's own 15%
// threshold, so a single-point comparison cannot separate a regression from a
// noisy afternoon. Both stay: a fresh measurement and a trend answer different
// questions.
//
// ## --record
//
// With `--record` the script runs the micro-benchmark itself and appends the
// result as a new sample, then renders. Without it, nothing is written but the
// chart. CI runs it WITHOUT --record on purpose: a write lands in the runner's
// workspace and is discarded (P0.102), so growing the series stays a
// deliberate local act, and CI's deliverable is the uploaded chart.
//
// Requires packages/{engine,solverkit}/dist to already be built (`pnpm
// typecheck`, already a prior CI step), the same precondition P2.43's and
// P2.46's scripts have.

import { readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";

const rootDir = join(import.meta.dirname, "..");
const historyPath = join(rootDir, "scripts", "benchmark-history.json");
const svgPath = join(rootDir, "scripts", "benchmark-trend.svg");

const { DEFAULT_TREND_THRESHOLDS, renderBenchmarkTrendSvg, summariseBenchmarkTrend } = await import(
  join(rootDir, "packages", "solverkit", "dist", "index.js")
);

/**
 * A fingerprint that changes when the hardware does.
 *
 * Deliberately coarse and deliberately derived rather than typed: a hand-written
 * machine label is exactly the field that goes stale silently, and the only
 * property this needs is that two different machines rarely collide.
 */
function machineId() {
  const cores = cpus();
  const model = (cores[0]?.model ?? "unknown-cpu")
    .toLowerCase()
    .replace(/\(r\)|\(tm\)|processor/g, "")
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const nodeMajor = process.version.split(".")[0];
  return `${process.platform}-${process.arch}-${cores.length}cpu-${model}-${nodeMajor.replace("v", "node")}`;
}

const history = JSON.parse(readFileSync(historyPath, "utf8"));

if (process.argv.includes("--record")) {
  // Imported lazily: without --record this script touches no benchmark at all,
  // and paying for the engine/solverkit stepper graph to read a JSON file would
  // make the read path depend on a build it does not need.
  const { measureStepperRatios } = await import(join(rootDir, "scripts", "benchmark-ratios.mjs"));
  const { ratios, stepsPerSec } = await measureStepperRatios(rootDir);
  history.samples.push({
    recordedAt: new Date().toISOString().slice(0, 10),
    machineId: machineId(),
    ratios,
    stepsPerSec,
    note: "Recorded by `node scripts/plot-benchmark-trend.mjs --record`.",
  });
  writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n");
  console.log(`Appended a sample to ${historyPath}.`);
}

const summary = summariseBenchmarkTrend(history, history.alert ?? DEFAULT_TREND_THRESHOLDS);
writeFileSync(svgPath, renderBenchmarkTrendSvg(history));

console.log(
  `SolverKit benchmark trend: ${history.samples.length} sample(s), ${summary.machineSamples} on the latest machine (${summary.machineId}).`,
);
console.log(
  `Alert rule: more than ${summary.thresholds.regressionPct}% below the median of the preceding same-machine samples, with at least ${summary.thresholds.minSamples} of them.`,
);
for (const method of summary.methods) {
  const change =
    method.changePct === null ? "     --" : `${method.changePct.toFixed(1)}%`.padStart(7);
  const reference = method.reference === null ? "    --" : method.reference.toFixed(4);
  console.log(
    `  ${method.id.padEnd(24)} latest=${method.latest.toFixed(4)}  median=${reference}  change=${change}  n=${method.referenceSamples}  ${method.verdict}`,
  );
}
console.log(`Chart written to ${svgPath}.`);

if (summary.alerts.length > 0) {
  for (const alert of summary.alerts) {
    console.warn(
      `::warning::Benchmark trend: "${alert.id}" is ${Math.abs(alert.changePct).toFixed(1)}% below the median of the ${alert.referenceSamples} preceding samples on ${summary.machineId} (median=${alert.reference.toFixed(4)}, latest=${alert.latest.toFixed(4)}, threshold=${summary.thresholds.regressionPct}%).`,
    );
  }
  console.warn(
    `${summary.alerts.length} method(s) below the trend threshold -- soft warn only, not failing CI.`,
  );
} else if (summary.methods.every((m) => m.verdict === "insufficient-history")) {
  // Said out loud rather than passing quietly. "No alerts" and "not enough
  // history to raise one" are different states, and a dashboard that prints the
  // same line for both is the thing this task exists to stop being.
  console.log(
    `No alert is possible yet: fewer than ${summary.thresholds.minSamples} preceding samples on this machine. This is not an all-clear.`,
  );
} else {
  console.log("No method is below the trend threshold.");
}

// Soft warn, as P2.43's script is: a perf trend read off a shared runner should
// never be what blocks a push to main.
process.exit(0);
