import { describe, expect, it } from "vitest";

import {
  apex,
  hermiteStationaryPoint,
  hermiteValue,
  range as analysisRange,
  PLANAR_LAYOUT,
} from "@ballista/analysis";
import { identity, toF32, type PlanarDragParams, type Trajectory } from "@ballista/solverkit";

import {
  hermiteStationaryThetaAt,
  hermiteValueAt,
  PlanarObservableReducer,
  reducePlanarObservables,
} from "./planar-observables-reduction.js";

/**
 * Drag-free parameters. `cd = 0` kills the drag term exactly -- the factor
 * multiplies to zero rather than to something small -- leaving $\ddot y = -g$,
 * the case with closed forms for both observables and the case where the
 * Hermite refinement is exact to roundoff rather than merely third order.
 */
const DRAG_FREE: PlanarDragParams = {
  mass: 1,
  area: 0.01,
  cd: 0,
  rho: 1.225,
  g: 9.81,
  windX: 0,
  windY: 0,
};

const WITH_DRAG: PlanarDragParams = { ...DRAG_FREE, cd: 0.47 };

function launchState(speed: number, degrees: number): number[] {
  const theta = (degrees * Math.PI) / 180;
  return [0, 0, speed * Math.cos(theta), speed * Math.sin(theta)];
}

/**
 * A trajectory whose rows are the drag-free arc sampled on a fixed grid.
 *
 * Built in closed form rather than marched, because these tests compare the
 * reduction against `@ballista/analysis`'s observables **over the same rows**:
 * what is under test is the reduction, so the rows only need to be a projectile
 * arc, and using the exact one keeps the analysis side's own error out of the
 * comparison.
 */
function closedFormArc(
  y0: readonly number[],
  h: number,
  steps: number,
  g: number,
): { readonly trajectory: Trajectory; readonly rows: readonly (readonly number[])[] } {
  const t: number[] = [0];
  const x: number[] = [y0[0]!];
  const y: number[] = [y0[1]!];
  const vx: number[] = [y0[2]!];
  const vy: number[] = [y0[3]!];
  for (let n = 1; n <= steps; n++) {
    const tn = n * h;
    t.push(tn);
    x.push(y0[0]! + y0[2]! * tn);
    y.push(y0[1]! + y0[3]! * tn - 0.5 * g * tn * tn);
    vx.push(y0[2]!);
    vy.push(y0[3]! - g * tn);
  }
  const trajectory = {
    t: Float64Array.from(t),
    channels: [
      Float64Array.from(x),
      Float64Array.from(y),
      Float64Array.from(vx),
      Float64Array.from(vy),
    ],
    nSteps: t.length,
  } as unknown as Trajectory;
  const rows = t.map((_, i) => [x[i]!, y[i]!, vx[i]!, vy[i]!]);
  return { trajectory, rows };
}

/** Drives the reducer over prebuilt rows, the way the shader sees its own march. */
function reduceRows(rows: readonly (readonly number[])[], times: Float64Array) {
  const reducer = new PlanarObservableReducer(rows[0]!, times[0]!, identity);
  for (let row = 1; row < rows.length; row++) reducer.step(times[row]!, rows[row]!);
  return reducer.finish();
}

