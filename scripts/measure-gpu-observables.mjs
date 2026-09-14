// GPU/CPU agreement for the WGSL observables reduction (P7.16's validation
// criterion: "matches CPU observables within f32 tolerance").
//
// Runs one ensemble two ways -- the f32 CPU reduction under Node, and the
// observables kernel on a real WebGPU device inside Playwright Chromium -- and
// compares the five reduced values per trajectory.
//
// ## WHICH "CPU OBSERVABLES", WHICH IS THE QUESTION THE CRITERION LEAVES OPEN
//
// Settled in the 101st run's claim commit, before anything was measured, because
// three different comparisons can be spelled "matches CPU observables":
//
//   (i)   against @ballista/analysis's f64 apex()/range() over an f64 adaptive
//         solve;
//   (ii)  against an f64 reduction over the same f32 fixed-step trajectory;
//   (iii) against an f32 CPU reduction of the same algorithm over the same f32
//         fixed-step trajectory.
//
// This script is (iii). It moves one thing -- the execution target -- so a
// disagreement is about the device and nothing else. Reading (i) would move
// arithmetic width, execution target and fixed-step-versus-event-localised all
// at once, and a pass under it would be a fact about how three errors cancelled.
//
// Reading (i) is NOT abandoned; it is just not this script's job. It lives in
// `planar-observables-reduction.test.ts`, which checks the CPU reduction against
// the drag-free closed forms and against analysis's own apex() over shared rows.
// Without that, this script would only prove a transcription agrees with its
// twin. The two together are what make the pair evidence about correctness.
//
// ## WHAT THIS SCRIPT MAY AND MAY NOT BE USED TO CLAIM
//
// The adapter available in this container is SOFTWARE (SwiftShader). It runs the
// same WGSL through the same Tint compiler and produces numbers a conformant
// implementation would produce, so it answers a correctness question, which is
// what P7.16's criterion is. It answers NO performance question: this script
// measures no time and reports no throughput. The on-device reduction's actual
// payoff -- not moving 3.2e8 bytes across the bus -- is a bandwidth claim, and
// bandwidth is a property of the hardware, so it belongs to P7.20 and not here.
// The recorded adapter info is part of the result for exactly that reason.
//
// ## THE METRIC, AND WHY IT IS NOT ONE NUMBER
//
// The five outputs are not alike and a single tolerance over all of them would
// be the wrong instrument three times over:
//
//   - `impacted` is a flag. Its only acceptable disagreement count is zero, and
//     a tolerance on it would hide a genuine divergence in control flow behind
//     "0.0 vs 1.0 is within 1.0".
//   - `range` and `apexHeight` are O(100) and bounded away from zero on this
//     ensemble, so a relative figure is meaningful for them.
//   - `apexT` and `impactT` are O(1) times, and `apexT` can legitimately be 0
//     for a flight whose apex is its launch point -- so the relative figure is
//     reported with a floor and the ULP figure is what gates.
//
// So: ULP gates everything numeric, `impacted` must match exactly, and absolute
// and relative figures are reported per observable as documentation. This is the
// same resolution P7.11 reached for the backend-equivalence golden and P7.14 for
// the kernel, and P0.134 is the open filing about the criterion's own relative
// metric.
//
// The ULP budget cannot be zero: WGSL permits contracting `a * b + c` into an
// FMA, which rounds once where the CPU rounds twice. Nor can it be picked by
// intuition. See the note on ULP_BUDGET: the first number written there was
// 4096, justified by an amplification argument that a control then refuted, and
// loose enough that a second control could delete the impact refinement entirely
// and still pass. It is bounded above by P7.14's integration budget and below by
// what the controls measure.
//
// Requires `packages/{runtime,solverkit}/dist` to be built (`pnpm build`).

import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as esbuild from "esbuild";

import {
  buildEnsemble,
  computeCpuObservables,
  FIXTURE_H,
  FIXTURE_STEPS,
  OBSERVABLES,
} from "./gpu-observables-fixture.mjs";

const rootDir = join(import.meta.dirname, "..");
const resultsPath = join(rootDir, "scripts", "gpu-observables-results.json");
const fixtureEntry = join(rootDir, "scripts", "gpu-observables-fixture.mjs");

