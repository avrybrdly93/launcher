// Workgroup-size sweep for the WGSL RK4 kernel (P7.15's validation criterion).
//
// Dispatches the same ensemble at every workgroup size the device will accept,
// times each, and records the ranking keyed by the adapter's class.
//
// ## THE CRITERION'S READING, WHICH WAS SETTLED BEFORE THIS SCRIPT WAS WRITTEN
//
// P7.15 reads "best workgroup size recorded per adapter class". The 99th run's
// handover flagged that this is ambiguous and that a session must not resolve
// it silently, because the only adapter reachable in this container is
// SwiftShader -- a SOFTWARE adapter, whose occupancy curve is a CPU emulation
// of a GPU's and is not evidence about any hardware adapter class.
//
// The reading taken, recorded in `ROADMAP.json` under P7.15 in a commit that
// contains no code: **per adapter class actually measured, software included,
// each row labelled with the class it was measured on.** The criterion
// describes a record keyed by class; a record holding one correctly-labelled
// row is incomplete, not false.
//
// What that reading obliges, and what this script therefore does:
//
//   * Every row is keyed by an `adapterClass` derived by `classifyAdapter` from
//     the adapter's own info, never typed by hand, and that function errs
//     towards `software` -- an adapter reporting nothing at all is `software`,
//     because calling software `hardware` is the one misclassification that
//     puts a CPU emulation into the record as evidence about a GPU.
//   * Every row states in words whether it is evidence about hardware.
//   * `--record` writes only the class it measured and leaves any other class
//     in the file untouched. A later run on real hardware appends its row; this
//     run cannot and does not fabricate one.
//
// ## THIS SCRIPT MEASURES TIME, WHICH THE AGREEMENT SCRIPT DELIBERATELY DOES NOT
//
// `measure-gpu-rk4-agreement.mjs` says in its own header that it measures no
// time and sweeps no workgroup size, and that those are P7.15's. This is that.
// The two are separate scripts because they answer different kinds of question,
// and one of the answers is adapter-independent while the other is not.
//
// **No throughput figure, no trajectories/second and no speedup appears here or
// in the results file.** P7.20's criterion is 1e6 trajectories/s and P7.22 is
// the profiling task; both need hardware, and a rate computed on SwiftShader
// would read like an answer to them. What is recorded is a *ranking* and its
// separation, which is the comparative quantity the criterion asks for.
//
// ## Why the timing is the whole round trip
//
// `timestamp-query` is an optional WebGPU feature, unavailable on the adapter
// here, so there is no in-queue timing to read. The measured quantity is
// therefore wall-clock around `runWgslRk4`, which includes buffer creation,
// upload, dispatch, readback and teardown. That is a fair comparison because
// the workgroup size is the only thing varying across it, and it is also the
// quantity a caller actually waits on.
//
// ## Usage
//
//   node scripts/measure-gpu-workgroup-sweep.mjs            # report only
//   node scripts/measure-gpu-workgroup-sweep.mjs --record   # update the results file
//
//   BALLISTA_CHROMIUM_PATH   full Chromium binary (not the headless shell)
//   BALLISTA_SWEEP_TRAJECTORIES / _WARMUPS / _REPEATS   override the defaults

import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as esbuild from "esbuild";
import {
  chromiumChoiceLine,
  chromiumHintLines,
  resolveChromiumExecutable,
} from "./resolve-chromium.mjs";
import {
  classifyAdapter,
  summariseWorkgroupSweep,
} from "../packages/runtime/dist/wgsl-workgroup-sweep.js";

const rootDir = join(import.meta.dirname, "..");
const resultsPath = join(rootDir, "scripts", "gpu-workgroup-sweep-results.json");
const fixtureEntry = join(rootDir, "scripts", "gpu-workgroup-sweep-fixture.mjs");

/**
 * The measurement's shape.
 *
 * 10000 trajectories matches the agreement run's ensemble, so the sweep times
 * the same work whose correctness that run established rather than a
 * differently-sized one. Warm-ups are discarded because the first dispatch at a
 * new source pays shader compilation, which is real but is not what a workgroup
 * size affects. Nine repeats is an odd count, so the median is an observed
 * timing rather than the mean of two.
 */
const TRAJECTORIES = Number(process.env.BALLISTA_SWEEP_TRAJECTORIES ?? 10_000);
const WARMUPS = Number(process.env.BALLISTA_SWEEP_WARMUPS ?? 3);
const REPEATS = Number(process.env.BALLISTA_SWEEP_REPEATS ?? 9);
const SEED = 0x7a14c0de;

/** The ensemble's fixed step size and count, matching the agreement fixture. */
const H = 0.001;
const STEPS = 2000;

const shouldRecord = process.argv.slice(2).includes("--record");

const bundle = await esbuild.build({
  entryPoints: [fixtureEntry],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "__ballistaGpuSweep",
  write: false,
});
const bundleCode = bundle.outputFiles[0].text;

// WebGPU is secure-context only, so the page must not be about:blank. The 99th
// run's finding, and the reason three earlier runs concluded there was no GPU
// here when there was one.
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<!doctype html><title>gpu-workgroup-sweep</title><body></body>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

