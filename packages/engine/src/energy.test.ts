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
  [100, 10, -1.5, -1.5],
  [5, 5, 5, 5],
  [-10, -10, -20, 20],
];

function makeParams(spin?: number) {
  return createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0.47),
    liftCoefficient: spin !== undefined ? new SaturatingLiftCoefficient() : undefined,
    spin,
  });
}

describe("mechanicalEnergy", () => {
  it("equals (1/2)m|v|^2 + mgy", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity());
    const params = makeParams();
    const ctx = createEvalContext(env, params);
    ctx.env.g = 9.80665;
    const y = new Float64Array([0, 20, 10, -5]);
    const e = mechanicalEnergy(y, ctx);
    const expected = 0.5 * params.mass * (10 * 10 + 5 * 5) + params.mass * ctx.env.g * 20;
    expect(e).toBeCloseTo(expected, 12);
  });
});

describe("createPlanarProjectileModel energy invariants (P1.24)", () => {
  it("(i) drag-off: energyPowerAero is exactly 0 to 1e-13 (validation criterion)", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const ctx = createEvalContext(env, makeParams());
    const power = model.invariants!.find((inv) => inv.name === "energyPowerAero")!;

    for (const state of STATES) {
      const y = new Float64Array(state);
      expect(Math.abs(power.evaluate(0, y, ctx))).toBeLessThan(1e-13);
    }
  });

  it("(ii) Magnus-only: energyPowerAero is ~0 (F_M perpendicular to v_rel in still air)", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new MagnusForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const ctx = createEvalContext(env, makeParams(180));
    const power = model.invariants!.find((inv) => inv.name === "energyPowerAero")!;

    for (const state of STATES) {
      const y = new Float64Array(state);
      expect(Math.abs(power.evaluate(0, y, ctx))).toBeLessThan(1e-10);
    }
  });

  it("(iii) drag-on in still air: energyPowerAero is monotone non-increasing (<= 0)", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const ctx = createEvalContext(env, makeParams());
    const power = model.invariants!.find((inv) => inv.name === "energyPowerAero")!;

    for (const state of STATES) {
      const y = new Float64Array(state);
      expect(power.evaluate(0, y, ctx)).toBeLessThanOrEqual(0);
    }
  });

  it("the `energy` invariant reports (1/2)m|v|^2 + mgy", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = makeParams();
    const ctx = createEvalContext(env, params);
    const energy = model.invariants!.find((inv) => inv.name === "energy")!;

    const y = new Float64Array([0, 20, 10, -5]);
    const e = energy.evaluate(0, y, ctx);
    const expected = 0.5 * params.mass * (10 * 10 + 5 * 5) + params.mass * ctx.env.g * 20;
    expect(e).toBeCloseTo(expected, 12);
  });
});