/** Matches P7.14's criterion count, so the two measurements describe one ensemble. */
const CRITERION_TRAJECTORIES = 10_000;

/**
 * Overridable downward for controls only, and refused under `--record`.
 *
 * A negative control needs to demonstrate a failure, not a precise figure, and a
 * reduced ensemble makes a control loop minutes shorter. Recording a smaller run
 * under the criterion's name would be a smaller measurement wearing a larger
 * one's label.
 */
const TRAJECTORIES = Number(process.env.BALLISTA_GPU_TRAJECTORIES ?? CRITERION_TRAJECTORIES);
const SEED = 0x7a14c0de;

/**
 * ULP budget for the four numeric observables, derived from BOTH sides.
 *
 * **Not derived from this run's result, which was exact.** On SwiftShader the
 * reduction is bit-identical to the CPU reference, so "measured worst case plus
 * headroom" would set the budget at 0 and there is no data here arguing for any
 * positive number. A budget presented as empirical when the empirical answer was
 * exact would be a fabricated derivation, which is the point P7.14 made about
 * its own 64.
 *
 * **The first budget written here was 4096, and a control refuted it before the
 * run was recorded.** The reasoning for 4096 was that the reduction bisects to a
 * parameter and then evaluates a Hermite polynomial at it, so a last-bit
 * difference should propagate amplified by roughly `h * |v|`. That argument
 * sounded right and is not supported: control C1 perturbs a Hermite coefficient
 * by 1e-7 relative -- far more than FMA contraction can produce -- and moves the
 * result by **2 to 3 ULP**, not thousands. There is no amplification to budget
 * for.
 *
 * Worse, 4096 was loose enough to be useless. Control C2 replaces the entire
 * 60-iteration impact bisection with `theta = 0.5` -- deleting the refinement
 * that is half of what P7.16 added -- and lands at **1987 ULP on range and 2036
 * on impactT**, which a 4096 budget calls a pass. A gate that permits removing
 * the feature under test is not a gate.
 *
 * So the budget is bounded from both directions and 256 sits between them:
 *
 *   - **Above** what a conformant implementation may legally differ by. P7.14
 *     gates the integration itself at 64 for the FMA-contraction latitude. The
 *     reduction consumes that integration's output and adds a few dozen further
 *     operations, so its budget should be a small multiple of the integration's
 *     rather than equal to it -- 4x, which C1's measured 2-3 ULP for a much
 *     larger perturbation says is generous.
 *   - **Below** the smallest defect the controls demonstrate, by 7.8x: C2 at
 *     1987, C3 (apex refined on upward crossings instead of downward) at 1.1e9.
 *
 * If a future hardware adapter that does contract FMAs exceeds 256, the right
 * response is to re-derive this from that measurement -- and to re-run C2 to
 * check the new number still sits below it.
 */
const ULP_BUDGET = 256;

/** Below this magnitude a relative figure is meaningless; reported, never gated. */
const RELATIVE_FLOOR = 1e-6;

const shouldRecord = process.argv.slice(2).includes("--record");

if (shouldRecord && TRAJECTORIES !== CRITERION_TRAJECTORIES) {
  console.error(
    `Refusing to --record a ${TRAJECTORIES}-trajectory run: the criterion names ` +
      `${CRITERION_TRAJECTORIES}. Unset BALLISTA_GPU_TRAJECTORIES to record.`,
  );
  process.exit(1);
}

/**
 * Distance in representable binary32 values between two f32 numbers.
 *
 * The monotonic-ordering trick, as in `measure-gpu-rk4-agreement.mjs`:
 * reinterpreting the bits as a sign-magnitude integer and mapping to two's
 * complement makes adjacent representable values adjacent integers. Handles the
 * zero crossing, which matters because `apexT` can be exactly 0.
 */
const ulpScratch = new ArrayBuffer(8);
const ulpF32 = new Float32Array(ulpScratch);
const ulpI32 = new Int32Array(ulpScratch);
function ulpDistance(a, b) {
  if (a === b) return 0;
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  ulpF32[0] = a;
  ulpF32[1] = b;
  const toOrdered = (bits) => (bits < 0 ? 0x80000000 - (bits & 0x7fffffff) : bits);
  return Math.abs(toOrdered(ulpI32[0]) - toOrdered(ulpI32[1]));
}

