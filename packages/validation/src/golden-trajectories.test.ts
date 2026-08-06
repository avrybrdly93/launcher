import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GOLDEN_BASE_RELATIVE_TOLERANCE,
  GOLDEN_PRESET_IDS,
  GOLDEN_T_FINAL,
  GOLDEN_V2_SCENARIO_IDS,
  hashTrajectory,
  measureFinalStateSensitivity,
  runGoldenScenario,
  runGoldenTrajectory,
  toleranceForAmplification,
  type GoldenPresetId,
  type GoldenStepperKind,
  type GoldenV2ScenarioId,
} from "./golden-trajectory-store.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, "golden-trajectories.json");

const STEPPERS: readonly GoldenStepperKind[] = ["classical-rk4", "dopri5"];

/** §8.4: "hashes + full arrays for the small set" -- the one entry that also stores its complete t/channels arrays. */
const FULL_ARRAY_ENTRY: { presetId: GoldenPresetId; stepper: GoldenStepperKind } = {
  presetId: "smooth-sphere",
  stepper: "classical-rk4",
};

/**
 * §8.4's documented cross-platform relative tolerance, and v1's single global value. v2 keeps
 * it as the floor for every entry and only ever loosens it per-entry, from a measurement --
 * see `golden-trajectory-store.ts`'s tolerance-review section. The primary check remains the
 * exact hash, which is stricter (bit-exact, same-platform) and unaffected by any of this.
 */
const RELATIVE_TOLERANCE = GOLDEN_BASE_RELATIVE_TOLERANCE;

interface GoldenEntry {
  readonly presetId: GoldenPresetId;
  readonly stepper: GoldenStepperKind;
  readonly tFinal: number;
  readonly nSteps: number;
  readonly hash: string;
  readonly finalState: readonly number[];
  readonly fullTrajectory?: {
    readonly t: readonly number[];
    readonly channels: readonly (readonly number[])[];
  };
}

/**
 * A v2 entry: one P4.36 curated-library scenario, recorded with the store's regression-grade
 * solver. `tolerance` is derived from `amplification` by `toleranceForAmplification`, and
 * `amplification` is a *measurement* (see the store's tolerance-review section) -- neither is
 * hand-chosen, and the test below re-measures to prove it.
 */
interface GoldenV2Entry {
  readonly scenarioId: GoldenV2ScenarioId;
  readonly tFinal: number;
  readonly nSteps: number;
  readonly stateDim: number;
  readonly hash: string;
  readonly finalState: readonly number[];
  /** Measured roundoff amplification: relative final-state change per relative one-ulp change in y0. */
  readonly amplification: number;
  /** The relative tolerance the secondary final-state check uses for this entry. */
  readonly tolerance: number;
}

interface GoldenFixture {
  readonly schemaVersion: 2;
  readonly provenance: string;
  readonly entries: readonly GoldenEntry[];
  readonly v2Entries: readonly GoldenV2Entry[];
}

