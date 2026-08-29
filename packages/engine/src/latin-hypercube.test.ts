import { describe, expect, it } from "vitest";
import {
  generateLatinHypercubeReplicate,
  latinHypercubeReplicates,
  latinHypercubeStratum,
  latinHypercubeUniform,
  MAX_LHS_REPLICATES,
} from "./latin-hypercube.js";
import { PRESET_SCENARIOS } from "./scenario-presets.js";
import { scenarioSpecSchema, type ScenarioSpec } from "./scenario-spec.js";
import {
  uncertainScenarioSpecSchema,
  type UncertainScenarioSpec,
} from "./uncertain-scenario-spec.js";

/**
 * A real preset, for the same reason replicate-generator.test.ts uses one: the
 * produced spec is re-parsed by the base schema, so a hand-rolled base could
 * drift from the shape the engine actually runs and this file would not
 * notice.
 */
const BASE: ScenarioSpec = scenarioSpecSchema.parse(PRESET_SCENARIOS[0]);

/** A two-dimensional study: one truncated normal, one uniform. */
function study(replicates: number, seed = 4242): UncertainScenarioSpec {
  return uncertainScenarioSpecSchema.parse({
    schemaVersion: 1,
    base: BASE,
    overlays: [
      {
        path: "projectile.mass",
        distribution: {
          kind: "normal",
          mean: BASE.projectile.mass,
          stdDev: BASE.projectile.mass * 0.05,
          min: BASE.projectile.mass * 0.5,
          max: BASE.projectile.mass * 1.5,
        },
      },
      { path: "initialConditions.vx0", distribution: { kind: "uniform", min: 30, max: 60 } },
    ],
    replicates,
    seed,
  });
}

describe("latinHypercubeStratum", () => {
  it.each([1, 2, 3, 7, 8, 16, 17, 64, 100, 257, 1000])(
    "is a bijection onto [0, N) for N = %i",
    (n) => {
      // The Latin property itself: every stratum taken exactly once, per
      // dimension. This is the half of the criterion that says "stratification
      // verified per-dim", checked directly rather than inferred from the
      // construction.
      for (const dimension of [0, 1, 2]) {
        const seen = new Set<number>();
        for (let i = 0; i < n; i += 1) {
          const stratum = latinHypercubeStratum(4242, n, i, dimension);
          expect(Number.isInteger(stratum)).toBe(true);
          expect(stratum).toBeGreaterThanOrEqual(0);
          expect(stratum).toBeLessThan(n);
          seen.add(stratum);
        }
        expect(seen.size).toBe(n);
      }
    },
  );

  it("permutes each dimension differently", () => {
    // Sharing one permutation across dimensions would place every replicate on
    // the hypercube's diagonal: perfectly stratified in each margin, and
    // useless as a design. Guarding the property that rules that out.
    const n = 200;
    const first = Array.from({ length: n }, (_, i) => latinHypercubeStratum(4242, n, i, 0));
    const second = Array.from({ length: n }, (_, i) => latinHypercubeStratum(4242, n, i, 1));
    const agreements = first.filter((value, i) => value === second[i]).length;
    // Two independent permutations agree in ~1 place on average (a classic
    // derangement result); 20 would be a design collapsing onto its diagonal.
    expect(agreements).toBeLessThan(20);
  });

  it("gives different permutations for different seeds and different N", () => {
    const n = 128;
    const a = Array.from({ length: n }, (_, i) => latinHypercubeStratum(1, n, i, 0));
    const b = Array.from({ length: n }, (_, i) => latinHypercubeStratum(2, n, i, 0));
    expect(a).not.toEqual(b);

    // N is part of the key because a permutation of 0..N-1 is a different
    // object for a different N. Compared over the overlapping prefix.
    const wider = Array.from({ length: n }, (_, i) => latinHypercubeStratum(1, n * 2, i, 0));
    expect(wider.slice(0, n)).not.toEqual(a);
  });

  it("is a pure function of (seed, N, index, dimension)", () => {
    for (const i of [0, 1, 17, 63]) {
      expect(latinHypercubeStratum(9, 64, i, 0)).toBe(latinHypercubeStratum(9, 64, i, 0));
    }
  });

  it("rejects an out-of-range replicate index or count", () => {
    expect(() => latinHypercubeStratum(1, 10, 10, 0)).toThrow(/integer in \[0, 10\)/);
    expect(() => latinHypercubeStratum(1, 10, -1, 0)).toThrow(/integer in \[0, 10\)/);
    expect(() => latinHypercubeStratum(1, 10, 1.5, 0)).toThrow(/integer in \[0, 10\)/);
    expect(() => latinHypercubeStratum(1, 0, 0, 0)).toThrow(/replicate count/);
    expect(() => latinHypercubeStratum(1, MAX_LHS_REPLICATES + 1, 0, 0)).toThrow(/replicate count/);
  });
});

