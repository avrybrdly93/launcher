import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileSpinModel } from "./planar-projectile-spin-model.js";

/**
 * Self-contained fixed-step RK4 over `model.rhs` (no solverkit import: L0
 * `engine` may not depend on L1 `solverkit`, even in tests, per
 * `.dependency-cruiser.cjs`). Good enough to hit the 1e-10 validation bound
 * for a smooth exponential decay over a short horizon.
 */
function integrateRk4(
  model: ReturnType<typeof createPlanarProjectileSpinModel>,
  y0: Float64Array,
  ctx: ReturnType<typeof createEvalContext>,
  h: number,
  nSteps: number,
): Float64Array {
  const dim = model.dim;
  let y = Float64Array.from(y0);
  const k1 = new Float64Array(dim);
  const k2 = new Float64Array(dim);
  const k3 = new Float64Array(dim);
  const k4 = new Float64Array(dim);
  const tmp = new Float64Array(dim);
  let t = 0;

  for (let step = 0; step < nSteps; step++) {
    model.rhs(t, y, k1, ctx);
    for (let i = 0; i < dim; i++) tmp[i] = y[i]! + (h / 2) * k1[i]!;
    model.rhs(t + h / 2, tmp, k2, ctx);
    for (let i = 0; i < dim; i++) tmp[i] = y[i]! + (h / 2) * k2[i]!;
    model.rhs(t + h / 2, tmp, k3, ctx);
    for (let i = 0; i < dim; i++) tmp[i] = y[i]! + h * k3[i]!;
    model.rhs(t + h, tmp, k4, ctx);

    const next = new Float64Array(dim);
    for (let i = 0; i < dim; i++) {
      next[i] = y[i]! + (h / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
    }
    y = next;
    t += h;
  }
  return y;
}

function buildContext(withMagnus: boolean) {
  const mass = 0.0459;
  const radius = 0.02134;
  const forces = withMagnus
    ? [new GravityForce(), new QuadraticDragForce(), new MagnusForce()]
    : [];
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass,
    radius,
    dragCoefficient: new ConstantCd(0.25),
    liftCoefficient: withMagnus ? new SaturatingLiftCoefficient() : undefined,
  });
  const ctx = createEvalContext(env, params);
  return { forces, ctx };
}

describe("createPlanarProjectileSpinModel", () => {
  it("declares dim=5 with the expected channels, ending in omega", () => {
    const { forces } = buildContext(false);
    const model = createPlanarProjectileSpinModel(forces, 25);
    expect(model.dim).toBe(5);
    expect(model.channels.map((c) => c.name)).toEqual(["x", "y", "vx", "vy", "omega"]);
  });

  it("rejects a non-positive tauOmega", () => {
    const { forces } = buildContext(false);
    expect(() => createPlanarProjectileSpinModel(forces, 0)).toThrow();
    expect(() => createPlanarProjectileSpinModel(forces, -1)).toThrow();
  });

  it("P4.07 validation: omega(t) = omega0*e^(-t/tau) to 1e-10 (no aero forces, isolates the decay ODE)", () => {
    const { forces, ctx } = buildContext(false);
    const tau = 25; // s (golf-ball spinDecayTime asset value)
    const model = createPlanarProjectileSpinModel(forces, tau);
    const omega0 = 300; // rad/s

    const h = 0.001;
    const nSteps = 2000; // t_final = 2s
    const y0 = new Float64Array([0, 100, 20, 0, omega0]);
    const yFinal = integrateRk4(model, y0, ctx, h, nSteps);

    const tFinal = h * nSteps;
    const expected = omega0 * Math.exp(-tFinal / tau);
    expect(Math.abs(yFinal[4]! - expected) / expected).toBeLessThan(1e-10);
  });

  it("decay is independent of aero forces being wired: adding gravity/drag/Magnus doesn't change omega(t)", () => {
    const { forces, ctx } = buildContext(true);
    const tau = 25;
    const model = createPlanarProjectileSpinModel(forces, tau);
    const omega0 = 300;

    const h = 0.001;
    const nSteps = 500; // t_final = 0.5s
    const y0 = new Float64Array([0, 100, 20, 0, omega0]);
    const yFinal = integrateRk4(model, y0, ctx, h, nSteps);

    const tFinal = h * nSteps;
    const expected = omega0 * Math.exp(-tFinal / tau);
    expect(Math.abs(yFinal[4]! - expected) / expected).toBeLessThan(1e-9);
  });

  it("wires a live, decaying Magnus force: F_M shrinks in step with omega rather than staying at its initial value", () => {
    const { forces, ctx } = buildContext(true);
    const tau = 5; // fast decay to make the effect visible over a short horizon
    const model = createPlanarProjectileSpinModel(forces, tau);
    const omega0 = 300;

    const out0 = new Float64Array(5);
    model.rhs(0, new Float64Array([0, 100, 20, 0, omega0]), out0, ctx);
    const vyAccelAtFullSpin = out0[3]!;

    const out1 = new Float64Array(5);
    // Same kinematic state, decayed spin -- as if time had passed.
    model.rhs(0, new Float64Array([0, 100, 20, 0, omega0 * Math.exp(-1)]), out1, ctx);
    const vyAccelAtDecayedSpin = out1[3]!;

    // Magnus lift on a rightward-moving, backspinning ball adds +vy accel;
    // less spin -> less lift -> smaller (or more negative, once drag/gravity
    // dominate) vy acceleration.
    expect(vyAccelAtDecayedSpin).toBeLessThan(vyAccelAtFullSpin);
  });

  it("declares partitions q=[x,y], p=[vx,vy], leaving omega outside the partition (P4.10 prerequisite)", () => {
    const { forces } = buildContext(false);
    const model = createPlanarProjectileSpinModel(forces, 25);
    expect(model.partitions).toEqual({ q: [0, 1], p: [2, 3] });
  });

  it("carries ground-impact and apex events like the dim-4 model", () => {
    const { forces } = buildContext(false);
    const model = createPlanarProjectileSpinModel(forces, 25);
    expect(model.events?.map((e) => e.name).sort()).toEqual(["apex", "ground-impact"]);
  });
});