describe("the rounded helpers are the analysis helpers at another precision", () => {
  // Fixed brackets chosen to include the shapes the sign-stable quadratic form
  // exists for: a near-zero `a` (nearly-linear derivative), an exactly zero `a`,
  // and brackets with no interior stationary point at all.
  const CASES: ReadonlyArray<readonly [number, number, number, number, number]> = [
    [0, 12.5, 1.2, -3.4, 0.1],
    [100, -0.5, 99.9, -0.51, 0.001],
    [5, 0, 5, 0, 0.25],
    [1, 1, 2, 1, 1],
    [-3.25, 7.5, 0.5, -7.5, 0.5],
    [1e-6, 1e-3, 2e-6, -1e-3, 1e-4],
    [0, 1, 1, 1, 1],
  ];

  it("reproduces hermiteValue exactly at f64", () => {
    for (const [y0, d0, y1, d1, h] of CASES) {
      for (const theta of [0, 0.25, 1 / 3, 0.5, 0.75, 1]) {
        expect(hermiteValueAt(y0, d0, y1, d1, h, theta, identity)).toBe(
          hermiteValue(y0, d0, y1, d1, h, theta),
        );
      }
    }
  });

  it("reproduces hermiteStationaryPoint exactly at f64, including its absences", () => {
    for (const [y0, d0, y1, d1, h] of CASES) {
      const reference = hermiteStationaryPoint(y0, d0, y1, d1, h);
      const mine = hermiteStationaryThetaAt(y0, d0, y1, d1, h, identity);
      if (reference === undefined) {
        expect(mine.valid).toBe(false);
      } else {
        expect(mine.valid).toBe(true);
        expect(mine.theta).toBe(reference);
      }
    }
  });

  it("covers both sides of the valid/invalid split, so the test above is not vacuous", () => {
    const verdicts = CASES.map(
      ([y0, d0, y1, d1, h]) => hermiteStationaryPoint(y0, d0, y1, d1, h) !== undefined,
    );
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });

  it("actually rounds when asked, so the precision knob is not decorative", () => {
    // 1/3 is not representable in binary32, so the two evaluations must differ.
    const f64 = hermiteValueAt(0, 1 / 3, 1, 1 / 3, 1 / 3, 1 / 3, identity);
    const f32 = hermiteValueAt(0, 1 / 3, 1, 1 / 3, 1 / 3, 1 / 3, toF32);
    expect(f32).not.toBe(f64);
    expect(f32).toBe(Math.fround(f32));
    expect(f32).toBeCloseTo(f64, 6);
  });
});

describe("the drag-free flight matches its closed form", () => {
  const H = 1e-4;
  const SPEED = 80;

  for (const degrees of [15, 30, 45, 60, 75]) {
    it(`recovers apex height, apex time, range and impact time at ${degrees} degrees`, () => {
      const y0 = launchState(SPEED, degrees);
      const vy0 = y0[3]!;
      const expectedApex = (vy0 * vy0) / (2 * DRAG_FREE.g);
      const expectedRange = (SPEED * SPEED * Math.sin((2 * degrees * Math.PI) / 180)) / DRAG_FREE.g;
      // Integrate comfortably past impact so the crossing is inside the span.
      const steps = Math.ceil((2.5 * vy0) / DRAG_FREE.g / H);

      const observed = reducePlanarObservables({
        y0,
        h: H,
        steps,
        params: DRAG_FREE,
        round: identity,
      });

      expect(observed.impacted).toBe(true);
      expect(observed.apexHeight).toBeCloseTo(expectedApex, 6);
      expect(observed.apexT).toBeCloseTo(vy0 / DRAG_FREE.g, 6);
      expect(observed.range).toBeCloseTo(expectedRange, 5);
      expect(observed.impactT).toBeCloseTo((2 * vy0) / DRAG_FREE.g, 6);
    });
  }

  it("beats the nearest recorded row by orders of magnitude, which is what the refinement buys", () => {
    const y0 = launchState(SPEED, 45);
    const vy0 = y0[3]!;
    const expectedApex = (vy0 * vy0) / (2 * DRAG_FREE.g);
    // Coarse enough that a row-wise maximum is visibly wrong.
    const h = 0.05;
    const steps = Math.ceil((2.5 * vy0) / DRAG_FREE.g / h);
    const { trajectory, rows } = closedFormArc(y0, h, steps, DRAG_FREE.g);

    const refined = reduceRows(rows, trajectory.t);

    // The best recorded row, which is what an unrefined scan would report.
    let rowMax = -Infinity;
    for (const row of rows) rowMax = Math.max(rowMax, row[1]!);

    const refinedError = Math.abs(refined.apexHeight - expectedApex);
    const rowError = Math.abs(rowMax - expectedApex);
    expect(rowError).toBeGreaterThan(1e-3);
    expect(refinedError).toBeLessThan(1e-9);
    expect(refinedError).toBeLessThan(rowError);
  });
});

