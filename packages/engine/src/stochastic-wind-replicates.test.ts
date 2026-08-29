/**
 * P6.16 -- one frozen OU path per replicate (ADR-011 integration).
 *
 * The task's validation criterion is *"seed determinism across pool sizes"*.
 * That phrase names the failure it is guarding against: a study whose wind
 * realizations depend on how a worker pool happened to partition the work
 * still produces N trajectories and a perfectly plausible ensemble mean, and
 * nothing about the output says the number is not reproducible. So the tests
 * below check the derivation directly and from several partitions, rather than
 * checking that a study "runs".
 *
 * They also check the two things a seed-level test alone would miss: that the
 * derived seed actually reaches the *wind* (a seed written into the spec but
 * ignored by `toWind` would pass every determinism assertion while changing
 * nothing physical), and that turning the feature on does not disturb the
 * overlay draws.
 */

import { describe, expect, it } from "vitest";
import { distributionSpecSchema, type DistributionSpec } from "./distribution.js";
import { EnvSample } from "./env-sample.js";
import {
  WIND_OVERLAY_INDEX,
  generateAntitheticPair,
  generateReplicate,
  generateReplicateRange,
  replicateStreamId,
  replicateWindSeed,
  replicates,
} from "./replicate-generator.js";
import { findCuratedScenario } from "./scenario-library.js";
import {
  environmentSpecToEnvironment,
  scenarioSpecSchema,
  type ScenarioSpec,
} from "./scenario-spec.js";
import {
  uncertainScenarioSpecSchema,
  type UncertainScenarioSpec,
} from "./uncertain-scenario-spec.js";

/**
 * The curated stochastic scenario, not a hand-rolled one: its own note calls it
 * "the scenario a Monte-Carlo study varies the seed of", and using it means
 * this file exercises the same wind spec the app ships rather than a fixture
 * that could drift from it.
 */
const OU_BASE: ScenarioSpec = scenarioSpecSchema.parse(findCuratedScenario("frozen-ou-gust")!.spec);

/**
 * A deterministic-wind scenario, for the refusal case: the same base with its
 * wind swapped for a uniform one, so the two differ in exactly the field the
 * refusal turns on and nothing else.
 */
const UNIFORM_WIND_BASE: ScenarioSpec = scenarioSpecSchema.parse({
  ...OU_BASE,
  environment: { ...OU_BASE.environment, wind: { kind: "uniform", wx: 4, wy: 0 } },
});

const MASS_NORMAL: DistributionSpec = distributionSpecSchema.parse({
  kind: "normal",
  mean: OU_BASE.projectile.mass,
  stdDev: OU_BASE.projectile.mass * 0.02,
});

function study(overrides: Record<string, unknown> = {}): UncertainScenarioSpec {
  return uncertainScenarioSpecSchema.parse({
    schemaVersion: 1,
    base: OU_BASE,
    overlays: [{ path: "projectile.mass", distribution: MASS_NORMAL }],
    replicates: 32,
    seed: 11,
    ...overrides,
  });
}

/**
 * The frozen wind path of a replicate's spec, sampled on a grid.
 *
 * This is the physically meaningful comparison. Two specs carrying different
 * `seed` values are only *actually* different scenarios if the wind that comes
 * out the other end differs, and ADR-011 puts a PCHIP interpolant and a whole
 * OU path between the seed and that wind.
 */
function windSamples(spec: ScenarioSpec, count = 24): number[] {
  const environment = environmentSpecToEnvironment(spec.environment, spec.seed);
  const out = new EnvSample();
  const samples: number[] = [];
  for (let k = 0; k < count; k += 1) {
    environment.sample(k * 0.31, 0, 10, out);
    samples.push(out.wx);
  }
  return samples;
}

describe("windReplication defaults to shared", () => {
  it("leaves every replicate on the base scenario's own seed", () => {
    const shared = study();
    expect(shared.windReplication).toBe("shared");
    for (const replicate of replicates(shared)) {
      expect(replicate.spec.seed).toBe(OU_BASE.seed);
    }
  });

  it("gives every replicate the identical frozen wind path", () => {
    const nominal = windSamples(OU_BASE);
    for (const replicate of replicates(study())) {
      expect(windSamples(replicate.spec)).toEqual(nominal);
    }
    // Guards the guard: a path of all zeros would make the assertion above
    // vacuously true for any two specs.
    expect(nominal.some((w) => w !== 0)).toBe(true);
  });
});

describe("windReplication per-replicate", () => {
  const varied = study({ windReplication: "per-replicate" });

  it("gives each replicate a distinct seed", () => {
    const seeds = [...replicates(varied)].map((replicate) => replicate.spec.seed);
    expect(seeds).toHaveLength(32);
    expect(new Set(seeds).size).toBe(32);
    expect(seeds).not.toContain(OU_BASE.seed);
  });

  it("produces seeds the base schema accepts, as exact integers", () => {
    for (const replicate of replicates(varied)) {
      expect(Number.isSafeInteger(replicate.spec.seed)).toBe(true);
      expect(replicate.spec.seed).toBeGreaterThanOrEqual(0);
      // Already true by construction -- generateReplicate re-parses -- but
      // stated here so a future change to the reduction fails on this line
      // rather than inside an unrelated schema error.
      expect(scenarioSpecSchema.safeParse(replicate.spec).success).toBe(true);
    }
  });

  it("actually changes the frozen wind path, not merely the seed field", () => {
    const first = windSamples(generateReplicate(varied, 0).spec);
    const second = windSamples(generateReplicate(varied, 1).spec);
    expect(first).not.toEqual(second);
    expect(first.some((w) => w !== 0)).toBe(true);
  });

  it("does not disturb the overlay draws", () => {
    // The reserved substream slot exists so that switching this option on
    // changes the wind and nothing else. If the wind seed were drawn from an
    // overlay's stream, this would fail.
    for (let index = 0; index < 8; index += 1) {
      expect(generateReplicate(varied, index).values).toEqual(
        generateReplicate(study(), index).values,
      );
    }
  });
});

