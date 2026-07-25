import { describe, expect, it } from "vitest";
import { degToRad, G_STD, PRESET_SCENARIOS, type ScenarioSpec } from "@ballista/engine";
import { runSweepPoint, runSweepRange, sweepPointCount, type SweepJob } from "./sweep-job.js";

const DRAG_FREE = PRESET_SCENARIOS.find((s) => s.model.forceIds.length === 1)!;

/** Ground-level (y0=0) drag-free base scenario -- lets every grid point be checked against the closed-form vacuum-projectile formulas. */
const GROUND_LEVEL_DRAG_FREE: ScenarioSpec = {
  ...DRAG_FREE,
  initialConditions: { ...DRAG_FREE.initialConditions, x0: 0, y0: 0 },
};

describe("sweepPointCount", () => {
  it("is thetaDegGrid.length * v0Grid.length", () => {
    const job: SweepJob = {
      baseScenario: GROUND_LEVEL_DRAG_FREE,
      thetaDegGrid: [10, 20, 30, 40, 50, 60, 70, 80, 90, 15, 25],
      v0Grid: [10, 20, 30, 40, 50, 60, 70, 80, 90, 15, 25],
    };
    expect(sweepPointCount(job)).toBe(121);
  });

  it("is 0 for an empty grid", () => {
    expect(
      sweepPointCount({ baseScenario: GROUND_LEVEL_DRAG_FREE, thetaDegGrid: [], v0Grid: [30] }),
    ).toBe(0);
  });
});

describe("runSweepPoint: matches the closed-form vacuum-projectile formulas (drag-free, y0=0)", () => {
  const job: SweepJob = {
    baseScenario: GROUND_LEVEL_DRAG_FREE,
    thetaDegGrid: [15, 30, 45, 60, 75],
    v0Grid: [10, 25, 40],
  };

  it("range matches v0^2 * sin(2*theta) / g and apex height matches (v0*sin(theta))^2 / (2*g)", () => {
    for (let thetaIndex = 0; thetaIndex < job.thetaDegGrid.length; thetaIndex++) {
      for (let v0Index = 0; v0Index < job.v0Grid.length; v0Index++) {
        const thetaDeg = job.thetaDegGrid[thetaIndex]!;
        const v0 = job.v0Grid[v0Index]!;
        const thetaRad = degToRad(thetaDeg);
        const expectedRange = (v0 * v0 * Math.sin(2 * thetaRad)) / G_STD;
        const expectedApex = (v0 * Math.sin(thetaRad)) ** 2 / (2 * G_STD);

        const point = runSweepPoint(job, thetaIndex * job.v0Grid.length + v0Index);

        expect(point.range).toBeCloseTo(expectedRange, 1);
        expect(point.apexHeight).toBeCloseTo(expectedApex, 1);
      }
    }
  });
});

describe("runSweepRange", () => {
  it("fills the chunk-local output arrays with the same values runSweepPoint computes at each absolute index", () => {
    const job: SweepJob = {
      baseScenario: GROUND_LEVEL_DRAG_FREE,
      thetaDegGrid: [20, 40, 60],
      v0Grid: [15, 30],
    };
    const startIndex = 2;
    const endIndex = 5;
    const range = new Float64Array(endIndex - startIndex);
    const apexHeight = new Float64Array(endIndex - startIndex);

    runSweepRange(job, startIndex, endIndex, range, apexHeight);

    for (let i = startIndex; i < endIndex; i++) {
      const expected = runSweepPoint(job, i);
      expect(range[i - startIndex]).toBe(expected.range);
      expect(apexHeight[i - startIndex]).toBe(expected.apexHeight);
    }
  });
});
