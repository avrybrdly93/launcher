import { describe, expect, it } from "vitest";
import {
  ENSEMBLE_DIM,
  ENSEMBLE_OBS,
  ENSEMBLE_OBS_COUNT,
  ENSEMBLE_PARAM,
  ENSEMBLE_PARAM_COUNT,
  ensembleEnvironmentConstants,
  ensembleReplicateParams,
  lowerEnsembleRange,
  runTsEnsembleRange,
  validateEnsembleJob,
  type EnsembleJobSpec,
  type EnsembleReplicate,
} from "./ensemble-job.js";

/**
 * The spec side of P7.10, tested without a kernel: lowering, validation, and
 * the TypeScript backend's own definitions (running max, `t_final`, the
 * zero-step case). The bit-identity against WASM lives in
 * `heterogeneous-executor.test.ts`; what is checked here is the reference
 * side's own contract, because "both backends agree" is worth nothing if the
 * thing they agree on is wrong.
 */

function replicate(r: number): EnsembleReplicate {
  return {
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: 0.47,
    x0: 0,
    y0: 2,
    vx0: 30,
    vy0: 12 - r,
  };
}

function job(overrides: Partial<EnsembleJobSpec> = {}): EnsembleJobSpec {
  return {
    t0: 0.25,
    h: 0.0071,
    steps: 96,
    gravity: 9.79,
    windX: 3.5,
    windY: -1.25,
    replicates: [replicate(0), replicate(1), replicate(2)],
    ...overrides,
  };
}

describe("the ensemble job spec", () => {
  it("rejects a non-finite or non-positive step size", () => {
    expect(() => validateEnsembleJob(job({ h: Number.NaN }))).toThrow(/h must be finite/);
    expect(() => validateEnsembleJob(job({ h: 0 }))).toThrow(/h must be finite/);
    expect(() => validateEnsembleJob(job({ h: -1 / 128 }))).toThrow(/h must be finite/);
  });

  it("rejects a fractional or negative step count", () => {
    expect(() => validateEnsembleJob(job({ steps: 1.5 }))).toThrow(/non-negative integer/);
    expect(() => validateEnsembleJob(job({ steps: -1 }))).toThrow(/non-negative integer/);
  });

  it("rejects a non-finite environment", () => {
    expect(() => validateEnsembleJob(job({ t0: Number.POSITIVE_INFINITY }))).toThrow(/t0/);
    expect(() => validateEnsembleJob(job({ gravity: Number.NaN }))).toThrow(/gravity/);
    expect(() => validateEnsembleJob(job({ windY: Number.NaN }))).toThrow(/wind/);
  });

  it("names the offending replicate rather than just failing", () => {
    const replicates = [replicate(0), { ...replicate(1), mass: 0 }, replicate(2)];
    expect(() => validateEnsembleJob(job({ replicates }))).toThrow(/replicate 1 mass/);
  });

  it("rejects a NaN initial state, which would otherwise make an equivalence check vacuous", () => {
    // Two NaN rows compare equal under Object.is, so a bit-identity suite fed
    // a degenerate spec reports a green that says nothing. This is the check
    // that stops that, and it is the reason the validation exists at all.
    const replicates = [{ ...replicate(0), vy0: Number.NaN }];
    expect(() => validateEnsembleJob(job({ replicates }))).toThrow(/replicate 0 initial state/);
  });

  it("accepts an empty ensemble and a zero-step window", () => {
    expect(() => validateEnsembleJob(job({ replicates: [] }))).not.toThrow();
    expect(() => validateEnsembleJob(job({ steps: 0 }))).not.toThrow();
  });
});

