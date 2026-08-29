/**
 * Structural verification of the scrambled Sobol' sequence (P6.15).
 *
 * The task's stated criterion is a convergence *rate*, and rate measurements
 * are the one thing that cannot localise a fault: a wrong direction number, a
 * scramble that is not a bijection, and an off-by-one in the index loop all
 * present identically, as an error curve that is merely less good than it
 * should be. So the properties the rate rests on are checked here directly,
 * and each one is chosen because a plausible implementation error breaks it:
 *
 * - **Every dimension is a `(0, 1)`-sequence.** The first `2^p` points hit each
 *   of `2^p` equal bins exactly once, in every dimension. This fails if any
 *   `m_k` is even, if any `m_k` reaches `2^k`, or if the recurrence extending
 *   the tabulated values is wrong -- i.e. it grades the direction numbers
 *   themselves, not just the code around them.
 * - **Dimensions 1 and 2 form a `(0, 2)`-net.** Every elementary interval of
 *   area `2^-p` holds exactly one of the first `2^p` points. Joint, not
 *   marginal, so unlike the test above it grades dimension 2's *polynomial*.
 * - **The scramble is a nested bijection.** For each `k`, the map it induces on
 *   the leading `k` bits is a bijection on `[0, 2^k)`. That single property is
 *   both halves of what the scramble must do: bijective, so no two points
 *   collide; nested, so stratification at every scale survives it.
 *
 * The rate itself is measured in
 * `packages/analysis/src/sobol-convergence.test.ts`.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_SOBOL_DIMENSIONS,
  MAX_SOBOL_INDEX,
  generateSobolReplicate,
  nestedUniformScramble,
  sobolInteger,
  sobolReplicates,
  sobolUniform,
} from "./sobol.js";
import { PRESET_SCENARIOS } from "./scenario-presets.js";
import { scenarioSpecSchema, type ScenarioSpec } from "./scenario-spec.js";
import {
  uncertainScenarioSpecSchema,
  type UncertainScenarioSpec,
} from "./uncertain-scenario-spec.js";

/** Leading `bits` bits of a 32-bit coordinate, as an integer in `[0, 2^bits)`. */
function leadingBits(value: number, bits: number): number {
  return bits === 0 ? 0 : Math.floor(value / 2 ** (32 - bits));
}

describe("sobolInteger", () => {
  it("is the origin at index 0 in every dimension", () => {
    // Worth pinning rather than assuming: it is the reason the raw sequence is
    // never exposed to a caller unscrambled.
    for (let d = 1; d <= MAX_SOBOL_DIMENSIONS; d += 1) {
      expect(sobolInteger(0, d)).toBe(0);
    }
  });

  it("gives every dimension a perfect one-dimensional stratification", () => {
    for (let d = 1; d <= MAX_SOBOL_DIMENSIONS; d += 1) {
      for (let p = 1; p <= 10; p += 1) {
        const n = 2 ** p;
        const bins = new Set<number>();
        for (let i = 0; i < n; i += 1) bins.add(leadingBits(sobolInteger(i, d), p));
        expect(bins.size, `dimension ${d}, first 2^${p} points`).toBe(n);
      }
    }
  });

  it("holds that stratification for a block that does not start at zero", () => {
    // A (0,1)-sequence stratifies every aligned block of 2^p consecutive
    // points, not merely the first. This is the property that lets a study be
    // extended in N without discarding what it already drew.
    for (const p of [4, 6, 8]) {
      const n = 2 ** p;
      for (const start of [n, 3 * n, 17 * n]) {
        for (let d = 1; d <= 4; d += 1) {
          const bins = new Set<number>();
          for (let i = start; i < start + n; i += 1) bins.add(leadingBits(sobolInteger(i, d), p));
          expect(bins.size, `dimension ${d}, block at ${start}`).toBe(n);
        }
      }
    }
  });

  it("makes dimensions 1 and 2 a (0,2)-net", () => {
    for (let p = 1; p <= 10; p += 1) {
      const n = 2 ** p;
      for (let q = 0; q <= p; q += 1) {
        const cells = new Set<string>();
        for (let i = 0; i < n; i += 1) {
          const a = leadingBits(sobolInteger(i, 1), q);
          const b = leadingBits(sobolInteger(i, 2), p - q);
          cells.add(`${a},${b}`);
        }
        expect(cells.size, `elementary intervals 2^-${q} by 2^-${p - q}`).toBe(n);
      }
    }
  });

  it("gives distinct dimensions distinct coordinates", () => {
    // Guards the table indexing: an off-by-one that handed two dimensions the
    // same direction numbers would put every point on a diagonal, which is
    // perfectly stratified in each margin and useless as a design.
    for (let d = 2; d <= MAX_SOBOL_DIMENSIONS; d += 1) {
      const differs = Array.from({ length: 64 }, (_, i) => i).some(
        (i) => sobolInteger(i, d) !== sobolInteger(i, d - 1),
      );
      expect(differs, `dimensions ${d - 1} and ${d}`).toBe(true);
    }
  });

  it("is a pure function of the index, not of the enumeration order", () => {
    const forwards = Array.from({ length: 300 }, (_, i) => sobolInteger(i, 3));
    for (const i of [0, 1, 7, 63, 64, 255, 299]) {
      expect(sobolInteger(i, 3)).toBe(forwards[i]);
    }
    // And reached out of order, which is what a worker holding one range does.
    expect(sobolInteger(299, 3)).toBe(forwards[299]);
    expect(sobolInteger(7, 3)).toBe(forwards[7]);
  });

  it("uses index bits above 2^31 without wrapping", () => {
    // The set-bit loop is arithmetic rather than bitwise precisely so that
    // indices past 2^31 keep working; `&` would see a negative int32 there.
    expect(sobolInteger(2 ** 31, 2)).not.toBe(sobolInteger(0, 2));
    expect(sobolInteger(MAX_SOBOL_INDEX, 2)).not.toBe(sobolInteger(0, 2));
    expect(Number.isInteger(sobolInteger(MAX_SOBOL_INDEX, 5))).toBe(true);
  });

  it("rejects out-of-range dimensions and indices", () => {
    expect(() => sobolInteger(0, 0)).toThrow(/dimension must be an integer/);
    expect(() => sobolInteger(0, MAX_SOBOL_DIMENSIONS + 1)).toThrow(/dimension must be an integer/);
    expect(() => sobolInteger(-1, 1)).toThrow(/index must be an integer/);
    expect(() => sobolInteger(1.5, 1)).toThrow(/index must be an integer/);
    expect(() => sobolInteger(MAX_SOBOL_INDEX + 1, 1)).toThrow(/index must be an integer/);
  });
});

