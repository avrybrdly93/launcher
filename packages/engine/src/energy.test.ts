import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import {
  aeroEnergyPower,
  createEnergyInvariant,
  mechanicalEnergy,
  totalEnergyPower,
} from "./energy.js";

function makeCtx(spin?: number, withLift?: boolean) {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0.47),
    liftCoefficient: withLift ? new SaturatingLiftCoefficient() : undefined,
    spin,
  });
  return { ctx: createEvalContext(env, params), env, params };
}

describe("mechanicalEnergy", () => {
  it("equals (1/2)m|v|^2 + mgy at a known state", () => {
    const { ctx } = makeCtx();
    const y = new Float64Array([0, 20, 30, -10]);
    const e = mechanicalEnergy(0, y, ctx);
    const expected = 0.5 * ctx.params.mass * (30 * 30 + 10 * 10) + ctx.params.mass * ctx.env.g * 20;
    expect(e).toBeCloseTo(expected, 12);
  });
});

describe("createEnergyInvariant", () => {
  it("is named 'energy' and matches mechanicalEnergy", () => {
    const { ctx } = makeCtx();
    const spec = createEnergyInvariant();
    const y = new Float64Array([0, 5, 12, 3]);
    expect(spec.name).toBe("energy");
    expect(spec.evaluate(0, y, ctx)).toBe(mechanicalEnergy(0, y, ctx));
  });
});

describe("createPlanarProjectileModel", () => {
  it("declares the energy invariant", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    expect(model.invariants?.map((i) => i.name)).toEqual(["energy"]);
  });
});

describe("totalEnergyPower", () => {
  it("equals m*(v.a) computed from rhs, for any force set (F=ma identity)", () => {
    const { ctx } = makeCtx(180, true);
    const forces = [new GravityForce(), new QuadraticDragForce(), new MagnusForce()];
    const model = createPlanarProjectileModel(forces);
    const y = new Float64Array([0, 10, 22, -6]);
    const out = new Float64Array(4);
    model.rhs(0, y, out, ctx);

    const power = totalEnergyPower(forces, 0, y, ctx);
    const mva = ctx.params.mass * (y[2]! * out[2]! + y[3]! * out[3]!);
    expect(power).toBeCloseTo(mva, 10);
  });
});

describe("aeroEnergyPower (eq. 3.19's three exact checks)", () => {
  it("drag-off: is exactly 0 to 1e-13 with only gravity registered", () => {
    const { ctx } = makeCtx();
    const forces = [new GravityForce()];
    const y = new Float64Array([0, 10, 22, -6]);
    expect(Math.abs(aeroEnergyPower(forces, 0, y, ctx))).toBeLessThan(1e-13);
  });

  it("Magnus-only: is ~0 (ideal Magnus force does no work, F_M perp v_rel)", () => {
    const { ctx } = makeCtx(200, true);
    const forces = [new GravityForce(), new MagnusForce()];
    const y = new Float64Array([0, 10, 25, 12]);
    expect(Math.abs(aeroEnergyPower(forces, 0, y, ctx))).toBeLessThan(1e-10);
  });

  it("drag-on in still air: is monotone non-increasing (<= 0) across sampled states", () => {
    const { ctx } = makeCtx();
    const forces = [new GravityForce(), new QuadraticDragForce()];
    const states: [number, number, number, number][] = [
      [0, 10, 22, -6],
      [0, 0, 5, 5],
      [0, 0, -10, 3],
      [0, 0, 0.5, -0.2],
    ];
    for (const state of states) {
      const y = new Float64Array(state);
      expect(aeroEnergyPower(forces, 0, y, ctx)).toBeLessThanOrEqual(0);
    }
  });

  it("is exactly 0 at v_rel = 0 (no NaN)", () => {
    const { ctx } = makeCtx();
    const forces = [new GravityForce(), new QuadraticDragForce()];
    const y = new Float64Array([0, 0, 0, 0]);
    expect(aeroEnergyPower(forces, 0, y, ctx)).toBe(0);
  });
});
