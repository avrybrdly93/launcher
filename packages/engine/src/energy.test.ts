import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { energyRateFromPowers, mechanicalEnergy } from "./energy.js";

const STATES: [number, number, number, number][] = [
  [0, 0, 12.3, 4.1],
  [10, 5, -8.2, 15.6],
  [-3, 20, 25.0, -30.1],
  [0, 0, 40, 0],
  [5, 5, 5, 5],
  [-10, -10, -20, 20],
];

function makeCtx(spin?: number) {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0.47),
    liftCoefficient: spin ? new SaturatingLiftCoefficient() : undefined,
    spin,
  });
  return createEvalContext(env, params);
}

describe("mechanicalEnergy", () => {
  it("equals (1/2) m |v|^2 + m g y", () => {
    const ctx = makeCtx();
    const y = new Float64Array([0, 10, 3, 4]);
    const e = mechanicalEnergy(0, y, ctx);
    expect(e).toBeCloseTo(0.5 * 0.145 * (3 * 3 + 4 * 4) + 0.145 * ctx.env.g * 10, 12);
  });
});

describe("energyRateFromPowers", () => {
  it("aero off (gravity only): dE/dt from powers is zero to 1e-13", () => {
    const ctx = makeCtx();
    for (const state of STATES) {
      const rate = energyRateFromPowers([new GravityForce()], 0, new Float64Array(state), ctx);
      expect(Math.abs(rate)).toBeLessThan(1e-13);
    }
  });

  it("Magnus only: dE/dt from powers is zero to 1e-13 (ideal Magnus does no work)", () => {
    const ctx = makeCtx(180);
    for (const state of STATES) {
      const rate = energyRateFromPowers(
        [new GravityForce(), new MagnusForce()],
        0,
        new Float64Array(state),
        ctx,
      );
      expect(Math.abs(rate)).toBeLessThan(1e-13);
    }
  });

  it("drag on in still air: dE/dt from powers is monotone non-increasing", () => {
    const ctx = makeCtx();
    for (const state of STATES) {
      const rate = energyRateFromPowers(
        [new GravityForce(), new QuadraticDragForce()],
        0,
        new Float64Array(state),
        ctx,
      );
      expect(rate).toBeLessThanOrEqual(0);
    }
  });

  it("matches dE/dt computed via the rhs's own acceleration (chain rule) across force sets", () => {
    const forceSets = [
      [new GravityForce()],
      [new GravityForce(), new QuadraticDragForce()],
      [new GravityForce(), new QuadraticDragForce(), new MagnusForce()],
    ];
    for (const forces of forceSets) {
      const ctx = makeCtx(180);
      const model = createPlanarProjectileModel(forces);
      for (const state of STATES) {
        const y = new Float64Array(state);
        const out = new Float64Array(4);
        model.rhs(0, y, out, ctx);
        const vx = y[2]!;
        const vy = y[3]!;
        const ax = out[2]!;
        const ay = out[3]!;
        const dEdtAnalytic =
          ctx.params.mass * (vx * ax + vy * ay) + ctx.params.mass * ctx.env.g * vy;
        const dEdtPowers = energyRateFromPowers(forces, 0, y, ctx);
        expect(dEdtPowers).toBeCloseTo(dEdtAnalytic, 10);
      }
    }
  });
});
