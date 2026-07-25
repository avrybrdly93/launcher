import { PRESET_SCENARIOS } from "@ballista/engine";
import { describe, expect, it } from "vitest";
import { runSolverLabComparison, SOLVER_LAB_COLUMN_STEPPERS } from "./solver-lab.js";

/** Table-tennis ball: high-Π (drag-dominated) preset, so method error differences are pronounced at a moderate h. */
const TABLE_TENNIS = PRESET_SCENARIOS.find((s) => s.projectile.id === "table-tennis-ball")!;

describe("runSolverLabComparison (P3.41)", () => {
  it("produces one column per SOLVER_LAB_COLUMN_STEPPERS entry, each with a finite error vs the reference", () => {
    const comparison = runSolverLabComparison(TABLE_TENNIS, 0.02);

    expect(comparison.referenceStepperId).toBe("dopri5");
    expect(comparison.columns).toHaveLength(SOLVER_LAB_COLUMN_STEPPERS.length);
    expect(comparison.columns.map((c) => c.stepperId)).toEqual(
      SOLVER_LAB_COLUMN_STEPPERS.map((s) => s.id),
    );

    for (const column of comparison.columns) {
      expect(column.status).toBe("ok");
      expect(column.h).toBe(0.02);
      expect(Number.isFinite(column.errorVsReference)).toBe(true);
      expect(column.errorVsReference).toBeGreaterThanOrEqual(0);
      expect(column.nSteps).toBeGreaterThan(0);
      expect(column.nRHS).toBeGreaterThan(0);
    }
  });

  it("orders global error by method order at a moderate step size (Euler worst, DOPRI5 best -- the pedagogical point of the exhibit)", () => {
    const comparison = runSolverLabComparison(TABLE_TENNIS, 0.02);
    const [euler, rk4, dopri5] = comparison.columns;

    expect(euler!.errorVsReference).toBeGreaterThan(rk4!.errorVsReference);
    expect(rk4!.errorVsReference).toBeGreaterThan(dopri5!.errorVsReference);
  });

  it("shrinking h shrinks every column's error vs the reference", () => {
    const coarse = runSolverLabComparison(TABLE_TENNIS, 0.04);
    const fine = runSolverLabComparison(TABLE_TENNIS, 0.005);

    for (let i = 0; i < coarse.columns.length; i++) {
      expect(fine.columns[i]!.errorVsReference).toBeLessThan(coarse.columns[i]!.errorVsReference);
    }
  });

  it("defaults h to the scenario's own configured h when not passed explicitly", () => {
    const scenario = { ...TABLE_TENNIS, solver: { ...TABLE_TENNIS.solver, h: 0.03 } };
    const comparison = runSolverLabComparison(scenario);
    expect(comparison.h).toBe(0.03);
    for (const column of comparison.columns) {
      expect(column.h).toBe(0.03);
    }
  });
});
