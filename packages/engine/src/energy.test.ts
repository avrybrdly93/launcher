import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { BuoyancyForce, GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import type { EnvSample } from "./env-sample.js";
import type { WindModel } from "./environment.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { mechanicalEnergy } from "./energy.js";

/** Minimal uniform wind stand-in (P1.29 not yet implemented); only used to exercise v_rel != v here. */
class UniformWind implements WindModel {
  constructor(
    private readonly wx: number,
    private readonly wy: number,
  ) {}

  sample(_t: number, _x: number, _y: number, out: EnvSample): void {
    out.wx = this.wx;
    out.wy = this.wy;
  }
}

const STATES: [number, number, number, number][] = [
  [0, 0, 12.3, 4.1],
  [10, 5, -8.2, 15.6],
  [-3, 20, 25.0, -30.1],
  [0, 0.5, 5.0, -2.0],
  [100, 10, -1.5, -1.5],
  [0, 0, 40, 0],
  [0, 0, 0, 40],
  [5, 5, 5, 5],
  [-10, -10, -20, 20],
  [1, 1, 33.3, -12.7],
];

describe("mechanicalEnergy", () => {
  it("equals (1/2)m|v|^2 + mgy", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const mass = 0.145;
    const params = createSphericalProjectileParams({
      mass,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const g = 9.80665;

    for (const [x, yPos, vx, vy] of STATES) {
      const y = new Float64Array([x, yPos, vx, vy]);
      const expected = 0.5 * mass * (vx * vx + vy * vy) + mass * g * yPos;
      expect(mechanicalEnergy(0, y, ctx)).toBeCloseTo(expected, 9);
    }
  });
});

describe("energy-balance-residual invariant (P1.24)", () => {
  const mass = 0.145;
  const radius = 0.0366;

  function makeCtx(wind: { wx: number; wy: number } = { wx: 0, wy: 0 }) {
    const env = new Environment(
      new ConstantAtmosphere(),
      new UniformGravity(),
      wind.wx === 0 && wind.wy === 0 ? new ZeroWind() : new UniformWind(wind.wx, wind.wy),
    );
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.47),
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 180,
    });
    return createEvalContext(env, params);
  }

  it("is ~0 with aero forces off (drag-off): dE/dt from powers, to 1e-13", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    const ctx = makeCtx();
    const residual = model.invariants!.find((inv) => inv.name === "energy-balance-residual")!;

    for (const [x, yPos, vx, vy] of STATES) {
      const y = new Float64Array([x, yPos, vx, vy]);
      expect(Math.abs(residual.evaluate(0, y, ctx))).toBeLessThan(1e-13);
    }
  });

  it("is ~0 with drag + Magnus + buoyancy on (still an algebraic identity), to 1e-9", () => {
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
      new BuoyancyForce(),
    ]);
    const ctx = makeCtx();
    const residual = model.invariants!.find((inv) => inv.name === "energy-balance-residual")!;

    for (const [x, yPos, vx, vy] of STATES) {
      const y = new Float64Array([x, yPos, vx, vy]);
      expect(Math.abs(residual.evaluate(0, y, ctx))).toBeLessThan(1e-9);
    }
  });

  it("is ~0 even with nonzero wind (true-velocity energyPower, not v_rel)", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const ctx = makeCtx({ wx: 5, wy: -2 });
    const residual = model.invariants!.find((inv) => inv.name === "energy-balance-residual")!;

    for (const [x, yPos, vx, vy] of STATES) {
      const y = new Float64Array([x, yPos, vx, vy]);
      expect(Math.abs(residual.evaluate(0, y, ctx))).toBeLessThan(1e-9);
    }
  });

  it("exposes mechanical-energy as a separate invariant channel", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    const ctx = makeCtx();
    const energy = model.invariants!.find((inv) => inv.name === "mechanical-energy")!;
    const y = new Float64Array([0, 10, 3, 4]);
    expect(energy.evaluate(0, y, ctx)).toBeCloseTo(mechanicalEnergy(0, y, ctx), 12);
  });
});
