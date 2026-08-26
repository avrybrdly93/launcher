/**
 * P6.12 -- the replicate-level half of the antithetic option.
 *
 * `antithetic-sampling.test.ts` covers the draw. This file covers the pairing:
 * that a partner reuses its primary's substreams, that the pairing survives
 * batch partitioning exactly as P6.03's replicates do, and that the produced
 * specs are real, schema-valid scenarios rather than mirrored numbers written
 * into a shape nothing will run.
 */

import { describe, expect, it } from "vitest";
import { distributionSpecSchema, type DistributionSpec } from "./distribution.js";
import {
  antitheticReplicates,
  generateAntitheticPair,
  generateAntitheticReplicate,
  generateReplicate,
  replicates,
} from "./replicate-generator.js";
import { PRESET_SCENARIOS } from "./scenario-presets.js";
import { scenarioSpecSchema, type ScenarioSpec } from "./scenario-spec.js";
import {
  uncertainScenarioSpecSchema,
  type UncertainScenarioSpec,
} from "./uncertain-scenario-spec.js";

const BASE: ScenarioSpec = scenarioSpecSchema.parse(PRESET_SCENARIOS[0]);

/** The normal overlay's mean, kept as a plain number: `DistributionSpec` is a
 * union and does not narrow to the normal variant just because the literal
 * passed to `parse` did. */
const MASS_MEAN = BASE.projectile.mass;

const MASS_NORMAL: DistributionSpec = distributionSpecSchema.parse({
  kind: "normal",
  mean: MASS_MEAN,
  stdDev: MASS_MEAN * 0.02,
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

describe("generateAntitheticReplicate", () => {
  it("mirrors every drawn parameter about its distribution's centre", () => {
    const spec = study();
    for (let index = 0; index < 24; index += 1) {
      const primary = generateReplicate(spec, index);
      const partner = generateAntitheticReplicate(spec, index);
      // Overlay 0 is normal: the pair straddles the mean.
      expect(primary.values[0]! + partner.values[0]!).toBeCloseTo(2 * MASS_MEAN, 12);
      // Overlay 1 is uniform on [20, 30]: the pair straddles the midpoint.
      expect(primary.values[1]! + partner.values[1]!).toBeCloseTo(50, 10);
    }
  });

  it("carries the same index as its primary", () => {
    // The partner is the same replicate of the study, drawn the other way --
    // not a separate replicate. A reducer that grouped by index must see a pair.
    expect(generateAntitheticReplicate(study(), 5).index).toBe(5);
  });

  it("writes the drawn values into the spec, not just into `values`", () => {
    const spec = study();
    const partner = generateAntitheticReplicate(spec, 3);
    expect(partner.spec.projectile.mass).toBe(partner.values[0]);
    expect(partner.spec.initialConditions.vx0).toBe(partner.values[1]);
  });

  it("produces a spec that re-parses under the base schema", () => {
    // The partner goes through the same validation as the primary, because both
    // are built by one function. A parallel implementation could accept a
    // mirrored vector the primary would have rejected.
    const partner = generateAntitheticReplicate(study(), 11);
    expect(scenarioSpecSchema.safeParse(partner.spec).success).toBe(true);
  });

  it("is independent of batch partitioning, exactly as the primary is", () => {
    const spec = study();
    const wholeRun = Array.from({ length: 16 }, (_unused, index) =>
      generateAntitheticReplicate(spec, index),
    );
    // Generated alone, out of order, and interleaved with unrelated indices.
    expect(generateAntitheticReplicate(spec, 9)).toEqual(wholeRun[9]);
    expect(generateAntitheticReplicate(spec, 0)).toEqual(wholeRun[0]);
    for (const index of [15, 2, 7, 2]) {
      expect(generateAntitheticReplicate(spec, index)).toEqual(wholeRun[index]);
    }
  });

  it("rejects the same out-of-range indices the primary rejects", () => {
    expect(() => generateAntitheticReplicate(study(), -1)).toThrow(/integer in/);
    expect(() => generateAntitheticReplicate(study(), 1.5)).toThrow(/integer in/);
  });

  it("differs from its primary for every index", () => {
    // Guards the failure mode where the sense is dropped somewhere in the
    // plumbing and the "partner" is silently the primary again -- which would
    // leave every assertion about determinism above passing.
    const spec = study();
    for (let index = 0; index < 32; index += 1) {
      expect(generateAntitheticReplicate(spec, index).values).not.toEqual(
        generateReplicate(spec, index).values,
      );
    }
  });
});

describe("generateAntitheticPair", () => {
  it("returns the primary first and its partner second", () => {
    const spec = study();
    const [primary, partner] = generateAntitheticPair(spec, 4);
    expect(primary).toEqual(generateReplicate(spec, 4));
    expect(partner).toEqual(generateAntitheticReplicate(spec, 4));
  });
});

describe("antitheticReplicates", () => {
  it("yields each primary immediately followed by its partner", () => {
    const spec = study({ replicates: 8 });
    const drawn = [...antitheticReplicates(spec)];
    expect(drawn).toHaveLength(8);
    for (let pair = 0; pair < 4; pair += 1) {
      expect(drawn[2 * pair]).toEqual(generateReplicate(spec, pair));
      expect(drawn[2 * pair + 1]).toEqual(generateAntitheticReplicate(spec, pair));
    }
  });

  it("rounds an odd replicate count up to a whole pair", () => {
    // Truncating would leave the last primary unmatched, and an unmatched draw
    // does not carry the pair's variance -- an estimator averaging within pairs
    // would then be quoting error bars for a sample it does not have.
    const drawn = [...antitheticReplicates(study({ replicates: 7 }))];
    expect(drawn).toHaveLength(8);
    expect(drawn[7]!.index).toBe(3);
  });

  it("still yields a whole pair for a single-replicate study", () => {
    // The smallest study the schema permits -- `replicates` must be positive,
    // so a zero-replicate study is not reachable and is not tested here. One
    // replicate is the extreme case of the rounding above: the option's unit is
    // the pair, so asking for one draw with it on gives two.
    const spec = study({ replicates: 1 });
    const drawn = [...antitheticReplicates(spec)];
    expect(drawn).toHaveLength(2);
    expect(drawn[0]).toEqual(generateReplicate(spec, 0));
    expect(drawn[1]).toEqual(generateAntitheticReplicate(spec, 0));
  });

  it("shares its primaries with the default generator", () => {
    // The option changes which *extra* replicates are drawn; it must not move
    // the ones a plain run would have produced, or turning it on would
    // invalidate a stored comparison.
    const spec = study({ replicates: 6 });
    const plain = [...replicates(spec)];
    const paired = [...antitheticReplicates(spec)];
    for (let pair = 0; pair < 3; pair += 1) {
      expect(paired[2 * pair]).toEqual(plain[pair]);
    }
  });
});
