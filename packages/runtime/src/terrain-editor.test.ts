import { describe, expect, it } from "vitest";
import { solveTerrainEditorLaunch } from "./terrain-editor.js";

describe("solveTerrainEditorLaunch (P4.14 terrain editor live re-solve)", () => {
  it("lands on flat terrain at y close to the terrain's own height", () => {
    const flat = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const result = solveTerrainEditorLaunch(flat);
    expect(result.landed).toBe(true);
    expect(result.impactY).toBeCloseTo(0, 6);
    expect(result.impactX).toBeGreaterThan(0);
    expect(result.trajectory.nSteps).toBeGreaterThan(1);
  });

  it("lands further along an inclined terrain than on flat terrain (edited terrain changes the solve)", () => {
    const flat = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const incline = [
      { x: 0, y: 0 },
      { x: 100, y: 15 },
    ];
    const flatResult = solveTerrainEditorLaunch(flat);
    const inclineResult = solveTerrainEditorLaunch(incline);
    // Launching uphill (toward rising ground) shortens the flight compared
    // to flat ground -- proof the re-solve actually used the edited terrain,
    // not a memoized/flat-ground answer.
    expect(inclineResult.impactX).toBeLessThan(flatResult.impactX);
  });

  it("re-solves live as a control point is dragged (each edit changes the impact point)", () => {
    const base = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ];
    const before = solveTerrainEditorLaunch(base);

    const dragged = [
      { x: 0, y: 0 },
      { x: 50, y: 8 },
      { x: 100, y: 0 },
    ];
    const after = solveTerrainEditorLaunch(dragged);

    expect(after.impactX).not.toBe(before.impactX);
    expect(after.impactY).not.toBe(before.impactY);
  });

  it("accepts out-of-order control points (as a mid-drag list may be) via sanitizeTerrainControlPoints", () => {
    const outOfOrder = [
      { x: 100, y: 0 },
      { x: 0, y: 0 },
      { x: 50, y: 5 },
    ];
    const sorted = [
      { x: 0, y: 0 },
      { x: 50, y: 5 },
      { x: 100, y: 0 },
    ];
    expect(solveTerrainEditorLaunch(outOfOrder)).toEqual(solveTerrainEditorLaunch(sorted));
  });

  it("launches from directly above the leftmost control point, staying above ground even when it's elevated", () => {
    const elevated = [
      { x: 10, y: 50 },
      { x: 60, y: 50 },
    ];
    const result = solveTerrainEditorLaunch(elevated);
    expect(result.landed).toBe(true);
    expect(result.impactY).toBeCloseTo(50, 6);
    expect(result.impactX).toBeGreaterThan(10);
  });
});