function compare(reference, sample) {
  const perObservable = OBSERVABLES.map((name) => ({
    observable: name,
    maxAbs: 0,
    maxUlp: 0,
    maxRelative: 0,
    identicalValues: 0,
    worstUlpAt: null,
    worstRelativeAt: null,
  }));
  let identicalTrajectories = 0;
  let impactedMismatches = 0;
  let impactedOnCpu = 0;

  const dim = OBSERVABLES.length;
  const count = reference.length / dim;
  for (let i = 0; i < count; i++) {
    let trajectoryIdentical = true;
    for (let c = 0; c < dim; c++) {
      const idx = i * dim + c;
      const r = reference[idx];
      const s = sample[idx];
      const stat = perObservable[c];
      if (r === s) stat.identicalValues += 1;
      else trajectoryIdentical = false;

      const abs = Math.abs(r - s);
      const ulp = ulpDistance(r, s);
      const rel = Math.abs(r) > RELATIVE_FLOOR ? abs / Math.abs(r) : 0;
      if (abs > stat.maxAbs) stat.maxAbs = abs;
      if (ulp > stat.maxUlp) {
        stat.maxUlp = ulp;
        stat.worstUlpAt = { trajectory: i, cpu: r, gpu: s, abs };
      }
      if (rel > stat.maxRelative) {
        stat.maxRelative = rel;
        stat.worstRelativeAt = { trajectory: i, cpu: r, gpu: s, abs };
      }
    }
    const impactedIdx = i * dim + OBSERVABLES.indexOf("impacted");
    if (reference[impactedIdx] === 1) impactedOnCpu += 1;
    if (reference[impactedIdx] !== sample[impactedIdx]) impactedMismatches += 1;
    if (trajectoryIdentical) identicalTrajectories += 1;
  }
  return {
    perObservable,
    identicalTrajectories,
    impactedMismatches,
    impactedOnCpu,
    trajectories: count,
  };
}

// ---------------------------------------------------------------------------

console.log(`Building ensemble of ${TRAJECTORIES} trajectories (seed 0x${SEED.toString(16)})...`);
const ensemble = buildEnsemble(TRAJECTORIES, SEED);
console.log(`Computing f32 CPU reduction (h=${FIXTURE_H}, steps=${FIXTURE_STEPS}, round=toF32)...`);
const cpuStart = Date.now();
const reference = computeCpuObservables(ensemble);
console.log(`  ...done in ${((Date.now() - cpuStart) / 1000).toFixed(1)}s`);

const bundle = await esbuild.build({
  entryPoints: [fixtureEntry],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "__ballistaGpuObservables",
  write: false,
});
const bundleCode = bundle.outputFiles[0].text;

// WebGPU is secure-context only, so the page must not be about:blank.
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<!doctype html><title>gpu-observables</title><body></body>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

/** Flag sets, most-preferred first; measured in this image by the 99th run. */
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

/** See `measure-gpu-rk4-agreement.mjs`: the headless shell has no GPU process. */
const executablePath = process.env.BALLISTA_CHROMIUM_PATH ?? undefined;

async function measureWith(flagSet) {
  let browser;
  try {
    browser = await chromium.launch({ args: flagSet.args, executablePath });
  } catch (error) {
    return { status: "unavailable", reason: `launch failed: ${error.message}` };
  }
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(600_000);
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.addScriptTag({ content: bundleCode });
    const result = await page.evaluate(
      ([count, seed]) => window.__ballistaGpuObservables.runGpuObservables(count, seed),
      [TRAJECTORIES, SEED],
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
  if (run === null) run = { ...attempt, flagSet: flagSet.name };
}
server.close();

if (run.status !== "measured") {
  // Never report an all-clear derived from nothing measured (P0.102).
  console.warn(
    `::warning::No WebGPU device could be obtained (${run.reason ?? run.error}), so the ` +
      `observables reduction was NOT checked. This is not a pass.`,
  );
  if (shouldRecord) {
    console.warn(
      `::warning::--record was passed but nothing was measured; leaving ${resultsPath} unmodified.`,
    );
  }
  process.exit(0);
}

const sample = Float32Array.from(run.observables);
if (sample.length !== reference.length) {
  console.error(
    `GPU returned ${sample.length} values, expected ${reference.length}. Refusing to compare.`,
  );
  process.exit(1);
}

const comparison = compare(reference, sample);

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
  `Trajectories: ${comparison.trajectories}, of which ${comparison.impactedOnCpu} landed on the CPU side.`,
);
console.log(`Bit-identical trajectories: ${comparison.identicalTrajectories}`);
console.log(`impacted-flag mismatches: ${comparison.impactedMismatches}`);
console.log("");
for (const stat of comparison.perObservable) {
  console.log(
    `  ${stat.observable.padEnd(11)} maxUlp=${String(stat.maxUlp).padStart(8)} ` +
      `maxAbs=${stat.maxAbs.toExponential(3)} maxRel=${stat.maxRelative.toExponential(3)} ` +
      `identical=${stat.identicalValues}/${comparison.trajectories}`,
  );
}

