// GPU/CPU agreement for the WGSL RK4 kernel (P7.14's validation criterion).
//
// Runs the fixture ensemble two ways -- the f32 CPU reference under Node, and
// the WGSL kernel on a real WebGPU device inside Playwright Chromium -- and
// compares the final states channel by channel.
//
// ## Why a browser at all, and what took so long to notice
//
// P7.13 and the 98th run recorded that this container has no WebGPU. What they
// established is that *Node* has none, which is true and was never the whole
// question. Two things were missed:
//
//   1. WebGPU is exposed only in a SECURE CONTEXT. `about:blank` -- which is
//      what `page.setContent` leaves you on, as `measure-cross-engine-drift.mjs`
//      uses -- is not one, and reports no `navigator.gpu` at all. This script
//      therefore serves the page over `http://127.0.0.1`, which is.
//   2. Chromium ships SwiftShader's Vulkan ICD (`libvk_swiftshader.so`,
//      `vk_swiftshader_icd.json`) inside its own build directory, so a software
//      adapter is available with the right flags even with no GPU on the machine.
//
// ## WHAT THIS SCRIPT MAY AND MAY NOT BE USED TO CLAIM
//
// The adapter here is SOFTWARE. It runs the same WGSL through the same Tint
// compiler and produces numbers a conformant implementation would produce, so it
// answers a correctness question -- which is what P7.14's criterion is. It
// answers NO performance question. This script measures no time, reports no
// throughput and sweeps no workgroup size; those are P7.15, P7.20 and P7.22 and
// they need real hardware. The recorded adapter info is part of the result for
// exactly this reason: a reader must be able to see what the numbers were
// measured on.
//
// ## The metric is not the criterion's own metric, deliberately
//
// P7.14's validation line reads "1e4 trajectories match CPU f32 mode within 1e-4
// rel". The relative part of that is a bad gate on this model and P0.134 was
// filed for it before this script existed: near apex `vy` passes through zero, so
// a fixed relative bound is met or missed according to where a trajectory's last
// step lands rather than according to the kernel's accuracy. This fixture
// deliberately includes such trajectories instead of excluding them.
//
// So the gate is ULP distance in binary32, with absolute and relative figures
// reported alongside as documentation. ULP is the right unit for "the same
// computation, rounded differently", and the budget cannot be zero: WGSL permits
// an implementation to contract `a * b + c` into an FMA, which rounds once where
// the CPU reference rounds twice. That is the same argument P7.11 settled for the
// backend-equivalence golden, and the reason `backend-equivalence` can assert
// bit-identity for WASM while this cannot -- the WebAssembly MVP has no FMA
// instruction.
//
// ## One control does NOT fire here, and it is the most useful thing this script
// ## learned about its own limits
//
// Swapping the manual `sqrt((a*a)+(b*b))` for the `length()` builtin -- the exact
// substitution `wgsl-rk4-kernel.ts` warns about, on the grounds that `length()` is
// permitted a different error bound -- leaves the result **bit-identical** on this
// adapter. So this numerical comparison cannot see that class of change at all,
// and the source-level correspondence check in `wgsl-rk4-kernel.test.ts` is the
// only thing protecting the property on the implementations where it would matter.
// That is not a redundancy between the two test layers; it is a division of labour,
// and each covers what the other is blind to.
//
// Requires `packages/{runtime,solverkit}/dist` to be built (`pnpm typecheck`).

import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as esbuild from "esbuild";

import { buildEnsemble, computeCpuReference } from "./gpu-rk4-agreement-fixture.mjs";

const rootDir = join(import.meta.dirname, "..");
const resultsPath = join(rootDir, "scripts", "gpu-rk4-agreement-results.json");
const fixtureEntry = join(rootDir, "scripts", "gpu-rk4-agreement-fixture.mjs");

/** The criterion's trajectory count, taken literally. */
const CRITERION_TRAJECTORIES = 10_000;

/**
 * Overridable only downward-compatibly, and never for a recorded run.
 *
 * The override exists because a negative control needs to demonstrate a failure,
 * not a precise figure, and a reduced ensemble makes a control loop minutes
 * shorter. It is refused under `--record` below: the committed results file claims
 * to answer a criterion that names 1e4 trajectories, and a 2000-trajectory run
 * filed under that name would be a smaller measurement wearing a larger one's
 * label.
 */
const TRAJECTORIES = Number(process.env.BALLISTA_GPU_TRAJECTORIES ?? CRITERION_TRAJECTORIES);
const SEED = 0x7a14c0de;
const CHANNELS = ["x", "y", "vx", "vy"];