describe("nestedUniformScramble", () => {
  it("is a bijection on the leading k bits for every k", () => {
    // The whole contract, in one assertion. Bijective on the leading k bits
    // for every k means: bijective overall (k = 32 in the limit), and nested,
    // since the leading k bits of the output depend on nothing but the leading
    // k bits of the input. Nested is what preserves a (t, m, s)-net.
    for (const seed of [0, 1, 0xabcdef01, 0xffffffff]) {
      for (let k = 1; k <= 12; k += 1) {
        const seen = new Set<number>();
        for (let top = 0; top < 2 ** k; top += 1) {
          seen.add(leadingBits(nestedUniformScramble(top * 2 ** (32 - k), seed), k));
        }
        expect(seen.size, `seed ${seed}, k ${k}`).toBe(2 ** k);
      }
    }
  });

  it("leaves the leading bits alone when the trailing bits change", () => {
    // The direct statement of nesting, from the other side.
    const seed = 0x12345678;
    for (let k = 1; k <= 12; k += 1) {
      const base = 0x5a5a5a5a;
      const head = Math.floor(base / 2 ** (32 - k)) * 2 ** (32 - k);
      const a = leadingBits(nestedUniformScramble(head, seed), k);
      const b = leadingBits(nestedUniformScramble(head + (2 ** (32 - k) - 1), seed), k);
      expect(b, `k ${k}`).toBe(a);
    }
  });

  it("gives different seeds different permutations", () => {
    const differs = Array.from({ length: 256 }, (_, i) => i * 2 ** 24).some(
      (x) => nestedUniformScramble(x, 1) !== nestedUniformScramble(x, 2),
    );
    expect(differs).toBe(true);
  });

  it("preserves the (0,2)-net of dimensions 1 and 2", () => {
    // The consequence the module exists to deliver: scrambling randomises the
    // sequence without spending the structure it was built for.
    const seedA = 0x0badc0de;
    const seedB = 0xfeedface;
    for (let p = 1; p <= 9; p += 1) {
      const n = 2 ** p;
      for (let q = 0; q <= p; q += 1) {
        const cells = new Set<string>();
        for (let i = 0; i < n; i += 1) {
          const a = leadingBits(nestedUniformScramble(sobolInteger(i, 1), seedA), q);
          const b = leadingBits(nestedUniformScramble(sobolInteger(i, 2), seedB), p - q);
          cells.add(`${a},${b}`);
        }
        expect(cells.size, `scrambled, 2^-${q} by 2^-${p - q}`).toBe(n);
      }
    }
  });
});

const BASE: ScenarioSpec = scenarioSpecSchema.parse(PRESET_SCENARIOS[0]);

function study(seed: number, replicateCount: number): UncertainScenarioSpec {
  return uncertainScenarioSpecSchema.parse({
    schemaVersion: 1,
    base: BASE,
    overlays: [
      {
        path: "initialConditions.vx0",
        distribution: { kind: "normal", mean: 40, stdDev: 6, min: 10, max: 70 },
      },
      {
        path: "initialConditions.vy0",
        distribution: { kind: "uniform", min: 30, max: 50 },
      },
    ],
    seed,
    replicates: replicateCount,
  });
}