function recordFixture(): GoldenFixture {
  const entries: GoldenEntry[] = [];
  for (const presetId of GOLDEN_PRESET_IDS) {
    for (const stepper of STEPPERS) {
      const trajectory = runGoldenTrajectory(presetId, stepper);
      const isFullArrayEntry =
        presetId === FULL_ARRAY_ENTRY.presetId && stepper === FULL_ARRAY_ENTRY.stepper;
      const lastRow = trajectory.nSteps - 1;
      entries.push({
        presetId,
        stepper,
        tFinal: GOLDEN_T_FINAL,
        nSteps: trajectory.nSteps,
        hash: hashTrajectory(trajectory),
        finalState: Array.from(trajectory.channels, (channel) => channel[lastRow]!),
        ...(isFullArrayEntry
          ? {
              fullTrajectory: {
                t: Array.from(trajectory.t),
                channels: trajectory.channels.map((channel) => Array.from(channel)),
              },
            }
          : {}),
      });
    }
  }
  const v2Entries: GoldenV2Entry[] = [];
  for (const scenarioId of GOLDEN_V2_SCENARIO_IDS) {
    const trajectory = runGoldenScenario(scenarioId);
    const lastRow = trajectory.nSteps - 1;
    const { amplification } = measureFinalStateSensitivity(scenarioId);
    v2Entries.push({
      scenarioId,
      tFinal: GOLDEN_T_FINAL,
      nSteps: trajectory.nSteps,
      stateDim: trajectory.channels.length,
      hash: hashTrajectory(trajectory),
      finalState: Array.from(trajectory.channels, (channel) => channel[lastRow]!),
      amplification,
      tolerance: toleranceForAmplification(amplification),
    });
  }

  return {
    schemaVersion: 2,
    provenance:
      "Recorded via `UPDATE_GOLDENS=1 pnpm run update-goldens` (P2.52 for `entries`, P4.37 " +
      "for `v2Entries`; blueprint §8.4). Any intentional numerical change requires re-running " +
      "that command with a commit message explaining *why* results moved -- never hand-edit " +
      "this file. `amplification` is a measured quantity and will vary slightly across " +
      "platforms; `tolerance` is it rounded up to a decade, which is why a re-record on a " +
      "different machine should not move the tolerances.",
    entries,
    v2Entries,
  };
}

function loadFixture(): GoldenFixture {
  if (!existsSync(FIXTURE_PATH)) {
    throw new Error(
      `Golden fixture missing at ${FIXTURE_PATH}. Run "pnpm run update-goldens" to record it.`,
    );
  }
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as GoldenFixture;
}

