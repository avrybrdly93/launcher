import { writeFileSync } from "node:fs";
import {
  GravityForce,
  QuadraticDragForce,
  createEvalContext,
  createPlanarProjectileModel,
} from "@ballista/engine";
import { RK4_TABLEAU } from "@ballista/solverkit";
import {
  WASM_ARTIFACT_PATH,
  WASM_SIMD_ARTIFACT_PATH,
  WasmRk4Kernel,
  wasmSimdSupported,
} from "@ballista/wasm-core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ASSERTED_TOLERANCE_ULP,
  BLUEPRINT_RELATIVE_TOLERANCE,
  CRATE_SOURCE_FILES,
  GOLDEN_PATH,
  REPLICATE_COUNT,
  STEPS,
  artifactHash,
  bitMismatchCount,
  crateSourceHash,
  goldenJob,
  maxRelativeDifference,
  observablesHash,
  readGolden,
  recordGolden,
  type BackendEquivalenceGolden,
} from "./backend-equivalence-golden.js";
import {
  ENSEMBLE_OBS,
  ENSEMBLE_OBS_COUNT,
  ensembleEnvironment,
  ensembleReplicateParams,
  runTsEnsembleRange,
  type EnsembleJobSpec,
} from "./ensemble-job.js";
import { createTsEnsembleBackend, createWasmEnsembleBackend } from "./heterogeneous-executor.js";

/**
 * P7.11: backend equivalence against a **committed golden**, not against the
 * other backend.
 *
 * P7.10's suite already proves TypeScript and WASM agree with each other. The
 * hole that leaves, and the one this file closes, is that a change moving both
 * sides together -- a physics edit mirrored into the Rust, a defect in the
 * shared lowering -- keeps that suite green. The golden is a frozen third
 * point neither backend can move.
 *
 * **THE TASK'S OWN CRITERION IS NOT A GATE, AND THE STUDY AT THE BOTTOM
 * MEASURES WHY.** P7.11's validation line reads "max rel. diff < 1e-12". The
 * control builds the one defect this whole line of work exists to catch --
 * RK4's final increment accumulated as `((y + h*b0*k0) + ...)` instead of
 * `y + h*(b0*k0 + ...)`, which is `explicit-rk-kernel.ts`'s own documented
 * hazard and P7.07's actual defect -- and sweeps it across step counts.
 *
 * The expectation going in, inherited from the 94th run's single measurement,
 * was that it would sit near 2.5e-13 and be comfortably inside 1e-12
 * everywhere. **It is not.** The max relative difference is erratic and
 * non-monotonic: ~3.7e-16 at 1 step, ~1.7e-14 at 300, **~1.5e-12 at 400**. So
 * the blueprint's tolerance passes this defect at some fixture sizes and
 * catches it at others, and integrating further is not a way to be safe.
 *
 * The mechanism is measured rather than guessed. The max *absolute*
 * difference barely moves across those step counts (~7.7e-13 at 300, ~8.5e-13
 * at 400). What moves is the denominator: at 400 steps the worst slot is the
 * `vy` of a replicate near its apex, magnitude 2.98e-2, so a 4.6e-14 absolute
 * error reads as 1.5e-12; at 300 steps it is a `vy` of magnitude 1.51 and a
 * similar error reads as 1.7e-14. **A relative tolerance divides by a quantity
 * this model drives through zero**, so what it reports is how near some
 * replicate happened to be to apex at the final step -- an accident of the
 * fixture, not a property of the defect.
 *
 * Bit-identity catches it at every step count swept, 124-284 of 390 slots
 * wrong throughout. That is why the gate is {@link ASSERTED_TOLERANCE_ULP}
 * and 1e-12 is recorded as documentation. P7.07 made the same call at 1e-15,
 * on the narrower ground that the number was merely too large; this is the
 * stronger version -- the *instrument* is unstable on this model.
 *
 * Re-record with `pnpm update:backend-golden`, on a machine with a Rust
 * toolchain so `wasm-artifact-freshness.test.ts` runs rather than skips.
 */

const UPDATE = process.env.UPDATE_GOLDENS === "1";

let golden: BackendEquivalenceGolden;
let tsRows: Float64Array;
let goldenRows: Float64Array;
let scalarRows: Float64Array;
let simdRows: Float64Array | undefined;
let job: EnsembleJobSpec;