describe("latinHypercubeUniform", () => {
  it("places exactly one sample in each 1/N band, per dimension", () => {
    // The stratification property restated on the uniforms themselves, which
    // is what the quantile actually consumes.
    const n = 500;
    for (const dimension of [0, 1]) {
      const occupied = new Set<number>();
      for (let i = 0; i < n; i += 1) {
        const u = latinHypercubeUniform(4242, n, i, dimension);
        expect(u).toBeGreaterThan(0);
        expect(u).toBeLessThan(1);
        occupied.add(Math.floor(u * n));
      }
      expect(occupied.size).toBe(n);
    }
  });

  it("keeps each sample inside its own stratum", () => {
    const n = 64;
    for (let i = 0; i < n; i += 1) {
      const stratum = latinHypercubeStratum(7, n, i, 0);
      const u = latinHypercubeUniform(7, n, i, 0);
      expect(u).toBeGreaterThanOrEqual(stratum / n);
      expect(u).toBeLessThan((stratum + 1) / n);
    }
  });

  it("jitters within the stratum rather than sitting at its midpoint", () => {
    // Midpoint placement would be a quadrature rule wearing a Monte Carlo
    // costume: lower variance, biased, and with a sample spread that no longer
    // estimates anything. The jitter is what keeps the estimator honest.
    const n = 256;
    const offsets = Array.from({ length: n }, (_, i) => {
      const stratum = latinHypercubeStratum(7, n, i, 0);
      return latinHypercubeUniform(7, n, i, 0) * n - stratum;
    });
    const distinct = new Set(offsets.map((o) => o.toFixed(6)));
    expect(distinct.size).toBeGreaterThan(n / 2);
    const mean = offsets.reduce((a, b) => a + b, 0) / n;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
  });
});

describe("generateLatinHypercubeReplicate", () => {
  it("produces the same replicate however the study is partitioned", () => {
    // P6.03's criterion, carried over. A worker pool of any size handed any
    // contiguous ranges must reproduce the same ensemble.
    const s = study(50);
    const whole = [...latinHypercubeReplicates(s)];
    const piecemeal = [
      ...Array.from({ length: 7 }, (_, i) => generateLatinHypercubeReplicate(s, i)),
      ...Array.from({ length: 43 }, (_, i) => generateLatinHypercubeReplicate(s, i + 7)),
    ];
    expect(piecemeal).toEqual(whole);
    expect(whole).toHaveLength(50);
  });

  it("writes drawn values back into a spec the base schema accepts", () => {
    const s = study(32);
    for (const replicate of latinHypercubeReplicates(s)) {
      expect(replicate.values).toHaveLength(2);
      expect(replicate.values[0]).toBeGreaterThanOrEqual(BASE.projectile.mass * 0.5);
      expect(replicate.values[0]).toBeLessThanOrEqual(BASE.projectile.mass * 1.5);
      expect(replicate.values[1]).toBeGreaterThanOrEqual(30);
      expect(replicate.values[1]).toBeLessThanOrEqual(60);
      expect(replicate.spec.projectile.mass).toBe(replicate.values[0]);
      expect(replicate.spec.initialConditions.vx0).toBe(replicate.values[1]);
    }
  });

  it("stratifies the drawn values, not merely the uniforms", () => {
    // The end-to-end statement of the criterion: after the quantile map, each
    // dimension still has exactly one sample per 1/N band of probability mass.
    // For the uniform overlay the bands are equal-width in value, so this is
    // directly checkable.
    const n = 300;
    const s = study(n);
    const bands = new Set<number>();
    for (const replicate of latinHypercubeReplicates(s)) {
      const speed = replicate.values[1]!;
      bands.add(Math.floor(((speed - 30) / 30) * n));
    }
    expect(bands.size).toBe(n);
  });

  it("rejects an index outside the study", () => {
    const s = study(10);
    expect(() => generateLatinHypercubeReplicate(s, 10)).toThrow(/integer in \[0, 10\)/);
  });
});
