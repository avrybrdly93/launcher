import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GOLDEN_PRESET_IDS,
  GOLDEN_T_FINAL,
  hashTrajectory,
  runGoldenTrajectory,
  type GoldenPresetId,
  type GoldenStepperKind,
} from "./golden-trajectory-store.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, "golden-trajectories.json");

const STEPPERS: readonly GoldenStepperKind[] = ["classical-rk4", "dopri5"];

/** §8.4: "hashes + full arrays for the small set" -- the one entry that also stores its complete t/channels arrays. */
const FULL_ARRAY_ENTRY: { presetId: GoldenPresetId; stepper: GoldenStepperKind } = {
  presetId: "smooth-sphere",
  stepper: "classical-rk4",
};

/** §8.4's documented cross-platform relative tolerance; the primary check is the exact hash, which is stricter (bit-exact, same-platform). */
const RELATIVE_TOLERANCE = 1e-13;

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

interface GoldenFixture {
  readonly schemaVersion: 1;
  readonly provenance: string;
  readonly entries: readonly GoldenEntry[];
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
  return {
    schemaVersion: 1,
    provenance:
      "Recorded via `UPDATE_GOLDENS=1 pnpm run update-goldens` (P2.52, blueprint §8.4). " +
      "Any intentional numerical change requires re-running that command with a commit " +
      "message explaining *why* results moved -- never hand-edit this file.",
    entries,
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

describe("golden-trajectory store v1 (P2.52)", () => {
  if (process.env["UPDATE_GOLDENS"] === "1") {
    it("records a fresh golden fixture (UPDATE_GOLDENS=1)", () => {
      const fixture = recordFixture();
      writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + "\n");
      expect(fixture.entries).toHaveLength(GOLDEN_PRESET_IDS.length * STEPPERS.length);
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