beforeAll(async () => {
  job = goldenJob();
  tsRows = runTsEnsembleRange(job, 0, job.replicates.length);

  if (UPDATE) {
    writeFileSync(GOLDEN_PATH, `${JSON.stringify(recordGolden(), null, 2)}\n`);
  }
  golden = readGolden();
  goldenRows = Float64Array.from(golden.observables.rows);

  const scalarKernel = await WasmRk4Kernel.instantiate();
  const scalarBackend = createWasmEnsembleBackend(scalarKernel, { useSimd: false });
  scalarRows = (await scalarBackend.runRange(job, 0, job.replicates.length)).rows;

  // A second, genuinely separate measurement -- not a repeat of the first --
  // only where the engine actually has simd128. `instantiateBest` hands back
  // the scalar module where it does not, and comparing that to itself would
  // report a green that means nothing.
  if (wasmSimdSupported()) {
    const simdKernel = await WasmRk4Kernel.instantiateBest();
    if (simdKernel.hasSimd) {
      const simdBackend = createWasmEnsembleBackend(simdKernel, { useSimd: true });
      simdRows = (await simdBackend.runRange(job, 0, job.replicates.length)).rows;
    }
  }
}, 60_000);

describe("the fixture is not vacuous", () => {
  it("has an odd replicate count, so the SIMD tail is on the recorded path", () => {
    // P7.09: `batch_run_simd` walks pairs and finishes with a scalar tail. An
    // even count would record only the vectorised path and leave the tail
    // untested by the golden.
    expect(REPLICATE_COUNT % 2).toBe(1);
  });

  it("uses a step size that is not a power of two", () => {
    // P7.10 control B: with a dyadic `h`, accumulating `t` and multiplying
    // `i*h` give the same double, and a `t_final` control passes a broken
    // backend. `0.0071` makes the two forms differ.
    const h = job.h;
    expect(Number.isInteger(Math.log2(h))).toBe(false);
  });

  it("varies every replicate, so a lane swap would be visible", () => {
    // P7.09's characteristic defect is correct numbers in the wrong rows,
    // which is bit-identical against a homogeneous ensemble. Every adjacent
    // pair must genuinely differ before any equality below means anything.
    for (let r = 0; r + 1 < REPLICATE_COUNT; r++) {
      const a = goldenRows.subarray(r * ENSEMBLE_OBS_COUNT, (r + 1) * ENSEMBLE_OBS_COUNT);
      const b = goldenRows.subarray((r + 1) * ENSEMBLE_OBS_COUNT, (r + 2) * ENSEMBLE_OBS_COUNT);
      expect(bitMismatchCount(a as Float64Array, b as Float64Array)).toBeGreaterThan(0);
    }
  });

  it("spans rising and falling trajectories, so the running max branches both ways", () => {
    let rising = 0;
    let falling = 0;
    for (let r = 0; r < REPLICATE_COUNT; r++) {
      const o = r * ENSEMBLE_OBS_COUNT;
      // A replicate that never rose has its launch height as its max.
      if (goldenRows[o + ENSEMBLE_OBS.maxSampledHeight]! > job.replicates[r]!.y0) rising++;
      else falling++;
    }
    expect(rising).toBeGreaterThan(0);
    expect(falling).toBeGreaterThan(0);
  });

  it("integrates something: every observable is finite and the ensemble moved", () => {
    expect(goldenRows.length).toBe(REPLICATE_COUNT * ENSEMBLE_OBS_COUNT);
    for (const v of goldenRows) expect(Number.isFinite(v)).toBe(true);
    // Guards the degenerate golden: a NaN spec would make both sides NaN and
    // `Object.is` would call that equal (see `validateEnsembleJob`).
    for (let r = 0; r < REPLICATE_COUNT; r++) {
      const o = r * ENSEMBLE_OBS_COUNT;
      expect(goldenRows[o + ENSEMBLE_OBS.x]).not.toBe(job.replicates[r]!.x0);
    }
  });
});