/**
 * P7.19's budget: an ABSOLUTE bound in metres on the impact abscissa.
 *
 * ## Why this exists alongside `ULP_BUDGET` rather than inside it
 *
 * P7.19's criterion is "impact x within 1e-3 m of CPU on 1e4 batch". Neither
 * side emits an absolute abscissa -- both emit `range = |impactX - x0|` -- and
 * every scenario in this ensemble launches from `x0 = 0`, so the two coincide
 * numerically and the criterion is read on `range`. That coincidence is a
 * property of THIS ENSEMBLE and not of the code; a scenario with a non-zero
 * launch abscissa would break it and the reading would have to be revisited.
 * The 104th run's claim commit settles this in `ROADMAP.json`.
 *
 * ## The ULP budget does not imply this one, which is the whole reason for the
 * second gate
 *
 * It is tempting to assume the tighter-sounding 256-ULP gate subsumes a
 * millimetre bar. It does not, and the arithmetic is exact rather than
 * approximate. 256 ULP of a binary32 value is at most 1e-3 m only while the
 * value is below **64 m**: on [32, 64) one ULP is 2^-18 = 3.815e-6 and 256 of
 * them are 9.77e-4 m, just inside; on [64, 128) one ULP doubles to 7.629e-6 and
 * 256 of them are **1.953e-3 m**, nearly twice this bar; above 128 m it doubles
 * again.
 *
 * The ranges this ensemble produces are O(100) m -- squarely in the regime
 * where `ULP_BUDGET` is the WEAKER of the two gates. So a future change could
 * pass `check:gpu-observables` on its ULP gate and violate P7.19, and before
 * this constant nothing in the repository would have noticed.
 *
 * The converse is also false in the other direction: this gate says nothing
 * about `apexHeight`, `apexT` or `impactT`, which `ULP_BUDGET` does cover.
 * Neither gate subsumes the other and both are enforced.
 *
 * ## Teeth
 *
 * Control C2 -- replacing the 60-iteration impact bisection with `theta = 0.5`,
 * i.e. deleting the feature P7.19 names -- measures 1987 ULP on range, which at
 * an O(100) m range is **1.5e-2 m**, fifteen times this bar. So this gate
 * rejects the deletion of the thing it is gating, which is the property
 * `ULP_BUDGET`'s own derivation demanded of itself.
 */
const IMPACT_X_ABS_BUDGET_M = 1e-3;

const numeric = comparison.perObservable.filter((s) => s.observable !== "impacted");
const worstUlp = Math.max(...numeric.map((s) => s.maxUlp));
const failures = [];
if (comparison.impactedMismatches > 0) {
  failures.push(`${comparison.impactedMismatches} trajectories disagree on the impacted flag`);
}
if (worstUlp > ULP_BUDGET) {
  failures.push(`worst numeric ULP ${worstUlp} exceeds the budget of ${ULP_BUDGET}`);
}
// P7.19: the absolute metre bound on the impact abscissa. Read on `range`
// because `x0 = 0` throughout this ensemble; see IMPACT_X_ABS_BUDGET_M.
const rangeStat = comparison.perObservable.find((s) => s.observable === "range");
if (rangeStat === undefined) {
  failures.push("no `range` statistic was produced, so P7.19 could not be evaluated");
} else if (!(rangeStat.maxAbs <= IMPACT_X_ABS_BUDGET_M)) {
  failures.push(
    `P7.19: worst |gpu - cpu| on range is ${rangeStat.maxAbs.toExponential(3)} m, ` +
      `above the budget of ${IMPACT_X_ABS_BUDGET_M} m`,
  );
}
// A run in which nothing landed would pass every numeric gate while testing
// nothing about range, which is half of what this task added -- and it would
// make the P7.19 gate above vacuous as well, since an unlanded flight reports
// range 0 on both sides.
if (comparison.impactedOnCpu === 0) {
  failures.push("no trajectory in the ensemble landed, so range was never exercised");
}

