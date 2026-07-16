import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { mechanicalEnergy } from "./energy.js";

const STATES: [number, number, number, number][] = [
  [0, 0, 12.3, 4.1],
  [10, 5, -8.2, 15.6],
  [-3, 20, 25.0, -30.1],
  [0, 0.5, 0.001, -0.002],
  [100, 10, -1.5, -1.5],
  [0, 0, 40, 0],
  [0, 0, 0, 40],
  [5, 5, 5, 5],
  [-10, -10, -20, 20],
  [1, 1, 33.3, -12.7],
];

describe("mechanicalEnergy", () => {
  it("is (1/2)m|v|^2 + mgy", () => {
    const environment = new Environment(new ConstantAtmosphere(), new UniformGravity());
    const params = createSphericalProjectileParams({
      mass: 2,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(environment, params);
    environment.sample(0, 0, 100, ctx.env);

    const y = new Float64Array([0, 100, 3, 4]);
    const expected = 0.5 * 2 * (3 * 3 + 4 * 4) + 2 * ctx.env.g * 100;
    expect(mechanicalEnergy(y, ctx)).toBeCloseTo(expected, 12);
  });
});

describe("Model.invariants: energy / energyPower wiring (P1.24, eq. 3.19)", () => {
  it("drag-off (gravity + Magnus): energyPower is exactly 0 to 1e-13 at 10 states", () => {
    const mass = 0.145;
    const radius = 0.0366;
    const spin = 180;
    const cl = new SaturatingLiftCoefficient();

    const model = createPlanarProjectileModel([new GravityForce(), new MagnusForce()]);
    const environment = new Environment(
      new ConstantAtmosphere(),
      new UniformGravity(),
      new ZeroWind(),
    );
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0),
      liftCoefficient: cl,
      spin,
    });
    const ctx = createEvalContext(environment, params);
    const energyPowerInvariant = model.invariants!.find((inv) => inv.name === "energyPower")!;

    for (const state of STATES) {
      const y = new Float64Array(state);
      const out = new Float64Array(4);
      model.rhs(0, y, out, ctx); // syncs ctx.env/vRel for this y (§3.7 contract)

      expect(Math.abs(energyPowerInvariant.evaluate(0, y, ctx))).toBeLessThan(1e-13);
    }
  });

  it("with drag on, dE/dt via chain rule on E equals the energyPower invariant", () => {
    const mass = 0.145;
    const radius = 0.0366;
    const cd = new ConstantCd(0.47);

    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const environment = new Environment(
      new ConstantAtmosphere(),
      new UniformGravity(),
      new ZeroWind(),
    );
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    const ctx = createEvalContext(environment, params);
    const energyInvariant = model.invariants!.find((inv) => inv.name === "energy")!;
    const energyPowerInvariant = model.invariants!.find((inv) => inv.name === "energyPower")!;

    for (const state of STATES) {
      const y = new Float64Array(state);
      const out = new Float64Array(4);
      model.rhs(0, y, out, ctx);

      // dE/dt by the chain rule: dE/dy . f(t,y) = mg*vy + m*vx*ax + m*vy*ay.
      const [, , vx, vy] = state;
      const chainRuleDeDt = mass * ctx.env.g * vy! + mass * vx! * out[2]! + mass * vy! * out[3]!;

      expect(chainRuleDeDt).toBeCloseTo(energyPowerInvariant.evaluate(0, y, ctx), 10);
      // Drag strictly dissipates in still air: dE/dt <= 0.
      expect(energyPowerInvariant.evaluate(0, y, ctx)).toBeLessThanOrEqual(1e-13);
      expect(energyInvariant.evaluate(0, y, ctx)).toBeCloseTo(mechanicalEnergy(y, ctx), 12);
    }
  });
});