describe("sobolUniform", () => {
  it("stays strictly inside the open interval", () => {
    for (let i = 0; i < 2048; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        const u = sobolUniform(7, i, j);
        expect(u).toBeGreaterThan(0);
        expect(u).toBeLessThan(1);
      }
    }
  });

  it("stratifies each dimension after scrambling", () => {
    for (const p of [4, 6, 8, 10]) {
      const n = 2 ** p;
      for (let j = 0; j < 3; j += 1) {
        const bins = new Set<number>();
        for (let i = 0; i < n; i += 1) bins.add(Math.floor(sobolUniform(99, i, j) * n));
        expect(bins.size, `overlay ${j}, 2^${p} points`).toBe(n);
      }
    }
  });

  it("does not depend on the replicate count", () => {
    // The property Latin hypercube sampling cannot have, asserted rather than
    // described: the uniform for replicate i is the same whatever N is,
    // because N is not one of its arguments.
    const small = Array.from({ length: 32 }, (_, i) => sobolUniform(4, i, 0));
    const large = Array.from({ length: 32 }, (_, i) => sobolUniform(4, i, 0));
    expect(large).toEqual(small);
  });

  it("gives different overlays uncorrelated coordinates", () => {
    const n = 4096;
    let sum0 = 0;
    let sum1 = 0;
    let sum01 = 0;
    for (let i = 0; i < n; i += 1) {
      const a = sobolUniform(11, i, 0);
      const b = sobolUniform(11, i, 1);
      sum0 += a;
      sum1 += b;
      sum01 += a * b;
    }
    // Cov(U0, U1) for independent uniforms is 0; a shared scramble key or a
    // shared dimension would drive this toward Var(U) = 1/12 ~ 0.0833.
    const covariance = sum01 / n - (sum0 / n) * (sum1 / n);
    expect(Math.abs(covariance)).toBeLessThan(0.005);
  });

  it("gives different study seeds different points", () => {
    const differs = Array.from({ length: 64 }, (_, i) => i).some(
      (i) => sobolUniform(1, i, 0) !== sobolUniform(2, i, 0),
    );
    expect(differs).toBe(true);
  });
});

describe("generateSobolReplicate", () => {
  it("is a pure function of the study and the index", () => {
    const s = study(21, 64);
    for (const i of [0, 1, 13, 63]) {
      expect(generateSobolReplicate(s, i)).toEqual(generateSobolReplicate(s, i));
    }
  });

  it("is independent of how a batch is partitioned", () => {
    // P6.03's guarantee, restated for this sampler: any partition of the index
    // range reproduces the same ensemble.
    const s = study(33, 40);
    const whole = Array.from(sobolReplicates(s));
    const pieces = [
      ...Array.from({ length: 7 }, (_, i) => generateSobolReplicate(s, i)),
      ...Array.from({ length: 33 }, (_, i) => generateSobolReplicate(s, i + 7)),
    ];
    expect(pieces).toEqual(whole);
  });

  it("keeps the first N replicates when the study is extended", () => {
    // The extensibility claim in the module doc, measured. Under LHS the
    // corresponding assertion is false by construction.
    const short = Array.from(sobolReplicates(study(5, 32)));
    const long = Array.from(sobolReplicates(study(5, 128)));
    expect(long.slice(0, 32)).toEqual(short);
    expect(long).toHaveLength(128);
  });

  it("draws values inside each overlay's support", () => {
    for (const replicate of sobolReplicates(study(8, 256))) {
      const [vx0, vy0] = replicate.values;
      expect(vx0).toBeGreaterThanOrEqual(10);
      expect(vx0).toBeLessThanOrEqual(70);
      expect(vy0).toBeGreaterThanOrEqual(30);
      expect(vy0).toBeLessThanOrEqual(50);
    }
  });

  it("reproduces a uniform overlay's mean far more tightly than its own spread", () => {
    // A weak but honest end-to-end check that the quantile map is being fed a
    // well-spread uniform: the mean of a uniform(30, 50) over 1024 QMC points
    // should sit far inside plain MC's standard error of sigma/sqrt(N) ~ 0.18.
    const values = Array.from(sobolReplicates(study(6, 1024))).map((r) => r.values[1] ?? 0);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(Math.abs(mean - 40)).toBeLessThan(0.02);
  });

  it("rejects a study with more overlays than the table has dimensions", () => {
    const overlays = Array.from({ length: MAX_SOBOL_DIMENSIONS + 1 }, () => ({
      path: "initialConditions.vx0",
      distribution: { kind: "uniform" as const, min: 10, max: 70 },
    }));
    const oversized = {
      ...study(1, 4),
      overlays,
    } as UncertainScenarioSpec;
    expect(() => generateSobolReplicate(oversized, 0)).toThrow(/dimension limit/);
  });
});
