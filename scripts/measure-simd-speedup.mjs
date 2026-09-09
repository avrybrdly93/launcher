// P7.09's validation criterion: ">=1.8x vs scalar WASM on batch benchmark".
//
// WHAT THIS SCRIPT OWNS. The instruments and the artifact, and nothing else.
// The workload, the two baselines and the verdict rule live in
// packages/wasm-core/src/simd-benchmark.ts, where simd-benchmark.test.ts
// asserts them without taking a measurement. Same split as
// measure-ensemble-memory.mjs and measure-batch-throughput.mjs, for the reason
// those give: a benchmark whose definition lives only in its own script is a
// benchmark nothing can check.
//
// WHY THE CORRECTNESS CHECK RUNS FIRST AND ABORTS THE RUN. A faster kernel that
// computes something else is not a faster kernel, and a speed number reported
// beside a silently wrong result is worse than no number at all. So before any
// timing, both paths run once over the same arena and every observable slot is
// compared with Object.is. A mismatch exits non-zero without reporting a ratio.
// The real bit-identity suite is wasm-simd.test.ts; this is the guard that
// stops THIS script from publishing a number it should not.
//
// TWO BASELINES, AND WHY BOTH ARE REPORTED. The criterion says "scalar WASM",
// which is the committed ballista-core.wasm built with no target features -- the
// binary a non-SIMD engine actually runs -- so that ratio is the verdict. The
// second, batch_run inside the +simd128 build, controls for codegen and JIT
// state: both paths then live in one module compiled by one rustc invocation.
// If those two ratios ever diverge, the headline is measuring the build rather
// than the vectorisation.
//
// MEDIAN, NOT MEAN. A single slow repetition is a scheduler artefact and the
// mean carries it; the median does not. Min is recorded too, because on a quiet
// machine it is the closest thing to the work the CPU actually has to do, and
// its ratio disagreeing with the median's would say the machine was not quiet.
//
// SOFT-WARN, like this repository's other perf checks: a missed criterion
// prints `::warning::` and exits 0. The artifact is the deliverable; the exit
// code is not the evidence. `--strict` makes it exit 1 for a run that wants a
// gate. A correctness mismatch is not soft -- that always exits 1.
//
// WRITING IS OPT-IN (P0.102). `--record` updates the committed artifact;
// without it the script measures, reports, and touches nothing.
//
// Usage:
//   node scripts/measure-simd-speedup.mjs [--record] [--strict]

import { readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";

const ARTIFACT_PATH = new URL("./simd-speedup-results.json", import.meta.url);
const SCALAR_WASM = new URL(
  "../packages/wasm-core/src/generated/ballista-core.wasm",
  import.meta.url,
);
const SIMD_WASM = new URL(
  "../packages/wasm-core/src/generated/ballista-core.simd.wasm",
  import.meta.url,
);

const args = {
  record: process.argv.includes("--record"),
  strict: process.argv.includes("--strict"),
};

// THE WORKLOAD IS MIRRORED HERE RATHER THAN IMPORTED, and that is a real cost
// worth naming: simd-benchmark.ts is TypeScript and this script is plain node,
// so importing it would mean a build step or a loader dependency for four
// constants. The duplication is made safe rather than tolerated --
// simd-benchmark.test.ts reads this file and asserts the numbers agree with the
// module's, so a drift is a test failure and not a silently different
// benchmark.
const CRITERION = 1.8;
const WORKLOAD = {
  replicates: 2001,
  steps: 400,
  h: 0.001,
  warmupRounds: 10,
  repetitions: 15,
};

const params = (r) => {
  const f = r / WORKLOAD.replicates;
  return [1 + f, 0.01 + 0.005 * f, 0.3 + 0.4 * f, 1.225, 9.81, 2 * f - 1, 0.5 * f];
};
const state = (r) => {
  const f = r / WORKLOAD.replicates;
  return [0, 1 + 10 * f, 30 + 50 * f, 60 - 120 * f];
};

const median = (xs) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1];
};

async function load(url) {
  const bytes = readFileSync(url);
  const { instance } = await WebAssembly.instantiate(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    {},
  );
  const e = instance.exports;
  const n = WORKLOAD.replicates;
  if (e.batch_init(n) !== 1) {
    throw new Error("batch_init refused to reserve the arena");
  }
  const p = new Float64Array(e.memory.buffer, e.batch_params_ptr(), n * e.param_count());
  const s = new Float64Array(e.memory.buffer, e.batch_states_ptr(), n * e.dim());
  for (let r = 0; r < n; r += 1) {
    p.set(params(r), r * e.param_count());
    s.set(state(r), r * e.dim());
  }
  return e;
}

