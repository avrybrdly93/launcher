import { describe, expect, it } from "vitest";
import { distributionSpecSchema, type DistributionSpec } from "./distribution.js";
import { PCG32 } from "./random.js";
import {
  MAX_REPLICATE_INDEX,
  OVERLAY_STRIDE,
  generateReplicate,
  generateReplicateRange,
  replicateRng,
  replicateSeed,
  replicateStreamId,
  replicates,
  writeSpecNumberAtPath,
} from "./replicate-generator.js";
import { PRESET_SCENARIOS } from "./scenario-presets.js";
import { scenarioSpecSchema, type ScenarioSpec } from "./scenario-spec.js";
import {
  uncertainScenarioSpecSchema,
  type UncertainScenarioSpec,
} from "./uncertain-scenario-spec.js";

/**
 * A real preset, for the same reason uncertain-scenario-spec.test.ts uses one:
 * the produced spec is re-parsed by the base schema, so a hand-rolled base
 * could drift from the shape the deterministic engine actually runs and this
 * file would not notice.
 */
const BASE: ScenarioSpec = scenarioSpecSchema.parse(PRESET_SCENARIOS[0]);

const MASS_NORMAL: DistributionSpec = distributionSpecSchema.parse({
  kind: "normal",
  mean: BASE.projectile.mass,
  stdDev: BASE.projectile.mass * 0.02,
});

const SPEED_UNIFORM: DistributionSpec = distributionSpecSchema.parse({
  kind: "uniform",
  min: 20,
  max: 30,
});

function study(overrides: Record<string, unknown> = {}): UncertainScenarioSpec {
  return uncertainScenarioSpecSchema.parse({
    schemaVersion: 1,
    base: BASE,
    overlays: [
      { path: "projectile.mass", distribution: MASS_NORMAL },
      { path: "initialConditions.vx0", distribution: SPEED_UNIFORM },
    ],
    replicates: 64,
    seed: 7,
    ...overrides,
  });
}

/** The path the second overlay writes to, resolved once so the tests agree. */
const SPEED_PATH = "initialConditions.vx0";

