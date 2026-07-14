import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createEnergyInvariant, energyRateFromPowers } from "./energy-invariant.js";

// Same deterministic pseudo-random states used elsewhere in this package.
const STATES: readonly [number, number, number, number][] = [
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

function buildCtx(dragCd = 0.47) {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(dragCd),
  });
  return createEvalContext(env, params);
}

describe("createEnergyInvariant (P1.24)", () => {
  it("evaluates E(y) = (1/2)m|v|^2 + mgy", () => {
    const invariant = createEnergyInvariant();
    const ctx = buildCtx();
    const y = new Float64Array([0, 10, 20, 5]);

    const e = invariant.evaluate(0, y, ctx);
    const expected = 0.5 * 0.145 * (20 * 20 + 5 * 5) + 0.145 * ctx.env.g * 10;
    expect(e).toBeCloseTo(expected, 12);
  });

  it("is wired onto createPlanarProjectileModel as the 'energy' invariant", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    expect(model.invariants?.length).toBe(1);
    expect(model.invariants?.[0]?.name).toBe("energy");
  });
});

describe("energyRateFromPowers (P1.24, eq. 3.19)", () => {
  it("drag-off: dE/dt from powers is 0 to 1e-13 at 10 states", () => {
    const forces = [new GravityForce()];
    const ctx = buildCtx();

    for (const [x, yPos, vx, vy] of STATES) {
      const y = new Float64Array([x, yPos, vx, vy]);
      const dEdt = energyRateFromPowers(forces, 0, y, ctx);
      expect(dEdt).toBeCloseTo(0, 13);
    }
  });

  it("drag-on, still air: dE/dt <= 0 (strict dissipation) at 10 states", () => {
    const forces = [new GravityForce(), new QuadraticDragForce()];
    const ctx = buildCtx();

    for (const [x, yPos, vx, vy] of STATES) {
      const y = new Float64Array([x, yPos, vx, vy]);
      const dEdt = energyRateFromPowers(forces, 0, y, ctx);
      expect(dEdt).toBeLessThanOrEqual(1e-13);
    }
  });

  it("Magnus-only (no drag), still air: dE/dt is 0 to 1e-13 (F_M perp v_rel)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0), // isolate Magnus: no drag contribution
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 180,
    });
    const ctx = createEvalContext(env, params);
    const forces = [new GravityForce(), new QuadraticDragForce(), new MagnusForce()];

    for (const [x, yPos, vx, vy] of STATES) {
      const y = new Float64Array([x, yPos, vx, vy]);
      const dEdt = energyRateFromPowers(forces, 0, y, ctx);
      expect(dEdt).toBeCloseTo(0, 10);
    }
  });
});