describe("golden-trajectory store (v1 P2.52, v2 P4.37)", () => {
  if (process.env["UPDATE_GOLDENS"] === "1") {
    it("records a fresh golden fixture (UPDATE_GOLDENS=1)", () => {
      const fixture = recordFixture();
      writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + "\n");
      expect(fixture.entries).toHaveLength(GOLDEN_PRESET_IDS.length * STEPPERS.length);
      expect(fixture.v2Entries).toHaveLength(GOLDEN_V2_SCENARIO_IDS.length);
    });
    return;
  }

  const fixture = loadFixture();

  it("fixture covers every preset x stepper combination exactly once", () => {
    expect(fixture.entries).toHaveLength(GOLDEN_PRESET_IDS.length * STEPPERS.length);
  });

  it.each(
    GOLDEN_PRESET_IDS.flatMap((presetId) =>
      STEPPERS.map((stepper) => [presetId, stepper] as const),
    ),
  )("%s / %s matches its recorded golden trajectory", (presetId, stepper) => {
    const golden = fixture.entries.find((e) => e.presetId === presetId && e.stepper === stepper);
    expect(golden).toBeTruthy();

    const trajectory = runGoldenTrajectory(presetId, stepper);
    expect(trajectory.nSteps).toBe(golden!.nSteps);

    // Primary check: bit-exact on the same platform (§8.4).
    expect(hashTrajectory(trajectory)).toBe(golden!.hash);

    // Secondary, hash-independent check on the final state within §8.4's documented
    // cross-platform relative tolerance -- still meaningful if this ever runs somewhere
    // bit-exactness isn't expected.
    const lastRow = trajectory.nSteps - 1;
    for (let c = 0; c < trajectory.channels.length; c++) {
      const value = trajectory.channels[c]![lastRow]!;
      const goldenValue = golden!.finalState[c]!;
      const scale = Math.max(Math.abs(value), Math.abs(goldenValue), 1);
      expect(Math.abs(value - goldenValue)).toBeLessThanOrEqual(RELATIVE_TOLERANCE * scale);
    }
  });

  it("fixture covers every v2 library scenario exactly once", () => {
    expect(fixture.v2Entries).toHaveLength(GOLDEN_V2_SCENARIO_IDS.length);
    expect(fixture.v2Entries.map((e) => e.scenarioId)).toEqual([...GOLDEN_V2_SCENARIO_IDS]);
  });

  it.each(GOLDEN_V2_SCENARIO_IDS.map((id) => [id] as const))(
    "v2 %s matches its recorded golden trajectory",
    (scenarioId) => {
      const golden = fixture.v2Entries.find((e) => e.scenarioId === scenarioId);
      expect(golden).toBeTruthy();

      const trajectory = runGoldenScenario(scenarioId);
      expect(trajectory.nSteps).toBe(golden!.nSteps);
      expect(trajectory.channels.length).toBe(golden!.stateDim);

      // Primary check: bit-exact on the same platform (§8.4). Unaffected by this entry's
      // tolerance -- a loose tolerance never weakens the same-platform ratchet.
      expect(hashTrajectory(trajectory)).toBe(golden!.hash);

      // Secondary, hash-independent check at this entry's own reviewed tolerance.
      const lastRow = trajectory.nSteps - 1;
      for (let c = 0; c < trajectory.channels.length; c++) {
        const value = trajectory.channels[c]![lastRow]!;
        const goldenValue = golden!.finalState[c]!;
        const scale = Math.max(Math.abs(value), Math.abs(goldenValue), 1);
        expect(Math.abs(value - goldenValue)).toBeLessThanOrEqual(golden!.tolerance * scale);
      }
    },
  );

  it("every v2 tolerance is at or above §8.4's floor, and is the recorded amplification's own decade", () => {
    for (const entry of fixture.v2Entries) {
      expect(entry.tolerance).toBeGreaterThanOrEqual(RELATIVE_TOLERANCE);
      // The recorded tolerance must be exactly what the recorded amplification implies -- this
      // is what stops a future session from quietly widening a tolerance to silence a real
      // regression, since widening it means editing `amplification` to match, and that number
      // is re-measured below.
      expect(entry.tolerance).toBe(toleranceForAmplification(entry.amplification));
    }
  });

  it.each(GOLDEN_V2_SCENARIO_IDS.map((id) => [id] as const))(
    "v2 %s is no worse conditioned than its recorded amplification claims",
    (scenarioId) => {
      const golden = fixture.v2Entries.find((e) => e.scenarioId === scenarioId)!;
      const { amplification } = measureFinalStateSensitivity(scenarioId);
      // Re-measuring is the point: it proves the recorded amplification (and so the tolerance
      // derived from it) describes this code, not the code at record time.
      //
      // Compared at decade resolution with one decade of slack, not exactly. The measurement
      // is platform-dependent by nature, and an entry sitting just under a decade boundary
      // (frozen-ou-gust records 2.6e8 against a boundary at 4.5e8) would otherwise turn a
      // benign libm difference into a red suite. One decade still catches what this assertion
      // exists to catch: an entry whose conditioning has genuinely degraded, or a recorded
      // amplification that was never measured at all.
      expect(toleranceForAmplification(amplification)).toBeLessThanOrEqual(golden.tolerance * 10);
    },
  );

  it("the full-array entry's stored trajectory matches a fresh recomputation exactly", () => {
    const golden = fixture.entries.find(
      (e) => e.presetId === FULL_ARRAY_ENTRY.presetId && e.stepper === FULL_ARRAY_ENTRY.stepper,
    );
    expect(golden?.fullTrajectory).toBeTruthy();

    const trajectory = runGoldenTrajectory(FULL_ARRAY_ENTRY.presetId, FULL_ARRAY_ENTRY.stepper);
    expect(Array.from(trajectory.t)).toEqual(golden!.fullTrajectory!.t);
    for (let c = 0; c < trajectory.channels.length; c++) {
      expect(Array.from(trajectory.channels[c]!)).toEqual(golden!.fullTrajectory!.channels[c]);
    }
  });
});
