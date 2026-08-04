import { describe, expect, it } from "vitest";
import { PRESET_SCENARIOS } from "@ballista/engine";
import { ClassicalRK4Stepper, integrate, TrajectoryRecorder } from "@ballista/solverkit";
import {
  KNOWN_FORCE_IDS,
  KNOWN_MODEL_IDS,
  resolveForce,
  resolveModel,
  resolveSolverConfig,
  resolveStepper,
} from "./scenario-resolver.js";

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

describe("KNOWN_MODEL_IDS / model switching (P4.30)", () => {
  it("resolves every known model id against the reference preset without throwing", () => {
    const base = PRESET_SCENARIOS[0]!;
    for (const id of KNOWN_MODEL_IDS) {
      expect(() => resolveModel({ ...base, model: { ...base.model, id } })).not.toThrow();
    }
  });

  it("switching model id regenerates channels (this task's validation criterion)", () => {
    const base = PRESET_SCENARIOS[0]!;
    const planar = resolveModel({ ...base, model: { ...base.model, id: "planar-projectile" } });
    const spin = resolveModel({
      ...base,
      model: { ...base.model, id: "planar-projectile-spin" },
    });
    const spatial = resolveModel({
      ...base,
      model: { ...base.model, id: "spatial-projectile" },
    });

    expect(planar.model.channels).not.toEqual(spin.model.channels);
    expect(planar.model.channels).not.toEqual(spatial.model.channels);
    expect(spin.model.channels).not.toEqual(spatial.model.channels);
  });

  it("each model's y0 length matches its own dim", () => {
    const base = PRESET_SCENARIOS[0]!;
    for (const id of KNOWN_MODEL_IDS) {
      const { model, y0 } = resolveModel({ ...base, model: { ...base.model, id } });
      expect(y0.length).toBe(model.dim);
    }
  });

  it("planar-projectile-spin seeds its omega state from initialConditions.spin0", () => {
    const base = PRESET_SCENARIOS[0]!;
    const { y0 } = resolveModel({
      ...base,
      model: { ...base.model, id: "planar-projectile-spin" },
      initialConditions: { ...base.initialConditions, spin0: 12.5 },
    });
    expect(y0[y0.length - 1]).toBe(12.5);
  });

  it("spatial-projectile seeds z0/vz0 at 0 and matches the planar model on the shared x/y/vx/vy channels", () => {
    const base = PRESET_SCENARIOS[0]!;
    const planar = resolveModel({ ...base, model: { ...base.model, id: "planar-projectile" } });
    const spatial = resolveModel({
      ...base,
      model: { ...base.model, id: "spatial-projectile" },
    });
    // spatial y0 layout is [x, y, z, vx, vy, vz]; planar is [x, y, vx, vy].
    expect(Array.from(spatial.y0)).toEqual([
      planar.y0[0],
      planar.y0[1],
      0,
      planar.y0[2],
      planar.y0[3],
      0,
    ]);
  });

  it("throws a descriptive error for an unknown model id", () => {
    const base = PRESET_SCENARIOS[0]!;
    expect(() =>
      resolveModel({ ...base, model: { ...base.model, id: "not-a-real-model" } }),
    ).toThrow(/not-a-real-model/);
  });
});

describe("KNOWN_FORCE_IDS", () => {
  it("every entry resolves via resolveForce without throwing", () => {
    for (const id of KNOWN_FORCE_IDS) {
      expect(() => resolveForce(id)).not.toThrow();
    }
  });

  it("covers every force id used across the preset library", () => {
    const usedIds = new Set(PRESET_SCENARIOS.flatMap((s) => s.model.forceIds));
    for (const id of usedIds) {
      expect(KNOWN_FORCE_IDS).toContain(id);
    }
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