describe("the golden pins what it was recorded against", () => {
  it("matches the committed scalar artifact's bytes", () => {
    // CI has no Rust, so `wasm-artifact-freshness.test.ts` skips there. This
    // check needs no toolchain and still goes red if the artifact moved
    // without the golden being re-recorded.
    expect(golden.sources.scalarArtifactSha256).toBe(artifactHash(WASM_ARTIFACT_PATH));
  });

  it("matches the committed simd artifact's bytes", () => {
    expect(golden.sources.simdArtifactSha256).toBe(artifactHash(WASM_SIMD_ARTIFACT_PATH));
  });

  it("matches the crate sources those artifacts are built from", () => {
    // THIS is the check the 94th run's handover asked for. Edit the crate and
    // forget to rebuild, and CI -- with no compiler at all -- still says so.
    // What it does NOT establish is that the artifact was compiled from this
    // source; only a compiler can, and the freshness suite is what does it.
    expect(golden.sources.crateSourceSha256).toBe(crateSourceHash());
  });

  it("names the crate files it hashed, so the pin's scope is legible", () => {
    expect(golden.sources.crateFiles).toEqual([...CRATE_SOURCE_FILES]);
  });

  it("carries observables whose hash is recomputable from the rows themselves", () => {
    // Stops a hand-edited `sha256` from standing over rows it does not
    // describe -- the same arrangement `simd-benchmark.test.ts` uses to keep
    // a recorded verdict honest about its own medians.
    expect(golden.observables.sha256).toBe(observablesHash(goldenRows));
  });

  it("records the criterion this module states, so the gate cannot be relaxed in the fixture", () => {
    expect(golden.criterion.blueprintRelativeTolerance).toBe(BLUEPRINT_RELATIVE_TOLERANCE);
    expect(golden.criterion.assertedToleranceUlp).toBe(ASSERTED_TOLERANCE_ULP);
  });
});

describe("the backends reproduce the golden (P7.11 validation criterion)", () => {
  it("TypeScript is bit-identical to the golden, every slot", () => {
    expect(bitMismatchCount(tsRows, goldenRows)).toBe(0);
  });

  it("the scalar WASM kernel is bit-identical to the golden, every slot", () => {
    expect(scalarRows.length).toBe(goldenRows.length);
    expect(bitMismatchCount(scalarRows, goldenRows)).toBe(0);
  });

  it.skipIf(!wasmSimdSupported())(
    "the f64x2 WASM kernel is bit-identical to the golden, every slot",
    () => {
      expect(simdRows).toBeDefined();
      expect(bitMismatchCount(simdRows!, goldenRows)).toBe(0);
    },
  );

  it("reports the measured max relative difference, which is what the criterion asks be documented", () => {
    const scalar = maxRelativeDifference(scalarRows, goldenRows);
    expect(scalar.value).toBe(0);
    expect(scalar.value).toBeLessThan(BLUEPRINT_RELATIVE_TOLERANCE);
    expect(golden.criterion.measuredMaxRelativeDifference).toBe(0);
    if (simdRows !== undefined) {
      expect(maxRelativeDifference(simdRows, goldenRows).value).toBe(0);
    }
  });

  it("the executor's own TS backend agrees too, so the golden covers the dispatch path", async () => {
    const rows = (await createTsEnsembleBackend().runRange(job, 0, REPLICATE_COUNT)).rows;
    expect(bitMismatchCount(rows, goldenRows)).toBe(0);
  });
});

/**
 * The control that justifies the gate.
 *
 * Transcribed from `stepExplicitRK` term for term so that with
 * `reassociate: false` it reproduces the reference bit-for-bit -- asserted
 * first, because without it the control would only show that two different
 * implementations differ. With that established, the grouping is the single
 * thing the `true` case changes.
 */
function runHandRolledRk4(job: EnsembleJobSpec, reassociate: boolean): Float64Array {
  const rows = new Float64Array(REPLICATE_COUNT * ENSEMBLE_OBS_COUNT);
  const environment = ensembleEnvironment(job);
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const { c, a, b } = RK4_TABLEAU;
  const dim = model.dim;
  const k = Array.from({ length: c.length }, () => new Float64Array(dim));
  const yStage = new Float64Array(dim);
  const y = new Float64Array(dim);
  const yNext = new Float64Array(dim);

  for (let r = 0; r < REPLICATE_COUNT; r++) {
    const rep = job.replicates[r]!;
    const ctx = createEvalContext(environment, ensembleReplicateParams(rep));
    y.set([rep.x0, rep.y0, rep.vx0, rep.vy0]);
    let max = y[1]!;

    for (let step = 0; step < job.steps; step++) {
      const t = job.t0 + step * job.h;
      for (let s = 0; s < c.length; s++) {
        const aRow = a[s]!;
        for (let i = 0; i < dim; i++) {
          let yi = y[i]!;
          for (let j = 0; j < aRow.length; j++) yi += job.h * aRow[j]! * k[j]![i]!;
          yStage[i] = yi;
        }
        model.rhs(t + c[s]! * job.h, yStage, k[s]!, ctx);
      }
      for (let i = 0; i < dim; i++) {
        if (reassociate) {
          let acc = y[i]!;
          for (let s = 0; s < c.length; s++) acc += job.h * b[s]! * k[s]![i]!;
          yNext[i] = acc;
        } else {
          let increment = 0;
          for (let s = 0; s < c.length; s++) increment += b[s]! * k[s]![i]!;
          yNext[i] = y[i]! + job.h * increment;
        }
      }
      y.set(yNext);
      if (y[1]! > max) max = y[1]!;
    }

    rows.set([y[0]!, y[1]!, y[2]!, y[3]!, job.t0 + job.steps * job.h, max], r * ENSEMBLE_OBS_COUNT);
  }
  return rows;
}

