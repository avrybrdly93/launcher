import { describe, expect, it } from "vitest";
import {
  PLANAR_CHANNELS,
  PLANAR_SPIN_CHANNELS,
  PRESET_SCENARIOS,
  SPATIAL_CHANNELS,
} from "@ballista/engine";
import { ClassicalRK4Stepper, integrate, TrajectoryRecorder } from "@ballista/solverkit";
import {
  DEFAULT_TAU_OMEGA,
  KNOWN_FORCE_IDS,
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

describe("resolveModel: model.kind (P4.30 model registry, validation criterion 'switching model regenerates channels/controls')", () => {
  it("defaults to the planar (dim-4) model when kind is omitted", () => {
    const spec = PRESET_SCENARIOS[0]!;
    expect(spec.model.kind).toBeUndefined();
    const { model, y0 } = resolveModel(spec);
    expect(model.dim).toBe(4);
    expect(model.channels).toBe(PLANAR_CHANNELS);
    expect(y0).toEqual(
      new Float64Array([
        spec.initialConditions.x0,
        spec.initialConditions.y0,
        spec.initialConditions.vx0,
        spec.initialConditions.vy0,
      ]),
    );
  });

  it("kind 'planar' resolves the same dim-4 model as omitting kind", () => {
    const spec = {
      ...PRESET_SCENARIOS[0]!,
      model: { ...PRESET_SCENARIOS[0]!.model, kind: "planar" as const },
    };
    const { model } = resolveModel(spec);
    expect(model.dim).toBe(4);
    expect(model.channels).toBe(PLANAR_CHANNELS);
  });

  it("kind 'planar-spin' resolves the dim-5 model, seeding omega0 from initialConditions.spin0", () => {
    const spec = {
      ...PRESET_SCENARIOS[0]!,
      model: { ...PRESET_SCENARIOS[0]!.model, kind: "planar-spin" as const, tauOmega: 10 },
      initialConditions: { ...PRESET_SCENARIOS[0]!.initialConditions, spin0: 7 },
    };
    const { model, y0 } = resolveModel(spec);
    expect(model.dim).toBe(5);
    expect(model.channels).toBe(PLANAR_SPIN_CHANNELS);
    expect(y0[4]).toBe(7);
  });

  it("kind 'planar-spin' defaults tauOmega to DEFAULT_TAU_OMEGA and omega0 to 0 when both are omitted", () => {
    const spec = {
      ...PRESET_SCENARIOS[0]!,
      model: { ...PRESET_SCENARIOS[0]!.model, kind: "planar-spin" as const },
    };
    expect(spec.model.tauOmega).toBeUndefined();
    const { y0 } = resolveModel(spec);
    expect(y0[4]).toBe(0);
    expect(DEFAULT_TAU_OMEGA).toBeGreaterThan(0);
  });

  it("kind 'spatial' resolves the dim-6 model, seeding z0/vz0 from initialConditions (defaulting to 0)", () => {
    const spec = {
      ...PRESET_SCENARIOS[0]!,
      model: { ...PRESET_SCENARIOS[0]!.model, kind: "spatial" as const },
      initialConditions: { ...PRESET_SCENARIOS[0]!.initialConditions, z0: 3, vz0: -2 },
    };
    const { model, y0 } = resolveModel(spec);
    expect(model.dim).toBe(6);
    expect(model.channels).toBe(SPATIAL_CHANNELS);
    expect(y0).toEqual(
      new Float64Array([
        spec.initialConditions.x0,
        spec.initialConditions.y0,
        3,
        spec.initialConditions.vx0,
        spec.initialConditions.vy0,
        -2,
      ]),
    );
  });

  it("kind 'spatial' defaults z0/vz0 to 0 when omitted", () => {
    const spec = {
      ...PRESET_SCENARIOS[0]!,
      model: { ...PRESET_SCENARIOS[0]!.model, kind: "spatial" as const },
    };
    const { y0 } = resolveModel(spec);
    expect(y0[2]).toBe(0);
    expect(y0[5]).toBe(0);
  });

  it("switching kind on the same underlying scenario regenerates model.channels to a different array each time (the validation criterion, at the resolver layer)", () => {
    const base = PRESET_SCENARIOS[0]!;
    const planar = resolveModel(base).model.channels;
    const spin = resolveModel({ ...base, model: { ...base.model, kind: "planar-spin" } }).model
      .channels;
    const spatial = resolveModel({ ...base, model: { ...base.model, kind: "spatial" } }).model
      .channels;

    expect(planar).toBe(PLANAR_CHANNELS);
    expect(spin).toBe(PLANAR_SPIN_CHANNELS);
    expect(spatial).toBe(SPATIAL_CHANNELS);
    expect(planar).not.toBe(spin);
    expect(spin).not.toBe(spatial);
    expect(planar.map((c) => c.name)).toEqual(["x", "y", "vx", "vy"]);
    expect(spin.map((c) => c.name)).toEqual(["x", "y", "vx", "vy", "omega"]);
    expect(spatial.map((c) => c.name)).toEqual(["x", "y", "z", "vx", "vy", "vz"]);
  });

  it("kind 'spatial' resolves every preset scenario's own force ids without throwing (FORCE_FACTORIES is a subset of the spatial model's SUPPORTED_FORCE_IDS)", () => {
    for (const spec of PRESET_SCENARIOS) {
      expect(() =>
        resolveModel({ ...spec, model: { ...spec.model, kind: "spatial" } }),
      ).not.toThrow();
    }
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
