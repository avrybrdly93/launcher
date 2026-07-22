import { describe, expect, it } from "vitest";
import { PRESET_SCENARIOS } from "@ballista/engine";
import { ClassicalRK4Stepper, integrate, TrajectoryRecorder } from "@ballista/solverkit";
import { resolveModel, resolveSolverConfig, resolveStepper } from "./scenario-resolver.js";

describe("resolveForce / resolveModel", () => {
  it("resolves every force id used across the preset library without throwing", () => {
    for (const spec of PRESET_SCENARIOS) {
      expect(() => resolveModel(spec)).not.toThrow();
    }
  });

  it("produces a model/ctx/y0 that actually integrates (drag-free reference vs the analytic parabola)", () => {
    const spec = PRESET_SCENARIOS[0]!; // drag-free reference
    const { model, ctx, y0 } = resolveModel(spec);
    const recorder = new TrajectoryRecorder();
    const report = integrate(
      model,
      ctx,
      y0,
      [0, 0.1],
      { stepper: "classical-rk4", h: 0.01, maxSteps: 1000 },
      new ClassicalRK4Stepper(),
      [recorder],
    );
    expect(report.status).toBe("ok");
  });

  it("throws a descriptive error for an unknown force id", () => {
    expect(() =>
      resolveModel({
        ...PRESET_SCENARIOS[0]!,
        model: { id: "planar-projectile", forceIds: ["not-a-real-force"] },
      }),
    ).toThrow(/not-a-real-force/);
  });
});

describe("resolveStepper", () => {
  it("resolves every v1 stepper id to a Stepper with a matching info.id", () => {
    const ids = [
      "explicit-euler",
      "midpoint-rk2",
      "heun-rk2",
      "classical-rk4",
      "bogacki-shampine-32",
      "dopri5",
    ];
    for (const id of ids) {
      expect(resolveStepper(id).info.id).toBeTruthy();
    }
  });

  it("resolves 'rk45' (every preset's nominal stepper) as an alias for dopri5", () => {
    expect(resolveStepper("rk45").info.id).toBe("dopri5");
  });

  it("every preset scenario's stepper id resolves", () => {
    for (const spec of PRESET_SCENARIOS) {
      expect(() => resolveStepper(spec.solver.stepper)).not.toThrow();
    }
  });

  it("throws a descriptive error for an unknown stepper id", () => {
    expect(() => resolveStepper("not-a-real-stepper")).toThrow(/not-a-real-stepper/);
  });
});

describe("resolveSolverConfig", () => {
  it("carries stepper/maxSteps through unchanged", () => {
    const spec = PRESET_SCENARIOS[0]!;
    const cfg = resolveSolverConfig(spec);
    expect(cfg.stepper).toBe(spec.solver.stepper);
    expect(cfg.maxSteps).toBe(spec.solver.maxSteps);
    expect(cfg.rtol).toBe(spec.solver.rtol);
    expect(cfg.controller).toBe(spec.solver.controller);
  });

  it("converts a plain-array atol to a Float64Array with the same values", () => {
    const spec = {
      ...PRESET_SCENARIOS[0]!,
      solver: { stepper: "classical-rk4", atol: [1e-6, 1e-6, 1e-8, 1e-8], maxSteps: 1000 },
    };
    const cfg = resolveSolverConfig(spec);
    expect(cfg.atol).toBeInstanceOf(Float64Array);
    expect(Array.from(cfg.atol as Float64Array)).toEqual([1e-6, 1e-6, 1e-8, 1e-8]);
  });

  it("omits optional fields the spec doesn't set, rather than passing them through as undefined", () => {
    const spec = { ...PRESET_SCENARIOS[0]!, solver: { stepper: "classical-rk4", maxSteps: 1000 } };
    const cfg = resolveSolverConfig(spec);
    expect("h" in cfg).toBe(false);
    expect("rtol" in cfg).toBe(false);
    expect("atol" in cfg).toBe(false);
    expect("controller" in cfg).toBe(false);
    expect("hMin" in cfg).toBe(false);
  });
});
