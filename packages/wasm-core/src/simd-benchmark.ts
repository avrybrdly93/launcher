/**
 * Definition of P7.09's benchmark: the workload, the baselines, and the rule
 * that turns timings into a verdict.
 *
 * **The measurement is not here.** `scripts/measure-simd-speedup.mjs` owns the
 * instruments and the artifact; this module owns what is being measured and
 * what counts as passing, so `simd-benchmark.test.ts` can assert both without
 * taking a timing. Same split as `measure-ensemble-memory.mjs` and
 * `memory-audit.ts` (P7.06), for the same reason given there: a benchmark whose
 * definition lives only inside its own script is a benchmark nothing can check.
 *
 * # Two baselines, and why the verdict uses the first
 *
 * The task's criterion is ">=1.8x vs scalar WASM on batch benchmark". "Scalar
 * WASM" is the committed `ballista-core.wasm`, built with no target features --
 * the binary a non-SIMD engine actually runs -- so that is the ratio the
 * verdict reads.
 *
 * The second baseline, `batch_run` inside the +simd128 build, is measured and
 * reported alongside it because it controls for something the first cannot:
 * both paths then live in one module, compiled by one rustc invocation and
 * tiered up by one instance of the engine, so a difference between them is the
 * SIMD path and not a difference of codegen or JIT state. If the two ratios
 * ever diverge meaningfully, the headline number is measuring the build rather
 * than the vectorisation, and the reading should not be trusted until that is
 * explained.
 */

/** The ratio the task's validation line requires. */
export const SIMD_SPEEDUP_CRITERION = 1.8;

/**
 * The benchmark workload.
 *
 * `replicates` is odd so the scalar tail is on the measured path as well as the
 * tested one -- a benchmark that only ever ran even counts would be timing code
 * the correctness suite covers and the shipped caller might not hit.
 *
 * The product `replicates * steps` is what sets the run length; the split
 * between them barely moves the ratio (measured across 20001x40, 2001x400 and
 * 101x8000, which agreed to within 0.06x), so this pair is chosen to keep a
 * single run around 30-80 ms: long enough to sit well above timer noise, short
 * enough that a 15-repetition median is quick.
 */
export const BENCHMARK_WORKLOAD = {
  replicates: 2001,
  steps: 400,
  h: 0.001,
  /** Discarded runs before timing starts, so both paths are tiered up. */
  warmupRounds: 10,
  /** Timed repetitions per path. The median is reported. */
  repetitions: 15,
} as const;

/** One replicate's parameter block. Heterogeneous in mass, area, Cd and wind. */
export function benchmarkParams(r: number): readonly number[] {
  const f = r / BENCHMARK_WORKLOAD.replicates;
  return [1 + f, 0.01 + 0.005 * f, 0.3 + 0.4 * f, 1.225, 9.81, 2 * f - 1, 0.5 * f];
}

/**
 * One replicate's initial state.
 *
 * `vy` spans +60 to -60 across the ensemble, so some replicates are climbing
 * for the whole window and others are descending from the first step. That
 * makes the running-max branch genuinely mixed rather than uniformly
 * predictable -- which turned out not to move the ratio (measured: 2.197x on an
 * ensemble whose height never changes at all, against 2.210x here), but a
 * benchmark should not depend on that having been checked.
 */
export function benchmarkState(r: number): readonly number[] {
  const f = r / BENCHMARK_WORKLOAD.replicates;
  return [0, 1 + 10 * f, 30 + 50 * f, 60 - 120 * f];
}

/** Median of a non-empty list, by the lower of the two middles for even counts. */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) {
    throw new RangeError("median: empty sample");
  }
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1]!;
}

/** Median milliseconds for each path, as the script measures them. */
export interface SimdTimings {
  /** `batch_run` on the committed scalar artifact. The criterion's baseline. */
  readonly scalarArtifactMs: number;
  /** `batch_run` inside the +simd128 build. The codegen/JIT control. */
  readonly scalarInSimdBuildMs: number;
  /** `batch_run_simd` inside the +simd128 build. */
  readonly simdMs: number;
}

export interface SimdVerdict {
  readonly speedupVsScalarArtifact: number;
  readonly speedupVsScalarInSimdBuild: number;
  readonly criterion: number;
  readonly pass: boolean;
}

/**
 * The verdict rule, in one place so a test can pin it.
 *
 * Deliberately reads only the first ratio. The second is reported for the
 * reader, not folded into the decision: making the verdict the minimum of the
 * two would quietly change the criterion the task was given, and making it the
 * maximum would let a favourable baseline carry a bad result.
 */
export function verdictFor(timings: SimdTimings): SimdVerdict {
  const speedupVsScalarArtifact = timings.scalarArtifactMs / timings.simdMs;
  return {
    speedupVsScalarArtifact,
    speedupVsScalarInSimdBuild: timings.scalarInSimdBuildMs / timings.simdMs,
    criterion: SIMD_SPEEDUP_CRITERION,
    pass: speedupVsScalarArtifact >= SIMD_SPEEDUP_CRITERION,
  };
}