describe("seed determinism across pool sizes (P6.16 criterion)", () => {
  const varied = study({ windReplication: "per-replicate", replicates: 12 });

  /** Every partition of 0..11 a worker pool of some size could produce. */
  const partitions: number[][] = [
    [12],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [5, 7],
    [7, 5],
    [3, 3, 3, 3],
    [1, 4, 2, 5],
  ];

  it("derives the same seed for a replicate however the work is split", () => {
    const alone = Array.from(
      { length: 12 },
      (_, index) => generateReplicate(varied, index).spec.seed,
    );

    for (const partition of partitions) {
      const batched: number[] = [];
      let start = 0;
      for (const count of partition) {
        batched.push(...generateReplicateRange(varied, start, count).map((r) => r.spec.seed));
        start += count;
      }
      expect(batched).toEqual(alone);
    }

    // ...and the lazy whole-study generator agrees with all of them.
    expect([...replicates(varied)].map((r) => r.spec.seed)).toEqual(alone);
  });

  it("derives the same frozen wind path however the work is split", () => {
    // The seeds agreeing is necessary but not sufficient: the criterion is
    // about the realization, and the seed only matters through the path.
    const alone = Array.from({ length: 12 }, (_, index) =>
      windSamples(generateReplicate(varied, index).spec, 8),
    );
    const batched = [
      ...generateReplicateRange(varied, 0, 5),
      ...generateReplicateRange(varied, 5, 7),
    ].map((replicate) => windSamples(replicate.spec, 8));
    expect(batched).toEqual(alone);
  });

  it("depends on the study seed and the replicate index, and on nothing else", () => {
    expect(replicateWindSeed(11, 3)).toBe(replicateWindSeed(11, 3));
    expect(replicateWindSeed(11, 3)).not.toBe(replicateWindSeed(11, 4));
    expect(replicateWindSeed(11, 3)).not.toBe(replicateWindSeed(12, 3));

    // A study that differs only in its replicate count draws the same wind for
    // the replicates it shares -- so extending a study keeps every realization
    // it already had, exactly as P6.15 established for Sobol' points.
    const longer = study({ windReplication: "per-replicate", replicates: 64 });
    for (let index = 0; index < 12; index += 1) {
      expect(generateReplicate(longer, index).spec.seed).toBe(
        generateReplicate(varied, index).spec.seed,
      );
    }
  });

  it("draws the wind seed from a slot no overlay can occupy", () => {
    // The concrete statement of the reservation. A study may carry at most
    // WIND_OVERLAY_INDEX overlays, so overlay indices are 0..WIND_OVERLAY_INDEX-1
    // and this stream id is unreachable by any of them.
    expect(replicateStreamId(3, WIND_OVERLAY_INDEX)).not.toBe(replicateStreamId(3, 0));
    for (let overlayIndex = 0; overlayIndex < 4; overlayIndex += 1) {
      expect(replicateStreamId(3, overlayIndex)).toBeLessThan(
        replicateStreamId(3, WIND_OVERLAY_INDEX),
      );
    }
  });
});

describe("antithetic pairs share one wind realization", () => {
  it("gives the partner the primary's seed", () => {
    // A seed has no distribution to reflect about, so "the opposite gust field"
    // is not a thing. Sharing the wind is also what keeps the pair's variance
    // reduction attributable to the mirrored parameters (P6.12).
    const varied = study({ windReplication: "per-replicate" });
    for (let index = 0; index < 6; index += 1) {
      const [primary, partner] = generateAntitheticPair(varied, index);
      expect(partner.spec.seed).toBe(primary.spec.seed);
      expect(primary.spec.seed).toBe(replicateWindSeed(varied.seed, index));
    }
  });
});

describe("the schema refuses a per-replicate study that cannot deliver one", () => {
  it("rejects a base scenario whose wind is not stochastic", () => {
    const result = uncertainScenarioSpecSchema.safeParse({
      schemaVersion: 1,
      base: UNIFORM_WIND_BASE,
      overlays: [],
      replicates: 8,
      seed: 3,
      windReplication: "per-replicate",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("requires a stochastic wind");
    expect(result.error?.issues[0]?.path).toEqual(["windReplication"]);
  });

  it("accepts that same base under the shared default", () => {
    expect(
      uncertainScenarioSpecSchema.safeParse({
        schemaVersion: 1,
        base: UNIFORM_WIND_BASE,
        overlays: [],
        replicates: 8,
        seed: 3,
      }).success,
    ).toBe(true);
  });

  it("rejects a study that also varies seed through an overlay", () => {
    const result = uncertainScenarioSpecSchema.safeParse({
      schemaVersion: 1,
      base: OU_BASE,
      overlays: [
        { path: "projectile.mass", distribution: MASS_NORMAL },
        { path: "seed", distribution: { kind: "uniform", min: 0, max: 1000 } },
      ],
      replicates: 8,
      seed: 3,
      windReplication: "per-replicate",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("one of the two must go");
    expect(result.error?.issues[0]?.path).toEqual(["overlays", 1, "path"]);
  });
});
