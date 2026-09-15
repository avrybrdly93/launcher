// P0.136's device measurement.
//
// The task's validation criterion has two clauses and this script measures both:
//
//   1. "compensated WGSL march reproduces the CPU compensated arm"
//   2. "vacuum-45deg's batch maximum falls below 1e-3 m on the device path"
//
// They are different questions and either can pass while the other fails. A
// device that reproduced the CPU compensated arm exactly would still fail (2)
// if the CPU arm itself missed the bar; a device that met (2) by accident --
// say, by computing something else that happened to land near the f64 answer --
// would fail (1). Reporting them separately is what keeps the pass honest.
//
// WHY BOTH ARMS ARE CARRIED. The run prints the plain arm's worst error next to
// the compensated one. Without it a reader has no way to tell a working
// compensation from a march that was never accumulating enough to matter: the
// number that makes this task's case is the RATIO, and a single figure cannot
// show one. P7.19 recorded 1.5539e-02 plain against 3.1686e-05 compensated on
// the CPU, and the device arm should land beside the latter.
//
// WHAT A SOFTWARE ADAPTER DOES AND DOES NOT ESTABLISH HERE. Unlike P7.20's
// throughput target, this criterion is about ARITHMETIC, not speed. A
// SwiftShader adapter executes the same WGSL with the same f32 semantics, so a
// 0-ULP agreement measured on it is evidence about the shader rather than about
// the hardware -- which is exactly the distinction P7.20's notes draw when they
// refuse a rate computed on the same adapter. The adapter's class is printed
// and recorded either way, and `classifyAdapter`'s labelling is not touched.
//
// Exits 0 and warns, never silently passes, when no device can be obtained
// (P0.102): "nothing was measured" must never read as "everything agreed".

import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as esbuild from "esbuild";
import {
  chromiumChoiceLine,
  chromiumHintLines,
  resolveChromiumExecutable,
} from "./resolve-chromium.mjs";

import {
  computeCpuCompensatedRanges,
  computeCpuPlainRanges,
  computeReferenceRanges,
  FAMILY_H,
  FAMILY_ID,
  FAMILY_STEPS,
  GRID_SIDE,
  IMPACT_ABSOLUTE_BUDGET_M,
} from "./gpu-compensated-impact-fixture.mjs";

const rootDir = join(import.meta.dirname, "..");
const resultsPath = join(rootDir, "scripts", "gpu-compensated-impact-results.json");
const fixtureEntry = join(rootDir, "scripts", "gpu-compensated-impact-fixture.mjs");

const shouldRecord = process.argv.slice(2).includes("--record");

/**
 * The agreement budget between the device and the CPU compensated arm, in ULPs.
 *
 * P7.16 measured the plain march 0-ULP identical on this adapter and P7.14 did
 * the same before it, so the honest expectation here is also 0. The budget is
 * the same 256 those tasks used rather than a tighter one invented for this
 * run: a compensated march that agreed to within a few ULP instead of exactly
 * would still be reproducing the CPU arm, and tightening the bar to match one
 * observed result would be fitting the criterion to the measurement.
 */
const ULP_BUDGET = 256;

function ulpDistance(a, b) {
  if (Object.is(a, b)) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  const buf = new ArrayBuffer(4);
  const f = new Float32Array(buf);
  const i = new Int32Array(buf);
  f[0] = a;
  const ai = i[0] < 0 ? 0x80000000 - i[0] : i[0];
  f[0] = b;
  const bi = i[0] < 0 ? 0x80000000 - i[0] : i[0];
  return Math.abs(ai - bi);
}

console.log(
  `P0.136 device measurement: family=${FAMILY_ID}, ${GRID_SIDE}x${GRID_SIDE} grid, ` +
    `h=${FAMILY_H}, steps=${FAMILY_STEPS}`,
);
console.log("");

console.log("Computing f64 reference arm...");
let start = Date.now();
const reference = computeReferenceRanges();
console.log(`  ...done in ${((Date.now() - start) / 1000).toFixed(1)}s`);

console.log("Computing f32 CPU compensated arm...");
start = Date.now();
const cpuCompensated = computeCpuCompensatedRanges();
console.log(`  ...done in ${((Date.now() - start) / 1000).toFixed(1)}s`);