/** Flag sets, most-preferred first. Same set and same finding as the agreement script. */
const FLAG_SETS = [
  {
    name: "swiftshader",
    args: [
      "--enable-unsafe-webgpu",
      "--use-webgpu-adapter=swiftshader",
      "--enable-features=Vulkan",
    ],
  },
  { name: "default", args: [] },
];

const { chromium } = await import("playwright");

/** See `resolve-chromium.mjs` (P0.138) for how the binary is chosen. */
const chromiumChoice = resolveChromiumExecutable();
const executablePath = chromiumChoice.executablePath;
console.log(chromiumChoiceLine(chromiumChoice));

async function measureWith(flagSet) {
  let browser;
  try {
    browser = await chromium.launch({ args: flagSet.args, executablePath });
  } catch (error) {
    return { status: "unavailable", reason: `launch failed: ${error.message}` };
  }
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.addScriptTag({ content: bundleCode });
    const result = await page.evaluate(
      ([count, seed, warmups, repeats]) =>
        window.__ballistaGpuSweep.runWorkgroupSweep(count, seed, warmups, repeats),
      [TRAJECTORIES, SEED, WARMUPS, REPEATS],
    );
    return { ...result, chromiumVersion: browser.version(), flags: flagSet.args };
  } catch (error) {
    return { status: "failed", reason: "evaluate-threw", error: String(error) };
  } finally {
    await browser.close();
  }
}

console.log(
  `Sweeping workgroup sizes over ${TRAJECTORIES} trajectories (h=${H}, steps=${STEPS}), ` +
    `${WARMUPS} warm-ups and ${REPEATS} timed repeats per size...`,
);

let run = null;
for (const flagSet of FLAG_SETS) {
  console.log(`Trying Chromium flag set "${flagSet.name}"...`);
  const attempt = await measureWith(flagSet);
  if (attempt.status === "measured") {
    run = { ...attempt, flagSet: flagSet.name };
    break;
  }
  console.log(`  -> ${attempt.status}: ${attempt.reason ?? attempt.error ?? "(no reason)"}`);
  if (run === null) run = { ...attempt, flagSet: flagSet.name };
}
server.close();

if (run.status !== "measured") {
  // Never report an all-clear derived from nothing measured -- P0.102's rule,
  // and the same degradation the agreement script uses.
  console.warn(
    `::warning::No WebGPU device could be obtained (${run.reason ?? run.error}), so no workgroup sweep was run. This is not a result.`,
  );
  for (const line of chromiumHintLines(chromiumChoice)) {
    console.warn(`  ${line}`);
  }
  if (shouldRecord) {
    console.warn(
      `::warning::--record was passed but nothing was measured; leaving ${resultsPath} unmodified rather than downgrading it.`,
    );
  }
  process.exit(0);
}

const summary = summariseWorkgroupSweep(run.samples);
const adapterClass = classifyAdapter({
  vendor: run.adapterInfo.vendor ?? undefined,
  architecture: run.adapterInfo.architecture ?? undefined,
  description: run.adapterInfo.description ?? undefined,
  isFallbackAdapter: run.adapterInfo.isFallbackAdapter ?? undefined,
});

console.log("");
console.log(
  `Adapter: vendor=${run.adapterInfo.vendor} architecture=${run.adapterInfo.architecture} ` +
    `fallback=${run.adapterInfo.isFallbackAdapter} -> class "${adapterClass}" (flag set: ${run.flagSet})`,
);
console.log(
  `Device limits: maxComputeWorkgroupSizeX=${run.limits.maxComputeWorkgroupSizeX} ` +
    `maxComputeInvocationsPerWorkgroup=${run.limits.maxComputeInvocationsPerWorkgroup}`,
);
if (run.deviceErrors.length > 0) {
  console.warn(`Device reported ${run.deviceErrors.length} uncaptured error(s):`);
  for (const message of run.deviceErrors) console.warn(`  ${message}`);
}
console.log("");
console.log("  size    median      min      max   (ms per dispatch, whole round trip)");
for (const row of summary.rankings) {
  console.log(
    `  ${String(row.workgroupSize).padStart(4)}  ${row.medianMs.toFixed(2).padStart(8)} ` +
      `${row.minMs.toFixed(2).padStart(8)} ${row.maxMs.toFixed(2).padStart(8)}`,
  );
}
console.log("");

// The sweep's own control: size 1 wastes every lane but one, so if it is not
// last the harness is not measuring occupancy and the ranking means nothing.
const sizeOneRank = summary.rankings.findIndex((row) => row.workgroupSize === 1);
const controlHeld = sizeOneRank === -1 || sizeOneRank === summary.rankings.length - 1;
if (!controlHeld) {
  console.error(
    `CONTROL FAILED: workgroup size 1 ranked ${sizeOneRank + 1} of ${summary.rankings.length}, not last. ` +
      `Size 1 uses one lane per workgroup, so a harness that does not rank it slowest is not measuring ` +
      `occupancy. Refusing to report a ranking.`,
  );
  process.exit(1);
}
console.log(`Control held: workgroup size 1 ranked last of ${summary.rankings.length}.`);

