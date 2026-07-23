import { describe, expect, it } from "vitest";
import type { SolverConfigSpec } from "@ballista/engine";
import {
  adaptivePanelValues,
  fixedPanelValues,
  solverGroupFor,
  SOLVER_STEPPER_OPTIONS,
  toSolverConfigForStepper,
} from "./solver-panel-logic.js";

describe("solverGroupFor", () => {
  it("classifies every fixed stepper", () => {
    for (const id of ["explicit-euler", "midpoint-rk2", "heun-rk2", "classical-rk4"]) {
      expect(solverGroupFor(id)).toBe("fixed");
    }
  });

  it("classifies every adaptive stepper", () => {
    for (const id of ["bogacki-shampine-32", "dopri5"]) {
      expect(solverGroupFor(id)).toBe("adaptive");
    }
  });

  it("returns undefined for an id this panel doesn't offer", () => {
    expect(solverGroupFor("verlet")).toBeUndefined();
    expect(solverGroupFor("not-a-real-stepper")).toBeUndefined();
  });

  it("every offered option is classified as exactly one of fixed/adaptive", () => {
    for (const option of SOLVER_STEPPER_OPTIONS) {
      expect(["fixed", "adaptive"]).toContain(option.group);
    }
  });
});

describe("fixedPanelValues / adaptivePanelValues", () => {
  it("fixedPanelValues defaults h when unset", () => {
    expect(fixedPanelValues({ stepper: "classical-rk4", maxSteps: 1000 }).h).toBeGreaterThan(0);
  });

  it("fixedPanelValues passes through an explicit h", () => {
    expect(fixedPanelValues({ stepper: "classical-rk4", h: 0.02, maxSteps: 1000 }).h).toBe(0.02);
  });

  it("adaptivePanelValues defaults rtol/atol/controller when unset", () => {
    const values = adaptivePanelValues({ stepper: "dopri5", maxSteps: 1000 });
    expect(values.rtol).toBeGreaterThan(0);
    expect(values.atol).toBeGreaterThan(0);
    expect(values.controller).toBe("I");
  });

  it("adaptivePanelValues passes through explicit scalar values", () => {
    const values = adaptivePanelValues({
      stepper: "dopri5",
      rtol: 1e-8,
      atol: 1e-10,
      controller: "PI",
      maxSteps: 1000,
    });
    expect(values).toEqual({ rtol: 1e-8, atol: 1e-10, controller: "PI" });
  });

  it("adaptivePanelValues reduces a per-channel atol array to a representative scalar", () => {
    const values = adaptivePanelValues({
      stepper: "dopri5",
      atol: [1e-6, 1e-8, 1e-8, 1e-8],
      maxSteps: 1000,
    });
    expect(values.atol).toBe(1e-6);
  });
});

describe("toSolverConfigForStepper: invalid combos (h with adaptive) prevented by schema (P3.23 validation criterion)", () => {
  it("same-group switch (fixed -> fixed) keeps h, only swaps the stepper id", () => {
    const current: SolverConfigSpec = { stepper: "explicit-euler", h: 0.02, maxSteps: 1000 };
    const next = toSolverConfigForStepper("classical-rk4", current);
    expect(next).toEqual({ stepper: "classical-rk4", h: 0.02, maxSteps: 1000 });
  });

  it("same-group switch (adaptive -> adaptive) keeps rtol/atol/controller", () => {
    const current: SolverConfigSpec = {
      stepper: "bogacki-shampine-32",
      rtol: 1e-7,
      atol: 1e-9,
      controller: "PI",
      maxSteps: 1000,
    };
    const next = toSolverConfigForStepper("dopri5", current);
    expect(next).toEqual({
      stepper: "dopri5",
      rtol: 1e-7,
      atol: 1e-9,
      controller: "PI",
      maxSteps: 1000,
    });
  });

  it("switching fixed -> adaptive drops h and seeds rtol/atol/controller -- never both present", () => {
    const current: SolverConfigSpec = { stepper: "explicit-euler", h: 0.02, maxSteps: 1000 };
    const next = toSolverConfigForStepper("dopri5", current);

    expect("h" in next).toBe(false);
    expect(next.rtol).toBeGreaterThan(0);
    expect(next.atol).toBeGreaterThan(0);
    expect(next.controller).toBe("I");
    expect(next.stepper).toBe("dopri5");
  });

  it("switching adaptive -> fixed drops rtol/atol/controller and seeds h -- never both present", () => {
    const current: SolverConfigSpec = {
      stepper: "dopri5",
      rtol: 1e-7,
      atol: 1e-9,
      controller: "PI",
      maxSteps: 1000,
    };
    const next = toSolverConfigForStepper("classical-rk4", current);

    expect("rtol" in next).toBe(false);
    expect("atol" in next).toBe(false);
    expect("controller" in next).toBe(false);
    expect(next.h).toBeGreaterThan(0);
    expect(next.stepper).toBe("classical-rk4");
  });

  it("maxSteps/hMin carry through unchanged across a group switch", () => {
    const current: SolverConfigSpec = {
      stepper: "explicit-euler",
      h: 0.02,
      maxSteps: 5000,
      hMin: 1e-8,
    };
    const next = toSolverConfigForStepper("dopri5", current);
    expect(next.maxSteps).toBe(5000);
    expect(next.hMin).toBe(1e-8);
  });
});