console.log("Computing f32 CPU plain arm (carried for the ratio only)...");
start = Date.now();
const cpuPlain = computeCpuPlainRanges();
console.log(`  ...done in ${((Date.now() - start) / 1000).toFixed(1)}s`);

const bundle = await esbuild.build({
  entryPoints: [fixtureEntry],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "__ballistaGpuCompensatedImpact",
  write: false,
});
const bundleCode = bundle.outputFiles[0].text;

// WebGPU is secure-context only, so the page must not be about:blank.
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<!doctype html><title>gpu-compensated-impact</title><body></body>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

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
    page.setDefaultTimeout(900_000);
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.addScriptTag({ content: bundleCode });
    const result = await page.evaluate(() =>
      window.__ballistaGpuCompensatedImpact.runGpuCompensatedRanges(),
    );
    return { ...result, chromiumVersion: browser.version(), flags: flagSet.args };
  } catch (error) {
    return { status: "failed", reason: "evaluate-threw", error: String(error) };
  } finally {
    await browser.close();
  }
}

let run = null;
for (const flagSet of FLAG_SETS) {
  console.log(`Trying Chromium flag set "${flagSet.name}"...`);
  const attempt = await measureWith(flagSet);
  if (attempt.status === "measured") {
    run = { ...attempt, flagSet: flagSet.name };
    break;
  }
  console.log(`  -> ${attempt.status}: ${attempt.reason ?? attempt.error ?? "(no reason)"}`);
  if (run === null || run.status !== "measured") run = { ...attempt, flagSet: flagSet.name };
}
server.close();

if (run.status !== "measured") {
  console.warn(
    `::warning::No WebGPU device could be obtained (${run.reason ?? run.error}), so the ` +
      `compensated march was NOT checked. This is not a pass.`,
  );
  for (const line of chromiumHintLines(chromiumChoice)) {
    console.warn(`  ${line}`);
  }
  if (shouldRecord) {
    console.warn(
      `::warning::--record was passed but nothing was measured; leaving ${resultsPath} unmodified.`,
    );
  }
  process.exit(0);
}

const deviceRanges = Float32Array.from(run.ranges);
if (deviceRanges.length !== reference.ranges.length) {
  console.error(
    `GPU returned ${deviceRanges.length} ranges, expected ${reference.ranges.length}. ` +
      `Refusing to compare.`,
  );
  process.exit(1);
}

let worstUlp = 0;
let worstUlpIndex = -1;
let identical = 0;
let worstDeviceError = 0;
let worstDeviceIndex = -1;
let worstCpuCompensatedError = 0;
let worstCpuPlainError = 0;
let impactedOnReference = 0;
let impactedMismatches = 0;

for (let i = 0; i < deviceRanges.length; i++) {
  const refRange = reference.ranges[i];
  const cpuComp = Math.fround(cpuCompensated.ranges[i]);
  const dev = deviceRanges[i];

  const ulp = ulpDistance(dev, cpuComp);
  if (ulp > worstUlp) {
    worstUlp = ulp;
    worstUlpIndex = i;
  }
  if (Object.is(dev, cpuComp)) identical++;

  const devErr = Math.abs(dev - refRange);
  if (devErr > worstDeviceError) {
    worstDeviceError = devErr;
    worstDeviceIndex = i;
  }
  worstCpuCompensatedError = Math.max(worstCpuCompensatedError, Math.abs(cpuComp - refRange));
  worstCpuPlainError = Math.max(
    worstCpuPlainError,
    Math.abs(Math.fround(cpuPlain.ranges[i]) - refRange),
  );

  if (reference.impacted[i] === 1) impactedOnReference++;
  if ((run.impacted[i] === 1 ? 1 : 0) !== reference.impacted[i]) impactedMismatches++;
}