describe("lowering a spec to the kernel's representation", () => {
  it("derives area from the radius rather than taking it from the caller", () => {
    const params = new Float64Array(ENSEMBLE_PARAM_COUNT);
    const states = new Float64Array(ENSEMBLE_DIM);
    lowerEnsembleRange(job(), 0, 1, params, states);
    const expected = ensembleReplicateParams(replicate(0));
    expect(params[ENSEMBLE_PARAM.area]).toBe(expected.area);
    expect(params[ENSEMBLE_PARAM.area]).toBe(Math.PI * 0.0366 * 0.0366);
  });

  it("carries the job's own gravity and wind into every row, not the ISA defaults", () => {
    const spec = job({ gravity: 3.71, windX: -7.5, windY: 0.25 });
    const params = new Float64Array(2 * ENSEMBLE_PARAM_COUNT);
    const states = new Float64Array(2 * ENSEMBLE_DIM);
    lowerEnsembleRange(spec, 0, 2, params, states);
    for (const row of [0, 1]) {
      const p = row * ENSEMBLE_PARAM_COUNT;
      expect(params[p + ENSEMBLE_PARAM.g]).toBe(3.71);
      expect(params[p + ENSEMBLE_PARAM.wx]).toBe(-7.5);
      expect(params[p + ENSEMBLE_PARAM.wy]).toBe(0.25);
    }
  });

  it("samples rho from the environment instead of accepting one", () => {
    // ConstantAtmosphere ignores position, so one sample is what every stage
    // of every step reads -- the property that lets the kernel take rho as a
    // number. If the atmosphere ever became altitude-dependent this would stop
    // being true before anything else did.
    const { rho, g } = ensembleEnvironmentConstants(job({ gravity: 3.71 }));
    expect(rho).toBeGreaterThan(1);
    expect(rho).toBeLessThan(2);
    expect(g).toBe(3.71);
  });

  it("writes a sub-range at row 0 of the output, not at its own start index", () => {
    // The arena a chunk is written into starts at its own row 0; lowering a
    // chunk at its absolute index would leave the first rows unwritten and
    // overrun the reserved capacity.
    const spec = job();
    const params = new Float64Array(1 * ENSEMBLE_PARAM_COUNT);
    const states = new Float64Array(1 * ENSEMBLE_DIM);
    lowerEnsembleRange(spec, 2, 3, params, states);
    expect(states[1]).toBe(spec.replicates[2]!.y0);
    expect(states[3]).toBe(spec.replicates[2]!.vy0);
  });

  it("reports an empty ensemble's environment without a replicate to sample with", () => {
    expect(() => ensembleEnvironmentConstants(job({ replicates: [] }))).not.toThrow();
  });
});

describe("the TypeScript backend's own definitions", () => {
  it("reports t_final as t0 + steps*h, formed by multiplication", () => {
    const spec = job();
    const rows = runTsEnsembleRange(spec, 0, 1);
    expect(rows[ENSEMBLE_OBS.tFinal]).toBe(spec.t0 + spec.steps * spec.h);
    // And that is not the same double as accumulating h, at this step size --
    // which is why the kernel's `run_one_replicate` multiplies too, and why
    // `heterogeneous-executor.test.ts` has a control for it.
    let accumulated = spec.t0;
    for (let i = 0; i < spec.steps; i++) accumulated += spec.h;
    expect(accumulated).not.toBe(spec.t0 + spec.steps * spec.h);
  });

  it("counts the initial state as a height sample, so a falling replicate reports its launch height", () => {
    const falling: EnsembleReplicate = { ...replicate(0), y0: 40, vy0: -5 };
    const rows = runTsEnsembleRange(job({ replicates: [falling] }), 0, 1);
    expect(rows[ENSEMBLE_OBS.maxSampledHeight]).toBe(40);
    expect(rows[ENSEMBLE_OBS.y]).toBeLessThan(40);
  });

  it("reports a peak above both endpoints for a replicate that turns over inside the window", () => {
    const rising: EnsembleReplicate = { ...replicate(0), y0: 1, vy0: 4 };
    const rows = runTsEnsembleRange(job({ replicates: [rising] }), 0, 1);
    expect(rows[ENSEMBLE_OBS.maxSampledHeight]!).toBeGreaterThan(1);
    expect(rows[ENSEMBLE_OBS.maxSampledHeight]!).toBeGreaterThan(rows[ENSEMBLE_OBS.y]!);
  });

  it("reports the initial state unchanged for a zero-step window", () => {
    const spec = job({ steps: 0 });
    const rows = runTsEnsembleRange(spec, 0, 1);
    const rep = spec.replicates[0]!;
    expect(Array.from(rows)).toEqual([rep.x0, rep.y0, rep.vx0, rep.vy0, spec.t0, rep.y0]);
  });

  it("gives each replicate its own projectile rather than the first one's", () => {
    // One EvalContext per replicate is what makes this true; sharing one would
    // run the whole ensemble with replicates[0]'s mass and Cd, and against a
    // fixture whose replicates differ only in initial state it would go
    // unnoticed. So this fixture differs in mass and Cd and nothing else.
    const heavy: EnsembleReplicate = { ...replicate(0), mass: 5 };
    const light: EnsembleReplicate = { ...replicate(0), mass: 0.05 };
    const together = runTsEnsembleRange(job({ replicates: [heavy, light] }), 0, 2);
    const alone = runTsEnsembleRange(job({ replicates: [light] }), 0, 1);
    for (let slot = 0; slot < ENSEMBLE_OBS_COUNT; slot++) {
      expect(together[ENSEMBLE_OBS_COUNT + slot]).toBe(alone[slot]);
    }
    expect(together[ENSEMBLE_OBS.x]).not.toBe(together[ENSEMBLE_OBS_COUNT + ENSEMBLE_OBS.x]);
  });

  it("returns an empty result for an empty or inverted range without throwing", () => {
    expect(runTsEnsembleRange(job(), 1, 1).length).toBe(0);
    expect(runTsEnsembleRange(job(), 2, 1).length).toBe(0);
  });
});
