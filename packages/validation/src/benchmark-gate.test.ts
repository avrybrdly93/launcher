// P0.140 regression guard: the soft-warn benchmark gate must stay above its
// own metric's measured noise floor.
//
// scripts/check-benchmark-regression.mjs warns when a stepper's throughput
// relative to explicit-euler falls more than REGRESSION_THRESHOLD_PCT below
// the recorded baseline. For most of this repo's life that threshold was 15%
// while the metric's own same-machine run-to-run downward deviation was 19.3%,
// so whether the gate fired was a property of the afternoon rather than of the
// code. P0.140 fixed it by measuring for 1000 ms per trial instead of 300,
// which drops the downward deviation to 5.6% -- see the comment block on
// MIN_DURATION_MS for the seven-repeat table the numbers come from.
//
// The failure mode this file guards is a one-character reversion. Nothing
// fails when MIN_DURATION_MS goes back to 300: the script still runs, still
// exits 0, and still prints an all-clear, because the gate is a deliberate
// soft warn that never fails CI. The noise would simply come back, silently,
// and the next person to see a spurious ::warning:: would have no way to tell
// it from a real regression. That is the same shape as P0.90's: a defect
// visible to nobody because the thing it breaks never reports.
//
// These are string assertions on the script rather than a run of it. The
// script takes ~27 s to measure, which does not belong in the unit suite, and
// the failure mode is an edited constant -- exactly what a string assertion
// catches. The 5.6% figure is not re-measured here either; re-measuring it
// would make this suite's runtime depend on a benchmark, and P7.20's standing
// objection to timing anything in this container applies.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT_PATH = join(REPO_ROOT, "scripts", "check-benchmark-regression.mjs");
const SCRIPT = readFileSync(SCRIPT_PATH, "utf8");

/** The worst DOWNWARD deviation P0.140 measured at 1000 ms x 3, in percent. */
const MEASURED_NOISE_FLOOR_PCT = 5.6;

/** The shortest window P0.140's measurement found sufficient, in milliseconds. */
const MEASURED_SUFFICIENT_DURATION_MS = 1000;

function readNumericConst(name: string): number {
  const match = SCRIPT.match(new RegExp(`^const ${name} = (\\d[\\d_]*);`, "m"));
  const literal = match?.[1];
  expect(literal, `${name} is no longer a plain numeric const in ${SCRIPT_PATH}`).toBeDefined();
  return Number((literal ?? "").replace(/_/g, ""));
}

describe("the benchmark regression gate stays above its measured noise floor (P0.140)", () => {
  it("measures for at least as long as the window the noise measurement used", () => {
    expect(readNumericConst("MIN_DURATION_MS")).toBeGreaterThanOrEqual(
      MEASURED_SUFFICIENT_DURATION_MS,
    );
  });

  it("gates at a threshold above the measured downward deviation", () => {
    expect(readNumericConst("REGRESSION_THRESHOLD_PCT")).toBeGreaterThan(MEASURED_NOISE_FLOOR_PCT);
  });

  it("keeps enough margin that the gate is not merely technically above the floor", () => {
    // 2x is a judgement, not a measurement, and is written here rather than
    // left implicit so that a future run that wants to lower the threshold has
    // to argue with a number. The current setting clears it comfortably
    // (15% against 5.6%, i.e. 2.7x).
    expect(readNumericConst("REGRESSION_THRESHOLD_PCT")).toBeGreaterThanOrEqual(
      2 * MEASURED_NOISE_FLOOR_PCT,
    );
  });

  it("still keeps more than one trial, so a single scheduler stall cannot decide a run", () => {
    expect(readNumericConst("TRIALS_PER_METHOD")).toBeGreaterThanOrEqual(2);
  });

  it("carries the measurement that justifies the window, not just the number", () => {
    // The table is the reason the constant is 1000. A future edit that changes
    // the constant without changing the table leaves a comment that lies.
    expect(SCRIPT).toContain("worst DOWNWARD deviation");
    expect(SCRIPT).toContain("1000 ms x 3");
  });
});