console.log("");
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log(
  `PASS: worst numeric ULP ${worstUlp} <= ${ULP_BUDGET}, impacted flag exact, ` +
    `P7.19 range |gpu - cpu| ${rangeStat.maxAbs.toExponential(3)} m <= ${IMPACT_X_ABS_BUDGET_M} m.`,
);

if (shouldRecord) {
  const record = {
    task: "P7.16",
    criterion: "matches CPU observables within f32 tolerance",
    criterionReading:
      "Reading (iii), settled in the 101st run's claim commit: the device reduction against " +
      "an f32 CPU reduction of the same algorithm over the same f32 fixed-step trajectory. " +
      "The weaker check against @ballista/analysis's f64 observables lives in " +
      "planar-observables-reduction.test.ts and is what keeps this from comparing a " +
      "transcription to its own twin.",
    provenance:
      "Correctness only. The adapter is recorded below; where it is software, these numbers " +
      "say what a conformant implementation computes and say NOTHING about throughput or " +
      "about the bandwidth saving the on-device reduction exists for. That is P7.20.",
    measuredAt: new Date().toISOString(),
    trajectories: comparison.trajectories,
    seed: `0x${SEED.toString(16)}`,
    h: FIXTURE_H,
    steps: FIXTURE_STEPS,
    p719: {
      criterion: "impact x within 1e-3 m of CPU on 1e4 batch",
      criterionReading:
        "Read on `range`, because neither side emits an absolute impact abscissa and every " +
        "scenario here launches from x0 = 0 so the two coincide numerically. The bar is " +
        "ABSOLUTE metres on |gpu - cpu|, not ULP and not relative. Settled in the 104th " +
        "run's claim commit before anything was measured.",
      impactXAbsBudgetM: IMPACT_X_ABS_BUDGET_M,
      impactXAbsBudgetBasis:
        "NOT implied by ulpBudget, which is why it is a separate gate: 256 ULP is under " +
        "1e-3 m only below a range of 64 m, and is 1.953e-3 m on [64, 128) where this " +
        "ensemble's ranges lie. Teeth: control C2 (theta=0.5 instead of the 60-iteration " +
        "bisection) measures 1987 ULP on range, which at O(100) m is 1.5e-2 m -- fifteen " +
        "times this bar -- so the gate rejects deleting the feature it gates.",
      measuredImpactXAbsM: rangeStat.maxAbs,
    },
    ulpBudget: ULP_BUDGET,
    ulpBudgetBasis:
      "Two-sided, and NOT derived from this run's result (which was exact). Above: P7.14 " +
      "gates the integration at 64 for FMA-contraction latitude, and the reduction adds a " +
      "few dozen operations on top of it, so 4x that. Below: control C2, which replaces the " +
      "60-iteration impact bisection with theta=0.5, measures 1987 ULP on range -- so the " +
      "budget must sit under that or it would permit deleting the feature under test. An " +
      "earlier draft of this script used 4096, which C2 passes; the control is what caught it.",
    adapterInfo: run.adapterInfo,
    chromiumVersion: run.chromiumVersion,
    flagSet: run.flagSet,
    deviceErrors: run.deviceErrors,
    impactedOnCpu: comparison.impactedOnCpu,
    impactedMismatches: comparison.impactedMismatches,
    identicalTrajectories: comparison.identicalTrajectories,
    perObservable: comparison.perObservable,
  };
  writeFileSync(resultsPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`Recorded to ${resultsPath}`);
}
