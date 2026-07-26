import { describe, expect, it } from "vitest";
import { runEnergyDriftStudy } from "./energy-drift-study.js";
import { DEFAULT_SCENARIO } from "./simulation-session.js";

const METHOD_IDS = ["explicit-euler", "classical-rk4", "semi-implicit-euler", "velocity-verlet"];

describe("runEnergyDriftStudy (P3.44)", () => {
  it("produces one trace per flagship method, each a genuine pinned run with a finite E(t)/E(0)-1 series starting at 0", () => {
    const study = runEnergyDriftStudy();

    expect(study.tFinal).toBeGreaterThan(0);
    expect(study.methods).toHaveLength(4);
    expect(study.methods.map((m) => m.stepperId)).toEqual(METHOD_IDS);

    for (const method of study.methods) {
      expect(method.t.length).toBeGreaterThan(1);
      expect(method.relativeEnergyError.length).toBe(method.t.length);
      expect(method.t[0]).toBe(0);
      // First recorded row is the initial condition itself, so its
      // relative error against E(0) is exactly 0 -- not just "small".
      expect(method.relativeEnergyError[0]).toBe(0);
      expect(method.t.at(-1)!).toBeCloseTo(study.tFinal, 6);

      for (let i = 0; i < method.relativeEnergyError.length; i++) {
        expect(Number.isFinite(method.relativeEnergyError[i]!)).toBe(true);
      }
    }
  });

  it("holds every method to the same fixed rhs-evaluation budget (§4.8's 'equal RHS evaluations')", () => {
    const study = runEnergyDriftStudy();
    const rhsCounts = study.methods.map((m) => m.nRHS);

    // Fixed-step, no rejections: nRHS is exactly nSteps * rhsPerStep for
    // every method, so all four land on the same total by construction.
    expect(new Set(rhsCounts).size).toBe(1);
    expect(rhsCounts[0]).toBeGreaterThan(0);
  });

  it("flags the geometric methods (and only those) as symplectic", () => {
    const study = runEnergyDriftStudy();
    const symplecticIds = study.methods.filter((m) => m.symplectic).map((m) => m.stepperId);
    expect(symplecticIds).toEqual(["semi-implicit-euler", "velocity-verlet"]);
  });

  it("defaults to DEFAULT_SCENARIO (gravity-only) when no scenario is passed", () => {
    const withDefault = runEnergyDriftStudy();
    const explicit = runEnergyDriftStudy(DEFAULT_SCENARIO);
    expect(withDefault.tFinal).toBe(explicit.tFinal);
  });

  it("velocity Verlet stays far closer to exact energy conservation than explicit Euler on this constant-gravity exhibit", () => {
    // Constant acceleration means velocity Verlet's discrete recurrence
    // reproduces the closed-form quadratic trajectory exactly, so its
    // drift is essentially floating-point noise, while explicit Euler's
    // is a real O(h) per-step energy error that accumulates secularly.
    const study = runEnergyDriftStudy();
    const euler = study.methods.find((m) => m.stepperId === "explicit-euler")!;
    const verlet = study.methods.find((m) => m.stepperId === "velocity-verlet")!;

    const maxAbs = (arr: Float64Array) => Math.max(...Array.from(arr, Math.abs));
    expect(maxAbs(verlet.relativeEnergyError)).toBeLessThan(
      maxAbs(euler.relativeEnergyError) / 100,
    );
  });
});