if (summary.bestWorkgroupSize === null) {
  console.log(
    `NO BEST SIZE. Fastest median was ${summary.fastestWorkgroupSize} and the runner-up was ` +
      `${summary.runnerUpWorkgroupSize}, but their timings overlap (separation ` +
      `${summary.separationMs?.toFixed(2)} ms of median). At this resolution the choice between the ` +
      `top two does not matter, which is the result rather than a failure to find one.`,
  );
} else {
  console.log(
    `BEST SIZE ${summary.bestWorkgroupSize} on adapter class "${adapterClass}": every timing at ` +
      `${summary.bestWorkgroupSize} beat every timing at ${summary.runnerUpWorkgroupSize}, by ` +
      `${summary.separationMs?.toFixed(2)} ms of median.`,
  );
}

if (adapterClass === "software") {
  console.log("");
  console.log(
    "NOTE: the adapter is SOFTWARE. This ranking is a CPU emulation of a GPU's occupancy and is " +
      "NOT evidence about any hardware adapter class. Recorded as its own class for that reason.",
  );
}

if (!shouldRecord) {
  console.log("");
  console.log(`Not writing ${resultsPath} (pass --record to update it).`);
  process.exit(0);
}

const evidence =
  adapterClass === "software"
    ? "This row was measured on a SOFTWARE adapter. It is a CPU emulation of a GPU's occupancy and is NOT evidence about any hardware adapter class. No throughput, trajectories/second or speedup figure is measured here or may be inferred from it -- those are P7.20 and P7.22 and they need hardware."
    : "This row was measured on a HARDWARE adapter, named below. It is evidence about that adapter and about adapters like it, and about nothing else. No throughput or speedup figure is measured here.";

const previous = (() => {
  try {
    return JSON.parse(readFileSync(resultsPath, "utf8"));
  } catch {
    return { rows: [] };
  }
})();

// Replace only this class's row. A class this run did not measure stays exactly
// as it was: a later run on hardware appends its own, and this run neither
// fabricates one nor deletes one it cannot reproduce.
const rows = (previous.rows ?? []).filter((row) => row.adapterClass !== adapterClass);
rows.push({
  adapterClass,
  bestWorkgroupSize: summary.bestWorkgroupSize,
  fastestWorkgroupSize: summary.fastestWorkgroupSize,
  runnerUpWorkgroupSize: summary.runnerUpWorkgroupSize,
  separationMs: summary.separationMs,
  separated: summary.separated,
  evidence,
  recordedAt: new Date().toISOString().slice(0, 10),
  adapter: run.adapterInfo,
  deviceLimits: run.limits,
  chromiumVersion: run.chromiumVersion,
  chromiumFlags: run.flags,
  measurement: {
    trajectories: TRAJECTORIES,
    seed: "0x7a14c0de",
    h: H,
    steps: STEPS,
    warmupsPerSize: WARMUPS,
    repeatsPerSize: REPEATS,
    timedQuantity:
      "Wall-clock milliseconds around runWgslRk4: the whole round trip -- buffer creation, upload, dispatch, readback, teardown. timestamp-query is an optional feature and is unavailable on this adapter, so there is no in-queue timing to read.",
    statistic:
      "Median of the timed repeats. A size is called best only when every one of its timings beat every one of the runner-up's, which is why bestWorkgroupSize can be null while fastestWorkgroupSize is not.",
    control:
      "Workgroup size 1 is swept deliberately and must rank last. It uses one lane per workgroup, so a harness that does not rank it slowest is not measuring occupancy, and the script exits non-zero rather than reporting a ranking.",
    correctness:
      "Every size's output is compared against the smallest size's before it is timed, value by value with Object.is. A dispatch geometry that under-dispatches is fast and wrong, so a sweep that only timed would reward it.",
  },
  rankings: summary.rankings,
});
rows.sort((a, b) => a.adapterClass.localeCompare(b.adapterClass));

const record = {
  schemaVersion: 1,
  task: "P7.15",
  criterion: "best workgroup size recorded per adapter class",
  criterionReading:
    "Per adapter class ACTUALLY MEASURED, software included, each row labelled with the class it was measured on. Settled in ROADMAP.json under P7.15 before any measurement, in a commit containing no code. A row for a class nobody has measured is never written: `--record` replaces only the class of the adapter in front of it and leaves every other row untouched.",
  provenance:
    "Written by `node scripts/measure-gpu-workgroup-sweep.mjs --record`. Each row's `evidence` field states whether that row is evidence about hardware. Rows are keyed by `adapterClass`, derived by `classifyAdapter` from the adapter's own info rather than typed by hand; that function errs towards `software`, because calling a software adapter `hardware` is the one misclassification that puts a CPU emulation's occupancy curve into the record as evidence about a GPU.",
  rows,
};

writeFileSync(resultsPath, `${JSON.stringify(record, null, 2)}\n`);
console.log("");
console.log(`Recorded the "${adapterClass}" row in ${resultsPath}.`);