describe("writeSpecNumberAtPath", () => {
  it("returns a copy with the leaf replaced and leaves the original untouched", () => {
    const before = BASE.projectile.mass;
    const next = writeSpecNumberAtPath(BASE, "projectile.mass", 1.25);
    expect(next.projectile.mass).toBe(1.25);
    expect(BASE.projectile.mass).toBe(before);
    expect(next).not.toBe(BASE);
    expect(next.projectile).not.toBe(BASE.projectile);
  });

  it("copies only the objects along the path", () => {
    const next = writeSpecNumberAtPath(BASE, "projectile.mass", 1.25);
    // Structural sharing is the memory budget P6.04 depends on, so it is
    // asserted rather than left as an implementation detail: a future edit to
    // a deep clone would pass every other case in this file.
    expect(next.environment).toBe(BASE.environment);
    expect(next.solver).toBe(BASE.solver);
  });

  it("round-trips through the base schema unchanged apart from the leaf", () => {
    const next = scenarioSpecSchema.parse(writeSpecNumberAtPath(BASE, "projectile.mass", 1.25));
    expect({ ...next, projectile: { ...next.projectile, mass: BASE.projectile.mass } }).toEqual(
      BASE,
    );
  });

  it("refuses a path that does not resolve to a finite number", () => {
    expect(() => writeSpecNumberAtPath(BASE, "projectile.notAField", 1)).toThrow(
      /does not resolve/,
    );
    expect(() => writeSpecNumberAtPath(BASE, "projectile", 1)).toThrow(/does not resolve/);
  });

  it("refuses prototype keys", () => {
    expect(() => writeSpecNumberAtPath(BASE, "__proto__.polluted", 1)).toThrow(/does not resolve/);
    expect(() => writeSpecNumberAtPath(BASE, "constructor.polluted", 1)).toThrow(
      /does not resolve/,
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("replicateStreamId", () => {
  it("is injective over the documented domain", () => {
    const seen = new Set<bigint>();
    for (let i = 0; i < 40; i += 1) {
      for (let j = 0; j < 40; j += 1) {
        const id = replicateStreamId(i, j);
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    expect(seen.size).toBe(1600);
  });

  it("keeps every id below 2^63, which is what PCG32 can actually distinguish", () => {
    // PCG32 forms its increment as (streamId << 1) | 1 masked to 64 bits, so
    // the 64th bit of a stream id is discarded and s, s + 2^63 are the SAME
    // stream. The packing is bounded so that fold can never happen.
    const largest = replicateStreamId(MAX_REPLICATE_INDEX, OVERLAY_STRIDE - 1);
    expect(largest).toBeLessThan(1n << 63n);
  });

  it("separates consecutive replicates by the overlay stride", () => {
    expect(replicateStreamId(1, 0) - replicateStreamId(0, 0)).toBe(BigInt(OVERLAY_STRIDE));
    expect(replicateStreamId(0, 3)).toBe(3n);
  });
});

describe("replicateSeed", () => {
  it("gives every (replicate, overlay) pair a distinct seed", () => {
    // This is the case that grades the hash. The streams alone are already
    // distinct, so dropping the hash and seeding every pair with the study
    // seed passes every value-level assertion in this file -- a fault that was
    // injected and observed doing exactly that before this case existed.
    const seen = new Set<bigint>();
    for (let i = 0; i < 32; i += 1) {
      for (let j = 0; j < 32; j += 1) {
        seen.add(replicateSeed(7, i, j));
      }
    }
    expect(seen.size).toBe(32 * 32);
  });

  it("separates pairs one stream apart by about half the bits", () => {
    // The property the hash exists for. Streams in an arithmetic progression
    // are the case PCG is most cautious about, so neighbouring pairs must not
    // begin from arithmetically related states. A good 64-bit mixer averages
    // 32 differing bits; anything above 16 is far outside what an unmixed
    // increment could produce.
    const popcount = (value: bigint): number => {
      let bits = 0;
      let rest = value;
      while (rest > 0n) {
        bits += Number(rest & 1n);
        rest >>= 1n;
      }
      return bits;
    };
    let worst = 64;
    for (let i = 0; i < 24; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        worst = Math.min(worst, popcount(replicateSeed(7, i, j) ^ replicateSeed(7, i, j + 1)));
        worst = Math.min(worst, popcount(replicateSeed(7, i, j) ^ replicateSeed(7, i + 1, j)));
      }
    }
    expect(worst).toBeGreaterThan(16);
  });

  it("moves with the study seed", () => {
    expect(replicateSeed(8, 3, 1)).not.toBe(replicateSeed(7, 3, 1));
  });

  it("stays inside 64 bits", () => {
    for (let i = 0; i < 16; i += 1) {
      expect(replicateSeed(7, i, 0)).toBeLessThan(1n << 64n);
      expect(replicateSeed(7, i, 0)).toBeGreaterThanOrEqual(0n);
    }
  });
});

describe("replicateRng", () => {
  it("depends on the study seed, the replicate index and the overlay index", () => {
    const draw = (seed: number, i: number, j: number): number => replicateRng(seed, i, j).nextF64();
    const reference = draw(7, 3, 0);
    expect(draw(7, 3, 0)).toBe(reference);
    expect(draw(8, 3, 0)).not.toBe(reference);
    expect(draw(7, 4, 0)).not.toBe(reference);
    expect(draw(7, 3, 1)).not.toBe(reference);
  });

  it("does not start adjacent pairs from adjacent states", () => {
    // The seed is hashed precisely so this holds; an unhashed seed would give
    // neighbouring pairs sequences that begin one LCG increment apart.
    const first = replicateRng(7, 0, 0);
    const second = replicateRng(7, 0, 1);
    const a = Array.from({ length: 8 }, () => first.nextU32());
    const b = Array.from({ length: 8 }, () => second.nextU32());
    expect(a).not.toEqual(b);
    // and no suffix of one is a prefix of the other
    for (let shift = 1; shift < 8; shift += 1) {
      expect(a.slice(shift)).not.toEqual(b.slice(0, 8 - shift));
    }
  });

  it("returns a PCG32, so downstream draws use the shared distribution sampler", () => {
    expect(replicateRng(7, 0, 0)).toBeInstanceOf(PCG32);
  });
});

describe("generateReplicate", () => {
  it("writes every drawn value back onto the base at its overlay path", () => {
    const spec = study();
    const replicate = generateReplicate(spec, 5);
    expect(replicate.index).toBe(5);
    expect(replicate.values).toHaveLength(2);
    expect(replicate.spec.projectile.mass).toBe(replicate.values[0]);
    expect(replicate.spec.initialConditions.vx0).toBe(replicate.values[1]);
  });

  it("leaves everything the overlays do not name equal to the base", () => {
    const spec = study();
    const replicate = generateReplicate(spec, 5);
    expect(replicate.spec.environment).toEqual(BASE.environment);
    expect(replicate.spec.solver).toEqual(BASE.solver);
    expect(replicate.spec.model).toEqual(BASE.model);
    // base.seed in particular: varying the wind realization per replicate is
    // P6.16, deliberately not this task. If that stops being true, this
    // assertion is the one that should be deliberately changed.
    expect(replicate.spec.seed).toBe(BASE.seed);
  });

  it("produces a spec the base schema accepts", () => {
    const replicate = generateReplicate(study(), 5);
    expect(scenarioSpecSchema.safeParse(replicate.spec).success).toBe(true);
  });

  it("draws different values for different replicates", () => {
    const spec = study();
    const values = new Set(
      Array.from({ length: 32 }, (_unused, i) => generateReplicate(spec, i).values.join(",")),
    );
    expect(values.size).toBe(32);
  });

  it("draws from the declared distribution's support", () => {
    const spec = study();
    for (let i = 0; i < 64; i += 1) {
      const [, speed] = generateReplicate(spec, i).values;
      expect(speed).toBeGreaterThanOrEqual(20);
      expect(speed).toBeLessThan(30);
    }
  });

  it("accepts a study with no overlays and reproduces the base exactly", () => {
    // The degenerate case uncertain-scenario-spec.ts calls legitimate: a study
    // whose only randomness is stochastic wind in the base (P6.16).
    const replicate = generateReplicate(study({ overlays: [] }), 3);
    expect(replicate.values).toEqual([]);
    expect(replicate.spec).toEqual(BASE);
  });

  it("rejects a non-integer, negative or out-of-range index", () => {
    const spec = study();
    expect(() => generateReplicate(spec, 1.5)).toThrow(/must be an integer/);
    expect(() => generateReplicate(spec, -1)).toThrow(/must be an integer/);
    expect(() => generateReplicate(spec, MAX_REPLICATE_INDEX + 1)).toThrow(/must be an integer/);
    expect(() => generateReplicate(spec, Number.NaN)).toThrow(/must be an integer/);
    expect(() => generateReplicate(spec, MAX_REPLICATE_INDEX)).not.toThrow();
  });

  it("throws, naming the parameter and the drawn value, when a draw leaves the base schema", () => {
    // mass ~ N(0, 1) reaches negative values, which projectileSpecSchema
    // refuses. Throwing is deliberate: silently dropping the replicate would
    // be rejection sampling on the output and would bias the estimator.
    const spec = study({
      overlays: [
        {
          path: "projectile.mass",
          distribution: distributionSpecSchema.parse({ kind: "normal", mean: 0, stdDev: 1 }),
        },
      ],
    });
    let thrown: unknown;
    for (let i = 0; i < 64 && thrown === undefined; i += 1) {
      try {
        generateReplicate(spec, i);
      } catch (error) {
        thrown = error;
      }
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/projectile\.mass=-/);
    expect((thrown as Error).message).toMatch(/truncated variant/);
  });

  it("rejects a study carrying more overlays than the substream stride", () => {
    // Unreachable through the schema in practice; asserted because it is the
    // precondition replicateStreamId's injectivity rests on, and a silently
    // violated precondition would produce colliding streams rather than an
    // error.
    const oversized = {
      ...study(),
      overlays: { length: OVERLAY_STRIDE + 1, forEach: () => {} },
    } as unknown as UncertainScenarioSpec;
    expect(() => generateReplicate(oversized, 0)).toThrow(/at most/);
  });
});

/**
 * This task's validation criterion: "replicate i identical regardless of batch
 * partitioning". Everything above establishes that a replicate is a function
 * of (study, index); these are the cases that state it as the promise a worker
 * pool relies on (P6.04, P6.05).
 */
describe("batch partitioning independence", () => {
  it("gives the same replicate whether generated alone or inside any range", () => {
    const spec = study();
    for (const target of [0, 1, 7, 31, 63]) {
      const alone = generateReplicate(spec, target);
      for (const [start, count] of [
        [0, 64],
        [target, 1],
        [Math.max(0, target - 3), 8],
        [0, target + 1],
      ] as const) {
        const batch = generateReplicateRange(spec, start, count);
        const found = batch.find((replicate) => replicate.index === target);
        expect(found).toBeDefined();
        expect(found).toEqual(alone);
      }
    }
  });

  it("reassembles into the same sequence under every partition of 0..N-1", () => {
    const spec = study();
    const whole = generateReplicateRange(spec, 0, spec.replicates);
    // Every partition into contiguous chunks of a fixed size -- the shapes a
    // worker pool of 1, 2, 3, 5, 7, ... workers would produce.
    for (const chunk of [1, 2, 3, 5, 7, 16, 64]) {
      const reassembled: unknown[] = [];
      for (let start = 0; start < spec.replicates; start += chunk) {
        const count = Math.min(chunk, spec.replicates - start);
        reassembled.push(...generateReplicateRange(spec, start, count));
      }
      expect(reassembled).toEqual(whole);
    }
  });

  it("is unaffected by the order the ranges are asked for", () => {
    // A pool completes out of order; P6.05 turns that into a fixed reduction
    // order, but the generator must not carry hidden state that makes the
    // order matter in the first place.
    const spec = study();
    const forwards = generateReplicateRange(spec, 0, 16);
    const backwards: unknown[] = [];
    for (let start = 15; start >= 0; start -= 1) {
      backwards.unshift(...generateReplicateRange(spec, start, 1));
    }
    expect(backwards).toEqual(forwards);
  });

  it("gives the same sequence through the lazy generator as through a range", () => {
    const spec = study({ replicates: 12 });
    expect([...replicates(spec)]).toEqual(generateReplicateRange(spec, 0, 12));
  });

  it("rejects a negative or non-integer batch count", () => {
    expect(() => generateReplicateRange(study(), 0, -1)).toThrow(/non-negative integer/);
    expect(() => generateReplicateRange(study(), 0, 2.5)).toThrow(/non-negative integer/);
    expect(generateReplicateRange(study(), 0, 0)).toEqual([]);
  });
});

/**
 * The property that motivated per-(replicate, overlay) substreams rather than
 * one stream per replicate. It is not implied by batch independence, and one
 * stream per replicate would pass every case in the block above.
 */
describe("overlay independence", () => {
  it("does not move one parameter's draws when another's distribution changes", () => {
    const original = study();
    const changed = study({
      overlays: [
        {
          path: "projectile.mass",
          // A different KIND, so it consumes a different number of raw
          // uniforms: normal takes two through Box-Muller, uniform takes one.
          // A single per-replicate stream would shift every later draw.
          distribution: distributionSpecSchema.parse({
            kind: "uniform",
            min: BASE.projectile.mass * 0.98,
            max: BASE.projectile.mass * 1.02,
          }),
        },
        { path: SPEED_PATH, distribution: SPEED_UNIFORM },
      ],
    });
    for (let i = 0; i < 16; i += 1) {
      expect(generateReplicate(changed, i).values[1]).toBe(
        generateReplicate(original, i).values[1],
      );
      expect(generateReplicate(changed, i).values[0]).not.toBe(
        generateReplicate(original, i).values[0],
      );
    }
  });

  it("does not move a parameter's draws when an overlay is appended after it", () => {
    const original = study();
    const extended = study({
      overlays: [
        { path: "projectile.mass", distribution: MASS_NORMAL },
        { path: SPEED_PATH, distribution: SPEED_UNIFORM },
        {
          path: "solver.rtol",
          distribution: distributionSpecSchema.parse({ kind: "uniform", min: 1e-7, max: 1e-6 }),
        },
      ],
    });
    for (let i = 0; i < 16; i += 1) {
      const before = generateReplicate(original, i).values;
      const after = generateReplicate(extended, i).values;
      expect(after.slice(0, 2)).toEqual([...before]);
    }
  });

  it("changes every draw when the study seed changes", () => {
    const a = study({ seed: 7 });
    const b = study({ seed: 8 });
    for (let i = 0; i < 16; i += 1) {
      expect(generateReplicate(b, i).values).not.toEqual(generateReplicate(a, i).values);
    }
  });
});
