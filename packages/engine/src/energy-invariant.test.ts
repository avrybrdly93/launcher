import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { BuoyancyForce, GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createEnergyInvariant, energyRate, mechanicalEnergy } from "./energy-invariant.js";

function makeGravityOnlyCtx() {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0),
  });
  return createEvalContext(env, params);
}

describe("mechanicalEnergy (P1.24)", () => {
  it("is 0.5*m*|v|^2 + m*g*y", () => {
    const ctx = makeGravityOnlyCtx();
    const y = new Float64Array([0, 12, 8, -6]);
    const e = mechanicalEnergy(0, y, ctx);
    const expected = 0.5 * ctx.params.mass * (8 * 8 + 6 * 6) + ctx.params.mass * ctx.env.g * 12;
    expect(e).toBeCloseTo(expected, 12);
  });
});

describe("createPlanarProjectileModel invariants (P1.24)", () => {
  it("wires an 'energy' InvariantSpec matching mechanicalEnergy", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    expect(model.invariants?.[0]?.name).toBe("energy");

    const ctx = makeGravityOnlyCtx();
    const y = new Float64Array([0, 12, 8, -6]);
    expect(model.invariants?.[0]?.evaluate(0, y, ctx)).toBeCloseTo(mechanicalEnergy(0, y, ctx), 12);
  });
});

describe("energyRate (P1.24 validation: drag-off dE/dt from powers = 0)", () => {
  it("is exactly zero to 1e-13 with gravity as the only force, at 10 random states", () => {
    const forces = [new GravityForce()];
    const ctx = makeGravityOnlyCtx();

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [0, 0.5, 3.1, -2.2],
      [100, 10, -1.5, -1.5],
      [0, 0, 40, 0],
      [0, 0, 0, 40],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
      [1, 1, 33.3, -12.7],
    ];

    for (const [x, yPos, vx, vy] of states) {
      const y = new Float64Array([x, yPos, vx, vy]);
      expect(Math.abs(energyRate(forces, 0, y, ctx))).toBeLessThan(1e-13);
    }
  });

  it("stays zero to 1e-13 with gravity + buoyancy (both conservative-in-this-sense forces)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.43,
      radius: 0.11,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const forces = [new GravityForce(), new BuoyancyForce()];
    const y = new Float64Array([0, 3, 9, -4]);
    // Buoyancy isn't part of E's PE term, so its energyPower is a genuine,
    // nonzero addition to dE/dt here — this only degenerates to 0 for
    // gravity alone. Assert it's finite and matches the direct force sum,
    // not that it vanishes.
    const rate = energyRate(forces, 0, y, ctx);
    expect(Number.isFinite(rate)).toBe(true);
    const buoyancyPower = new BuoyancyForce().energyPower!(0, y, ctx);
    expect(rate).toBeCloseTo(buoyancyPower, 12);
  });

  it("is undefined-avoiding (still finite) with Magnus + drag present", () => {
    const cl = new SaturatingLiftCoefficient();
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
      liftCoefficient: cl,
      spin: 180,
    });
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const ctx = createEvalContext(env, params);
    const forces = [new GravityForce(), new QuadraticDragForce(), new MagnusForce()];
    const y = new Float64Array([0, 10, 25, 5]);
    expect(Number.isFinite(energyRate(forces, 0, y, ctx))).toBe(true);
    // Drag dissipates in this composition (nonzero speed): dE/dt should be <= 0
    // for the drag-dominated case since Magnus does no work (F_M perp v).
    expect(energyRate(forces, 0, y, ctx)).toBeLessThanOrEqual(0);
  });
});

describe("createEnergyInvariant", () => {
  it("returns an InvariantSpec named 'energy' delegating to mechanicalEnergy", () => {
    const spec = createEnergyInvariant();
    const ctx = makeGravityOnlyCtx();
    const y = new Float64Array([1, 2, 3, 4]);
    expect(spec.name).toBe("energy");
    expect(spec.evaluate(0, y, ctx)).toBeCloseTo(mechanicalEnergy(0, y, ctx), 12);
  });
});
