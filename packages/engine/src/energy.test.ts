import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { aeroPower, mechanicalEnergy } from "./energy.js";

function makeCtx(spin = 0) {
  const mass = 0.145;
  const radius = 0.0366;
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass,
    radius,
    dragCoefficient: new ConstantCd(0.47),
    liftCoefficient: new SaturatingLiftCoefficient(),
    spin,
  });
  return { ctx: createEvalContext(env, params), mass };
}

describe("mechanicalEnergy", () => {
  it("computes E = 0.5*m*|v|^2 + m*g*y", () => {
    const { ctx, mass } = makeCtx();
    const y = new Float64Array([3, 10, 6, -8]);
    const e = mechanicalEnergy(0, y, ctx);
    const expected = 0.5 * mass * (6 * 6 + 8 * 8) + mass * ctx.env.g * 10;
    expect(e).toBeCloseTo(expected, 12);
  });
});

describe("createEnergyInvariant", () => {
  it("wires into Model.invariants and matches mechanicalEnergy directly", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    expect(model.invariants?.[0]?.name).toBe("energy");

    const { ctx } = makeCtx();
    const y = new Float64Array([0, 50, 15, -3]);
    expect(model.invariants?.[0]?.evaluate(0, y, ctx)).toBeCloseTo(mechanicalEnergy(0, y, ctx), 14);
  });
});

describe("aeroPower", () => {
  const STATES: [number, number, number, number][] = [
    [0, 0, 12.3, 4.1],
    [10, 5, -8.2, 15.6],
    [-3, 20, 25.0, -30.1],
    [100, 10, -1.5, -1.5],
    [0, 0, 40, 0],
    [5, 5, 5, 5],
  ];

  // aeroPower reads ctx.vRel/speedRel/re/mach, which are only populated by a
  // prior rhs() call (the same convention Force.accumulate/energyPower rely
  // on elsewhere) -- so every case below runs rhs() first to prime ctx.
  it("drag-off: with only gravity+Magnus, dE/dt from powers is exactly 0 to 1e-13 (F_M perp v)", () => {
    const { ctx } = makeCtx(180);
    const forces = [new GravityForce(), new MagnusForce()];
    const model = createPlanarProjectileModel(forces);
    const out = new Float64Array(4);

    for (const state of STATES) {
      const y = new Float64Array(state);
      model.rhs(0, y, out, ctx);
      expect(aeroPower(forces, 0, y, ctx)).toBeCloseTo(0, 13);
    }
  });

  it("excludes gravity's own power from the sum", () => {
    const { ctx } = makeCtx();
    const forces = [new GravityForce()];
    const model = createPlanarProjectileModel(forces);
    const y = new Float64Array([0, 10, 5, -5]);
    model.rhs(0, y, new Float64Array(4), ctx);
    expect(aeroPower(forces, 0, y, ctx)).toBe(0);
  });

  it("with drag on, aero power is the (generally nonzero) dissipative work-rate F_d.v", () => {
    const { ctx } = makeCtx();
    const forces = [new GravityForce(), new QuadraticDragForce()];
    const model = createPlanarProjectileModel(forces);
    const y = new Float64Array([0, 10, 20, -5]);
    model.rhs(0, y, new Float64Array(4), ctx);
    const power = aeroPower(forces, 0, y, ctx);
    expect(power).toBeLessThan(0); // drag dissipates in still air
  });
});