describe("the reduction agrees with the analysis observables it stands in for", () => {
  it("finds the same apex as analysis's apex() over the same rows", () => {
    const y0 = launchState(80, 40);
    const h = 0.01;
    const steps = Math.ceil((2 * y0[3]!) / DRAG_FREE.g / h);
    const { trajectory, rows } = closedFormArc(y0, h, steps, DRAG_FREE.g);

    const fromAnalysis = apex(trajectory, PLANAR_LAYOUT);
    const mine = reduceRows(rows, trajectory.t);

    expect(mine.apexHeight).toBeCloseTo(fromAnalysis.height, 12);
    expect(mine.apexT).toBeCloseTo(fromAnalysis.t, 12);
  });

  it("measures range to the captured crossing, which is what event localization gives analysis's range()", () => {
    const y0 = launchState(80, 40);
    const h = 0.01;
    // Deliberately marched 20 steps past the ground: the GPU kernel cannot stop
    // on an event, so the final row is not the impact row and `range()` read
    // over these rows is wrong by exactly that overshoot.
    const steps = Math.ceil((2 * y0[3]!) / DRAG_FREE.g / h) + 20;
    const { trajectory, rows } = closedFormArc(y0, h, steps, DRAG_FREE.g);

    const mine = reduceRows(rows, trajectory.t);
    const closedForm = (80 * 80 * Math.sin((2 * 40 * Math.PI) / 180)) / DRAG_FREE.g;

    expect(mine.impacted).toBe(true);
    expect(mine.range).toBeCloseTo(closedForm, 8);

    const fromAnalysis = analysisRange(trajectory, PLANAR_LAYOUT);
    expect(Math.abs(fromAnalysis - closedForm)).toBeGreaterThan(Math.abs(mine.range - closedForm));
  });
});

describe("the flights with no impact, and the apex that is an endpoint", () => {
  it("reports impacted=false and a zero range for a flight cut off while climbing", () => {
    const observed = reducePlanarObservables({
      y0: launchState(80, 60),
      h: 1e-3,
      steps: 100, // 0.1 s in: still climbing
      params: DRAG_FREE,
      round: identity,
    });
    expect(observed.impacted).toBe(false);
    expect(observed.range).toBe(0);
    expect(observed.impactT).toBe(0);
    // With no interior crossing the apex is the final row, not "nothing".
    expect(observed.apexT).toBeCloseTo(0.1, 9);
    expect(observed.apexHeight).toBeGreaterThan(0);
  });

  it("reports the launch point as the apex of a downward launch", () => {
    const observed = reducePlanarObservables({
      y0: [0, 50, 40, -5],
      h: 1e-3,
      steps: 500,
      params: DRAG_FREE,
      round: identity,
    });
    expect(observed.apexT).toBe(0);
    expect(observed.apexHeight).toBe(50);
  });
});

describe("f32 tracks f64, which is the assumption the GPU gate rests on", () => {
  const y0 = launchState(80, 45);
  const H = 1e-3;
  const STEPS = 12000;

  for (const [name, params] of [
    ["drag-free", DRAG_FREE],
    ["with drag", WITH_DRAG],
  ] as const) {
    it(`tracks the f64 reduction on the ${name} flight`, () => {
      const f64 = reducePlanarObservables({ y0, h: H, steps: STEPS, params, round: identity });
      const f32 = reducePlanarObservables({ y0, h: H, steps: STEPS, params, round: toF32 });

      expect(f64.impacted).toBe(true);
      expect(f32.impacted).toBe(true);
      // A relative gate is the wrong instrument near a zero crossing; apex
      // height and range are both O(100) on this flight and nowhere near zero,
      // so it is safe on these two quantities specifically.
      expect(Math.abs(f32.range - f64.range) / f64.range).toBeLessThan(1e-4);
      expect(Math.abs(f32.apexHeight - f64.apexHeight) / f64.apexHeight).toBeLessThan(1e-4);
    });
  }
});