/**
 * ULP budget, and the honest argument for its size.
 *
 * **It is NOT derived from the measurement, because the measurement came back
 * zero.** On SwiftShader this kernel is bit-identical to the f32 CPU reference on
 * all 1e4 trajectories, so "measured worst case plus headroom" would set the
 * budget at 0 and there is no data here arguing for any positive number. Saying
 * so is the point: a budget presented as empirical when the empirical answer was
 * exact would be a fabricated derivation.
 *
 * The budget is non-zero for a specification reason instead. WGSL permits an
 * implementation to contract `a * b + c` into an FMA, which rounds once where the
 * CPU reference rounds twice, so a conformant driver may legally disagree in the
 * last bits however carefully the host is written. SwiftShader evidently does not
 * contract these parenthesised expressions; **that is one implementation's
 * behaviour and not a property of the kernel**, and gating at 0 would convert the
 * first hardware driver that does contract into a red build rather than a
 * measurement. This is the same shape P7.11 settled for the backend-equivalence
 * golden, and the reason `backend-equivalence` can assert bit-identity for WASM
 * while this cannot: the WebAssembly MVP has no FMA instruction.
 *
 * 64 is small enough to keep failing loudly for the defect class that matters,
 * and that claim is measured rather than asserted -- the controls run against
 * this script put a perturbation of one tableau weight in its eighth digit at
 * **39536** ULP on `vy`, an f64 reference against the f32 kernel at **24964**, an
 * under-dispatch at ~1.1e9, and a mis-strided parameter buffer at infinity. Every
 * defect this gate exists to catch is three to seven orders of magnitude above it.
 */
const ULP_BUDGET = 64;

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
 * Uses the monotonic-ordering trick: reinterpreting a float's bits as a sign-
 * magnitude integer and mapping it to a two's-complement ordering makes adjacent
 * representable values adjacent integers, so subtraction counts them. Handles
 * zero-crossing correctly, which matters here because `vy` does exactly that.
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
  const perChannel = CHANNELS.map((name) => ({
    channel: name,
    maxAbs: 0,
    maxUlp: 0,
    maxRelative: 0,
    worstAbsAt: null,
    worstUlpAt: null,
    worstRelativeAt: null,
  }));
  let identicalTrajectories = 0;
  let identicalValues = 0;

  const count = reference.length / CHANNELS.length;
  for (let i = 0; i < count; i++) {
    let trajectoryIdentical = true;
    for (let c = 0; c < CHANNELS.length; c++) {
      const idx = i * CHANNELS.length + c;
      const r = reference[idx];
      const s = sample[idx];
      const stat = perChannel[c];
      if (r === s) {
        identicalValues += 1;
      } else {
        trajectoryIdentical = false;
      }
      const abs = Math.abs(r - s);
      const ulp = ulpDistance(r, s);
      const rel = Math.abs(r) > RELATIVE_FLOOR ? abs / Math.abs(r) : 0;
      if (abs > stat.maxAbs) {
        stat.maxAbs = abs;
        stat.worstAbsAt = { trajectory: i, reference: r, gpu: s };
      }
      if (ulp > stat.maxUlp) {
        stat.maxUlp = ulp;
        stat.worstUlpAt = { trajectory: i, reference: r, gpu: s, abs };
      }
      if (rel > stat.maxRelative) {
        stat.maxRelative = rel;
        stat.worstRelativeAt = { trajectory: i, reference: r, gpu: s, abs };
      }
    }
    if (trajectoryIdentical) identicalTrajectories += 1;
  }
  return { perChannel, identicalTrajectories, identicalValues, totalValues: reference.length };
}

// ---------------------------------------------------------------------------

console.log(`Building ensemble of ${TRAJECTORIES} trajectories (seed 0x${SEED.toString(16)})...`);
const ensemble = buildEnsemble(TRAJECTORIES, SEED);
console.log(
  `Computing f32 CPU reference (h=${ensemble.h}, steps=${ensemble.steps}, round=toF32)...`,
);
const reference = computeCpuReference(ensemble);

const bundle = await esbuild.build({
  entryPoints: [fixtureEntry],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "__ballistaGpuRk4",
  write: false,
});
const bundleCode = bundle.outputFiles[0].text;

// WebGPU is secure-context only, so the page must not be about:blank.
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<!doctype html><title>gpu-rk4-agreement</title><body></body>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

/**
 * Flag sets, most-preferred first.
 *
 * Measured in this image: the first two yield a SwiftShader adapter and the bare
 * launch does not. `forceFallbackAdapter: true` alone does not either, which is
 * why the flags are here rather than in the `requestAdapter` call.
 */
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