const observables = (e) =>
  new Float64Array(e.memory.buffer, e.batch_observables_ptr(), WORKLOAD.replicates * e.obs_count());

function timeOnce(fn) {
  const started = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - started) / 1e6;
}

async function main() {
  const scalar = await load(SCALAR_WASM);
  const simd = await load(SIMD_WASM);

  if (simd.simd_enabled() !== 1 || typeof simd.batch_run_simd !== "function") {
    console.error("measure-simd-speedup: the simd artifact has no SIMD path. Rebuild it.");
    process.exit(1);
  }
  if (scalar.simd_enabled() !== 0) {
    console.error("measure-simd-speedup: the scalar artifact reports SIMD. Rebuild both.");
    process.exit(1);
  }

  const { replicates: n, steps, h } = WORKLOAD;

  // Correctness before speed. See the header.
  scalar.batch_run(0, h, steps, n);
  const reference = Float64Array.from(observables(scalar));
  observables(simd).fill(0);
  simd.batch_run_simd(0, h, steps, n);
  const produced = observables(simd);
  for (let i = 0; i < reference.length; i += 1) {
    if (!Object.is(reference[i], produced[i])) {
      console.error(
        `measure-simd-speedup: SIMD and scalar disagree at slot ${i} ` +
          `(replicate ${Math.floor(i / simd.obs_count())}): ${reference[i]} vs ${produced[i]}. ` +
          "No timing reported.",
      );
      process.exit(1);
    }
  }

  const paths = {
    scalarArtifact: () => scalar.batch_run(0, h, steps, n),
    scalarInSimdBuild: () => simd.batch_run(0, h, steps, n),
    simd: () => simd.batch_run_simd(0, h, steps, n),
  };

  for (let i = 0; i < WORKLOAD.warmupRounds; i += 1) {
    for (const run of Object.values(paths)) run();
  }

  const samples = {};
  for (const [name, run] of Object.entries(paths)) {
    const xs = [];
    for (let i = 0; i < WORKLOAD.repetitions; i += 1) xs.push(timeOnce(run));
    samples[name] = xs;
  }

  const med = Object.fromEntries(Object.entries(samples).map(([k, xs]) => [k, median(xs)]));
  const min = Object.fromEntries(Object.entries(samples).map(([k, xs]) => [k, Math.min(...xs)]));

  const verdict = {
    speedupVsScalarArtifact: med.scalarArtifact / med.simd,
    speedupVsScalarInSimdBuild: med.scalarInSimdBuild / med.simd,
    criterion: CRITERION,
    pass: med.scalarArtifact / med.simd >= CRITERION,
  };

  const report = {
    task: "P7.09",
    criterion: ">=1.8x vs scalar WASM on batch benchmark",
    recordedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: cpus().length,
    },
    workload: WORKLOAD,
    reading: {
      medianMs: med,
      minMs: min,
      // The min-based ratio is recorded rather than reported: it answers "was
      // the machine quiet?", and a large gap from the median ratio is the
      // signal that it was not.
      speedupFromMins: min.scalarArtifact / min.simd,
    },
    verdict,
  };

  const fmt = (x) => x.toFixed(2).padStart(7);
  console.log("P7.09 SIMD speedup");
  console.log(`  workload               ${n} replicates x ${steps} steps, h = ${h}`);
  console.log(`  bit-identity           PASS (all ${reference.length} slots, Object.is)`);
  console.log(
    `  scalar artifact        ${fmt(med.scalarArtifact)} ms   (median of ${WORKLOAD.repetitions})`,
  );
  console.log(`  scalar in simd build   ${fmt(med.scalarInSimdBuild)} ms`);
  console.log(`  f64x2 simd             ${fmt(med.simd)} ms`);
  console.log(
    `  speedup                ${verdict.speedupVsScalarArtifact.toFixed(3)}x vs scalar artifact` +
      `   (criterion ${CRITERION}x)`,
  );
  console.log(
    `                         ${verdict.speedupVsScalarInSimdBuild.toFixed(3)}x vs scalar in simd build`,
  );
  console.log(`                         ${report.reading.speedupFromMins.toFixed(3)}x from minima`);
  console.log(`  verdict                ${verdict.pass ? "PASS" : "FAIL"}`);

  if (args.record) {
    writeFileSync(ARTIFACT_PATH, JSON.stringify(report, null, 2) + "\n");
    console.log(`  recorded to            ${ARTIFACT_PATH.pathname}`);
  }

  if (!verdict.pass) {
    console.log(
      `::warning::P7.09 SIMD speedup ${verdict.speedupVsScalarArtifact.toFixed(3)}x did not meet the ${CRITERION}x criterion`,
    );
    if (args.strict) process.exitCode = 1;
  }
}

await main();
