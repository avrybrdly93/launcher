/**
 * P7.18: the two-float accumulator's effect on the planar f32 path.
 *
 * ## What the criterion is read on, and why it is not one number
 *
 * The task asks for "error reduced >=10x vs plain f32 on long flight". It does
 * not say which observable, and the answer depends entirely on that, so the
 * choice was fixed in ROADMAP.json before any of this was measured: the task
 * is an accumulation option for the POSITION update, so the criterion is read
 * on the position observables -- `range` and `apexHeight`.
 *
 * That is not a convenient narrowing. Folding all four channels into a single
 * worst-case would cap the measurable gain at ~6x on this scenario, and the cap
 * would be entirely due to `apexT`, a TIME observable that the position
 * accumulator cannot and should not touch. Reporting 6x would describe the
 * instrument's reach, not its effect. Both halves are asserted below: the
 * position channels improve by three to four orders of magnitude, and the time
 * channels are pinned as NOT improving, so a later change that claims otherwise
 * has to come with a reason.
 *
 * ## Why the time channels do not move
 *
 * `apexT` and `impactT` come from the march's clock, `round(t0 + round(n*h))`,
 * which is recomputed from `n` every step rather than accumulated. There is no
 * running sum there to compensate -- which is exactly why P7.17 found the
 * governing quantity to be `ulp32(t)/h`, the clock's resolution, rather than
 * anything about the state update. Compensating position does not make the
 * clock finer, and this file asserts that it does not pretend to.
 */

import { describe, expect, it } from "vitest";

import { identity, toF32 } from "@ballista/solverkit";

import { reducePlanarObservables } from "./planar-observables-flight.js";
import { PRECISION_SCENARIOS } from "./planar-precision-scenarios.js";
import { relativeError } from "./planar-precision-study.js";

/** The drag-free row: the longest flight in the study, and P7.17's worst. */
const DRAG_FREE = PRECISION_SCENARIOS.find((s) => s.id === "vacuum-45deg")!;

/** The task's own bar. */
const REQUIRED_IMPROVEMENT = 10;

interface Arms {
  readonly plain: number;
  readonly compensated: number;
  readonly improvement: number;
}

function compare(
  scenario: (typeof PRECISION_SCENARIOS)[number],
  channel: "range" | "apexHeight" | "apexT" | "impactT",
  overrides: { readonly h?: number; readonly steps?: number } = {},
): Arms {
  const base = {
    y0: scenario.y0,
    h: overrides.h ?? scenario.h,
    steps: overrides.steps ?? scenario.steps,
    params: scenario.params,
  };
  const f64 = reducePlanarObservables({ ...base, round: identity });
  const plainArm = reducePlanarObservables({ ...base, round: toF32 });
  const compArm = reducePlanarObservables({ ...base, round: toF32, compensated: true });

  // A row that never landed would compare 0 against 0 and report perfect
  // agreement having measured nothing -- P7.16's vacuous-pass trap.
  expect(f64.impacted).toBe(true);
  expect(plainArm.impacted).toBe(true);
  expect(compArm.impacted).toBe(true);

  const plain = relativeError(f64[channel], plainArm[channel]);
  const compensated = relativeError(f64[channel], compArm[channel]);
  return {
    plain,
    compensated,
    improvement: compensated === 0 ? Number.POSITIVE_INFINITY : plain / compensated,
  };
}

describe("P7.18 validation criterion: >=10x on the long flight", () => {
  it("reduces range error on the drag-free long flight by far more than 10x", () => {
    const { plain, compensated, improvement } = compare(DRAG_FREE, "range");
    // Measured: 6.3e-5 -> 7.3e-9, about 8600x. The bar is 10x; the assertion
    // is written at 100x so it is a real gate rather than a restatement of the
    // criterion, while still leaving three orders of headroom against the
    // measured value so an ULP-level platform difference cannot red it.
    expect(plain).toBeGreaterThan(1e-5);
    expect(improvement).toBeGreaterThan(100);
    expect(compensated).toBeLessThan(plain / REQUIRED_IMPROVEMENT);
  });

  it("reduces apex-height error on the same flight by more than 10x", () => {
    const { improvement } = compare(DRAG_FREE, "apexHeight");
    expect(improvement).toBeGreaterThan(REQUIRED_IMPROVEMENT);
  });

  it("reduces range error by more than 10x on every scenario in the study", () => {
    // Not just the drag-free row. Measured improvements: 8585x (vacuum), 23.7x
    // (shot-put), 21.7x (table-tennis), 13.8x (table-tennis-cannon).
    for (const scenario of PRECISION_SCENARIOS) {
      const { improvement } = compare(scenario, "range");
      expect(improvement, `range on ${scenario.id}`).toBeGreaterThan(REQUIRED_IMPROVEMENT);
    }
  });

  it("improves further as the march gets longer, which is the stated mechanism", () => {
    // The claim is that plain-accumulator error grows with STEP COUNT. If that
    // is why compensation helps, then holding the flight fixed and refining the
    // step must make the plain arm worse while leaving the compensated arm
    // roughly where it is. A test that only checked one step size could not
    // tell this mechanism from any other.
    const coarse = compare(DRAG_FREE, "range", { h: 0.001, steps: 6000 });
    const fine = compare(DRAG_FREE, "range", { h: 0.0000625, steps: 96000 });

    expect(fine.plain).toBeGreaterThan(coarse.plain);
    expect(fine.improvement).toBeGreaterThan(coarse.improvement);
    // And the compensated arm does not degrade as the step count grows 16x,
    // which is the half that makes it an accumulator fix rather than luck.
    expect(fine.compensated).toBeLessThan(1e-6);
  });
});

