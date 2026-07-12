import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { composeEnergyPower, energyRate, mechanicalEnergy } from "./energy.js";

const RANDOM_STATES: [number, number, number, number][] = [
  [0, 0, 12.3, 4.1],
  [10, 5, -8.2, 15.6],
  [-3, 20, 25.0, -30.1],
  [0, 0.5, 3.001, -2.002],
  [100, 10, -1.5, -1.5],
  [0, 0, 40, 0],
  [0, 0, 0, 40],
  [5, 5, 5, 5],
  [-10, -10, -20, 20],
  [1, 1, 33.3, -12.7],
];

describe("energy invariant (P1.24, eq 3.19)", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const params = createSphericalProjectileParams({
    mass,
    radius,
    dragCoefficient: new ConstantCd(0.47),
  });
  const environment = new Environment(
    new ConstantAtmosphere(),
    new UniformGravity(),
    new ZeroWind(),
  );
  const ctx = createEvalContext(environment, params);

  it("mechanicalEnergy is (1/2)m|v|^2 + mgy exactly", () => {
    const y = new Float64Array([0, 12, 10, -5]);
    environment.sample(0, y[0]!, y[1]!, ctx.env);
    const e = mechanicalEnergy(y, ctx);
    const expected = 0.5 * mass * (10 * 10 + 5 * 5) + mass * ctx.env.g * 12;
    expect(e).toBeCloseTo(expected, 12);
  });

  it("drag-off: dE/dt computed from the per-force powers is 0 to 1e-13 (gravity-only)", () => {
    const forces = [new GravityForce()];
    for (const state of RANDOM_STATES) {
      const y = new Float64Array(state);
      environment.sample(0, y[0]!, y[1]!, ctx.env);
      expect(energyRate(forces, 0, y, ctx)).toBeCloseTo(0, 13);
    }
  });

  it("with drag on, dE/dt from powers equals the drag force's own power exactly (gravity's contribution cancels)", () => {
    const forces = [new GravityForce(), new QuadraticDragForce()];
    const drag = new QuadraticDragForce();
    for (const state of RANDOM_STATES) {
      const y = new Float64Array(state);
      environment.sample(0, y[0]!, y[1]!, ctx.env);
      ctx.vRel[0] = y[2]!;
      ctx.vRel[1] = y[3]!;
      ctx.speedRel = Math.hypot(y[2]!, y[3]!);
      ctx.re = (ctx.env.rho * ctx.speedRel * (2 * radius)) / ctx.env.eta;
      ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;

      const rate = energyRate(forces, 0, y, ctx);
      const dragPower = drag.energyPower!(0, y, ctx);
      expect(rate).toBeCloseTo(dragPower, 12);
      // Still air, drag only: energy strictly dissipates (or stays put at v_rel=0).
      expect(rate).toBeLessThanOrEqual(0);
    }
  });

  it("composeEnergyPower sums every registered force's energyPower", () => {
    const forces = [new GravityForce(), new QuadraticDragForce()];
    const y = new Float64Array([0, 5, 20, -10]);
    environment.sample(0, y[0]!, y[1]!, ctx.env);
    ctx.vRel[0] = y[2]!;
    ctx.vRel[1] = y[3]!;
    ctx.speedRel = Math.hypot(y[2]!, y[3]!);
    ctx.re = (ctx.env.rho * ctx.speedRel * (2 * radius)) / ctx.env.eta;
    ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;

    const total = composeEnergyPower(forces, 0, y, ctx);
    const expected = forces.reduce((sum, f) => sum + f.energyPower!(0, y, ctx), 0);
    expect(total).toBe(expected);
  });

  it("is wired onto createPlanarProjectileModel as the 'mechanical-energy' invariant", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    expect(model.invariants?.[0]?.name).toBe("mechanical-energy");

    const y = new Float64Array([0, 8, 15, -3]);
    const viaInvariant = model.invariants![0]!.evaluate(0, y, ctx);
    environment.sample(0, y[0]!, y[1]!, ctx.env);
    expect(viaInvariant).toBeCloseTo(mechanicalEnergy(y, ctx), 12);
  });
});