/**
 * Optional browser override.
 *
 * Playwright resolves a Chromium build matching its own pinned revision, which a
 * sandbox with a different revision pre-installed does not have -- the failure is
 * "Executable doesn't exist at .../chromium_headless_shell-1228/...", which reads
 * like a missing install rather than a version mismatch. `BALLISTA_CHROMIUM_PATH`
 * points at a full Chromium binary instead. Note "full": the headless shell is
 * not enough, as WebGPU needs the GPU process the shell does not ship.
 */
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
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.addScriptTag({ content: bundleCode });
    const result = await page.evaluate(
      ([count, seed]) => window.__ballistaGpuRk4.runGpuEnsemble(count, seed),
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
  // Never report an all-clear derived from nothing measured -- the same rule
  // P0.102 established for the cross-engine drift script.
  console.warn(
    `::warning::No WebGPU device could be obtained (${run.reason ?? run.error}), so GPU/CPU agreement was NOT checked. This is not a pass.`,
  );
  if (shouldRecord) {
    console.warn(
      `::warning::--record was passed but nothing was measured; leaving ${resultsPath} unmodified rather than downgrading it.`,
    );
  }
  process.exit(0);
}

const sample = Float32Array.from(run.finalStates);
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
  `Final-state agreement over ${TRAJECTORIES} trajectories (gate: ULP <= ${ULP_BUDGET}):`,
);
for (const stat of comparison.perChannel) {
  console.log(
    `  ${stat.channel.padEnd(3)} maxUlp=${String(stat.maxUlp).padStart(6)}  ` +
      `maxAbs=${stat.maxAbs.toExponential(3)}  maxRel=${stat.maxRelative.toExponential(3)}`,
  );
}
console.log(
  `  bit-identical: ${comparison.identicalTrajectories}/${TRAJECTORIES} trajectories, ` +
    `${comparison.identicalValues}/${comparison.totalValues} values`,
);

const worstUlp = Math.max(...comparison.perChannel.map((s) => s.maxUlp));
const worstRelative = Math.max(...comparison.perChannel.map((s) => s.maxRelative));
console.log("");
console.log(
  `The criterion's own metric, reported and NOT gated (P0.134): max relative = ` +
    `${worstRelative.toExponential(3)} against its stated 1e-4. ` +
    (worstRelative > 1e-4
      ? "It is exceeded; see the per-channel absolute figures above before reading that as a defect."
      : "It is met, on this fixture, for whatever that is worth as a metric."),
);

const record = {
  schemaVersion: 1,
  recordedAt: new Date().toISOString().slice(0, 10),
  task: "P7.14",
  trajectories: TRAJECTORIES,
  seed: `0x${SEED.toString(16)}`,
  h: ensemble.h,
  steps: ensemble.steps,
  ulpBudget: ULP_BUDGET,
  provenance:
    "Measured by `node scripts/measure-gpu-rk4-agreement.mjs --record`. The WGSL kernel ran on the adapter recorded below inside Playwright-driven Chromium, served over http://127.0.0.1 because WebGPU is secure-context only; the reference is `integratePlanarRk4` with `round: toF32` (true f32, every intermediate rounded) under Node. THE ADAPTER IS SOFTWARE (SwiftShader), so these are correctness numbers and not performance numbers -- no timing, throughput or workgroup-size figure is measured here or may be inferred from this file. The gate is ULP distance in binary32; the relative figure is recorded as documentation only, because P0.134 establishes that a fixed relative bound on this model is decided by where a trajectory's last step falls relative to apex rather than by the kernel's accuracy.",
  adapter: run.adapterInfo,
  chromiumVersion: run.chromiumVersion,
  chromiumFlags: run.flags,
  deviceErrors: run.deviceErrors,
  agreement: {
    perChannel: comparison.perChannel,
    identicalTrajectories: comparison.identicalTrajectories,
    identicalValues: comparison.identicalValues,
    totalValues: comparison.totalValues,
    maxUlpAnyChannel: worstUlp,
    maxRelativeAnyChannel: worstRelative,
  },
};

if (shouldRecord) {
  writeFileSync(resultsPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`\nWrote measured results to ${resultsPath}`);
} else {
  console.log(`\nNot writing ${resultsPath} (pass --record to update it).`);
}

if (worstUlp > ULP_BUDGET) {
  console.error(
    `\nFAIL: worst-channel ULP distance ${worstUlp} exceeds the budget of ${ULP_BUDGET}. ` +
      `This is a real disagreement, not a tolerance to widen: check the tableau, the drag ` +
      `factor's parenthesisation, the manual sqrt, and the parameter stride before touching ` +
      `the budget.`,
  );
  process.exit(1);
}
console.log(
  `\nPASS: worst-channel ULP distance ${worstUlp} is within the budget of ${ULP_BUDGET}.`,
);