console.log("");
console.log(
  `Adapter: vendor=${run.adapterInfo.vendor} architecture=${run.adapterInfo.architecture} ` +
    `fallback=${run.adapterInfo.isFallbackAdapter} (flag set: ${run.flagSet})`,
);
console.log(`Chromium: ${run.chromiumVersion}`);
if (run.deviceErrors.length > 0) {
  console.warn(`::warning::device reported uncaptured errors: ${run.deviceErrors.join("; ")}`);
}
console.log("");
console.log(
  `Trajectories: ${deviceRanges.length}, of which ${impactedOnReference} landed on the ` +
    `reference side.`,
);
console.log("");
console.log("Clause 1 -- device compensated march vs CPU compensated arm:");
console.log(`  bit-identical ranges : ${identical}/${deviceRanges.length}`);
console.log(`  worst ULP            : ${worstUlp} (budget ${ULP_BUDGET}, index ${worstUlpIndex})`);
console.log(`  impacted mismatches  : ${impactedMismatches}`);
console.log("");
console.log("Clause 2 -- absolute impact-abscissa error against the f64 reference:");
console.log(
  `  device compensated   : ${worstDeviceError.toExponential(6)} m ` +
    `(index ${worstDeviceIndex}) budget ${IMPACT_ABSOLUTE_BUDGET_M.toExponential(0)} m`,
);
console.log(`  CPU compensated      : ${worstCpuCompensatedError.toExponential(6)} m`);
console.log(`  CPU plain (context)  : ${worstCpuPlainError.toExponential(6)} m`);
console.log(
  `  plain/device ratio   : ${(worstCpuPlainError / worstDeviceError).toFixed(1)}x, ` +
    `device clears the bar by ${(IMPACT_ABSOLUTE_BUDGET_M / worstDeviceError).toFixed(1)}x`,
);

const failures = [];
if (impactedMismatches > 0) {
  failures.push(`${impactedMismatches} trajectories disagree on the impacted flag`);
}
if (worstUlp > ULP_BUDGET) {
  failures.push(
    `clause 1: worst ULP ${worstUlp} against the CPU compensated arm exceeds ${ULP_BUDGET}`,
  );
}
if (worstDeviceError > IMPACT_ABSOLUTE_BUDGET_M) {
  failures.push(
    `clause 2: worst device error ${worstDeviceError.toExponential(6)} m exceeds ` +
      `${IMPACT_ABSOLUTE_BUDGET_M.toExponential(0)} m`,
  );
}
// A batch in which nothing landed would clear every gate above while testing
// nothing at all -- the inert-instrument failure P7.19's study names.
if (impactedOnReference !== deviceRanges.length) {
  failures.push(
    `only ${impactedOnReference}/${deviceRanges.length} members impacted on the reference ` +
      `arm; a non-impacting member contributes a vacuous 0.0`,
  );
}

console.log("");
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log(
  `PASS: device reproduces the CPU compensated arm (worst ULP ${worstUlp}), and the ` +
    `batch maximum ${worstDeviceError.toExponential(6)} m is below ` +
    `${IMPACT_ABSOLUTE_BUDGET_M.toExponential(0)} m.`,
);

if (shouldRecord) {
  const record = {
    task: "P0.136",
    familyId: FAMILY_ID,
    gridSide: GRID_SIDE,
    count: deviceRanges.length,
    h: FAMILY_H,
    steps: FAMILY_STEPS,
    absoluteBudgetMetres: IMPACT_ABSOLUTE_BUDGET_M,
    ulpBudget: ULP_BUDGET,
    adapter: run.adapterInfo,
    adapterClass: run.adapterInfo.architecture === "swiftshader" ? "software" : "unknown",
    chromiumVersion: run.chromiumVersion,
    flagSet: run.flagSet,
    impactedOnReference,
    impactedMismatches,
    identicalRanges: identical,
    worstUlpVsCpuCompensated: worstUlp,
    worstDeviceErrorMetres: worstDeviceError,
    worstCpuCompensatedErrorMetres: worstCpuCompensatedError,
    worstCpuPlainErrorMetres: worstCpuPlainError,
    notes: [
      "Clause 1 compares the device's compensated march against the CPU f32 compensated arm; clause 2 compares the device against the f64 reference on an absolute metre bar. Either can pass while the other fails, so both are reported.",
      "The CPU plain arm is carried for context only. The number that makes P0.136's case is the ratio between the arms, and a single figure cannot show one.",
      "Measured on a SOFTWARE adapter. Unlike P7.20's throughput target, this criterion is about arithmetic rather than speed: the same WGSL with the same f32 semantics runs on either, so the agreement is evidence about the shader. classifyAdapter's software/hardware labelling is untouched.",
      "The default (uncompensated) kernel text is byte-identical to the pre-P0.136 build, so P7.16's and P7.17's recorded measurements are not stale and were not re-recorded.",
    ],
  };
  writeFileSync(resultsPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`Recorded to ${resultsPath}`);
}