/**
 * Step counts the study below sweeps. Small and spread rather than dense: the
 * point is that the verdict *changes* across them, which one crossing shows as
 * well as fifty.
 */
const STUDY_STEPS = [1, 10, 100, 300, STEPS] as const;

describe("why the gate is 0 ULP and not the blueprint's 1e-12", () => {
  it("the control's faithful form is bit-identical, so the reassociation is the only variable", () => {
    expect(bitMismatchCount(runHandRolledRk4(job, false), goldenRows)).toBe(0);
  });

  it("bit-identity catches the reassociated defect at EVERY step count swept", () => {
    // The stable half of the finding. The defect is caught at 1 step and at
    // 400, with a large fraction of slots wrong throughout -- the ULP gate's
    // verdict does not depend on how far the ensemble was integrated.
    for (const steps of STUDY_STEPS) {
      const swept = { ...job, steps };
      const reference = runTsEnsembleRange(swept, 0, REPLICATE_COUNT);
      const broken = runHandRolledRk4(swept, true);
      expect(bitMismatchCount(broken, reference), `steps=${steps}`).toBeGreaterThan(0);
    }
  });

  it("a relative-tolerance gate's verdict on the SAME defect flips with the step count", () => {
    // THE ARGUMENT OF THIS TASK, MEASURED RATHER THAN ASSERTED.
    //
    // The claim commit inherited the 94th run's figure and expected this
    // defect to sit at ~2.5e-13, comfortably inside 1e-12 everywhere. It does
    // not. Swept across step counts the max relative difference is erratic and
    // NON-MONOTONIC -- ~3.7e-16 at 1 step, ~1.7e-14 at 300, ~1.5e-12 at 400 --
    // so at some fixture sizes a 1e-12 gate passes the defect and at others it
    // catches it, and integrating further is not a way to be safe.
    //
    // The mechanism, measured: the max ABSOLUTE difference barely moves
    // (~7.7e-13 at 300 steps, ~8.5e-13 at 400). What moves is the denominator.
    // At 400 steps the worst slot is the `vy` of a replicate near its apex,
    // magnitude 2.98e-2, where an absolute error of 4.6e-14 reads as 1.5e-12;
    // at 300 steps it is a `vy` of magnitude 1.51 and the same size of error
    // reads as 1.7e-14. A relative metric divides by a quantity this model
    // drives through zero, so its value reports how close some replicate
    // happened to be to apex at the final step -- an accident of the fixture,
    // not a property of the defect.
    //
    // Hence the gate is bit-identity: it is the one instrument here whose
    // reading is about the defect.
    const verdicts = STUDY_STEPS.map((steps) => {
      const swept = { ...job, steps };
      const reference = runTsEnsembleRange(swept, 0, REPLICATE_COUNT);
      const broken = runHandRolledRk4(swept, true);
      return {
        steps,
        relative: maxRelativeDifference(broken, reference).value,
      };
    });

    for (const v of verdicts) expect(v.relative, `steps=${v.steps}`).toBeGreaterThan(0);

    const passedByBlueprint = verdicts.filter((v) => v.relative < BLUEPRINT_RELATIVE_TOLERANCE);
    const caughtByBlueprint = verdicts.filter((v) => v.relative >= BLUEPRINT_RELATIVE_TOLERANCE);

    // Both sets are non-empty: the same defect, the same code, two verdicts.
    expect(
      passedByBlueprint.length,
      `a 1e-12 gate should pass this defect at some step counts; got ${JSON.stringify(verdicts)}`,
    ).toBeGreaterThan(0);
    expect(
      caughtByBlueprint.length,
      `a 1e-12 gate should catch this defect at some step counts; got ${JSON.stringify(verdicts)}`,
    ).toBeGreaterThan(0);
  });
});