describe("P7.18 limits: what the accumulator does not do", () => {
  it("does not improve the time observables, because the clock is not accumulated", () => {
    // Pinned deliberately. `apexT` is the channel that caps the worst-case
    // improvement at ~6x on this scenario, and the reason is structural: the
    // march recomputes t from n every step, so there is no running sum to
    // compensate. If a future change makes this ratio large, the clock has
    // changed and this file should be read again rather than updated to match.
    const apexT = compare(DRAG_FREE, "apexT");
    expect(apexT.improvement).toBeLessThan(REQUIRED_IMPROVEMENT);
  });

  it("leaves apex height on shot-put at the f32 floor rather than improving it", () => {
    // Recorded because it is the one channel-scenario pair where the
    // compensated arm is numerically WORSE (1.4e-8 -> 9.8e-8), and hiding that
    // behind a worst-case aggregate would be the dishonest way to report this.
    // Both values are three orders of magnitude inside the study's 1e-5 budget:
    // at that level the comparison is a few ULP of a quantity whose plain error
    // was already at the floor, so it measures noise, not a regression.
    const { plain, compensated } = compare(PRECISION_SCENARIOS[1]!, "apexHeight");
    expect(PRECISION_SCENARIOS[1]!.id).toBe("shot-put");
    expect(plain).toBeLessThan(1e-6);
    expect(compensated).toBeLessThan(1e-6);
  });
});

describe("P7.18 controls", () => {
  it("changes the f32 answer at all, so the option is actually wired", () => {
    // The control P7.17's lesson demands: an option that silently did nothing
    // would make every 'no worse than plain' assertion above pass vacuously.
    const base = {
      y0: DRAG_FREE.y0,
      h: DRAG_FREE.h,
      steps: DRAG_FREE.steps,
      params: DRAG_FREE.params,
      round: toF32,
    };
    const plain = reducePlanarObservables(base);
    const compensated = reducePlanarObservables({ ...base, compensated: true });
    expect(compensated.range).not.toBe(plain.range);
  });

  it("moves the f64 path too, and the closed form says it moves the right way", () => {
    // This test was written asserting the f64 arm was bit-identical with the
    // option on. It is not, and the correction is the more useful result.
    //
    // `roundedKahanAdd` under `identity` reduces to `kahanAdd` exactly -- that
    // much is asserted in compensated-summation.test.ts -- but `kahanAdd` is
    // not a plain add, so the f64 MARCH changes as well: the drag-free range
    // moves from 91.77445916800235 to 91.77445916801352, about 1.2e-13
    // relative.
    //
    // Which arm is right is not a matter of opinion here. Drag-free range has
    // a closed form, v0^2 * sin(2*theta) / g, and the compensated arm is ~400x
    // closer to it: 3.1e-16 relative against 1.2e-13. So the accumulator
    // improves f64 too; f64 was simply never the binding constraint.
    //
    // The consequence is the reason this is a control rather than a footnote:
    // enabling this by default would move every recorded f64 reference in the
    // repository. That is why the default is off and why the next test pins it.
    const base = {
      y0: DRAG_FREE.y0,
      h: DRAG_FREE.h,
      steps: DRAG_FREE.steps,
      params: DRAG_FREE.params,
      round: identity,
    };
    const plain = reducePlanarObservables(base);
    const compensated = reducePlanarObservables({ ...base, compensated: true });

    const theta = Math.PI / 4;
    const v0 = 30;
    const closedForm = (v0 * v0 * Math.sin(2 * theta)) / DRAG_FREE.params.g;

    expect(compensated.range).not.toBe(plain.range);
    expect(relativeError(closedForm, plain.range)).toBeGreaterThan(1e-14);
    expect(relativeError(closedForm, compensated.range)).toBeLessThan(1e-14);
    expect(relativeError(closedForm, compensated.range)).toBeLessThan(
      relativeError(closedForm, plain.range) / 100,
    );
  });

  it("defaults to off, so every existing caller and recorded fixture is unchanged", () => {
    // P7.16's 0-ULP device agreement and P7.17's recorded budgets were measured
    // against the plain accumulator. If the default flipped, they would all be
    // describing a march the device does not run.
    const base = {
      y0: DRAG_FREE.y0,
      h: DRAG_FREE.h,
      steps: DRAG_FREE.steps,
      params: DRAG_FREE.params,
      round: toF32,
    };
    const implicit = reducePlanarObservables(base);
    const explicitlyOff = reducePlanarObservables({ ...base, compensated: false });
    expect(implicit.range).toBe(explicitlyOff.range);
    expect(implicit.apexHeight).toBe(explicitlyOff.apexHeight);
    expect(implicit.apexT).toBe(explicitlyOff.apexT);
    expect(implicit.impactT).toBe(explicitlyOff.impactT);
  });
});
