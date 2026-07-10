import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce, type ForceModel } from "./forces.js";
import { aeroEnergyPower, mechanicalEnergy } from "./energy.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { dot } from "./vec2.js";

function makeCtx(overrides: { spin?: number; withLift?: boolean } = {}) {
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0.47),
    liftCoefficient: overrides.withLift ? new SaturatingLiftCoefficient() : undefined,
    spin: overrides.spin,
  });
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  return { ctx: createEvalContext(env, params), env };
}

describe("createPlanarProjectileModel invariants wiring (P1.24)", () => {
  it("exposes a mechanical-energy InvariantSpec", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    expect(model.invariants?.map((i) => i.name)).toContain("mechanical-energy");
  });
});

describe("mechanicalEnergy / eq. 3.19", () => {
  it("is conserved to 1e-13 (relative) along an analytic drag-off free-fall trajectory", () => {
    const { ctx } = makeCtx();
    const g = 9.80665;
    const x0 = 0;
    const y0 = 100;
    const vx0 = 15;
    const vy0 = 5;

    const y = new Float64Array([x0, y0, vx0, vy0]);
    const E0 = mechanicalEnergy(0, y, ctx);

    for (const t of [0, 0.1, 0.5, 1, 1.5, 2, 3, 4.5]) {
      y[0] = x0 + vx0 * t;
      y[1] = y0 + vy0 * t - 0.5 * g * t * t;
      y[2] = vx0;
      y[3] = vy0 - g * t;

      const E = mechanicalEnergy(t, y, ctx);
      expect(Math.abs(E - E0) / Math.abs(E0)).toBeLessThan(1e-13);
    }
  });

  it("drag-off: aeroEnergyPower is exactly 0 to 1e-13 (P1.24 validation)", () => {
    const { ctx } = makeCtx();
    const forces: readonly ForceModel[] = [new GravityForce()];

    const states = [
      new Float64Array([0, 0, 30, 20]),
      new Float64Array([10, 5, -15, 8]),
      new Float64Array([0, 100, 0, -40]),
      new Float64Array([5, 2, 25, -25]),
    ];
    for (const y of states) {
      expect(Math.abs(aeroEnergyPower(forces, 0, y, ctx))).toBeLessThan(1e-13);
    }
  });

  it("aeroEnergyPower equals sum(F_i . v) over the non-gravity forces (drag+Magnus on)", () => {
    const { ctx } = makeCtx({ spin: 180, withLift: true });
    const forces: readonly ForceModel[] = [
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ];
    const y = new Float64Array([0, 0, 25, -10]);

    let expected = 0;
    const out: [number, number] = [0, 0];
    for (const force of forces) {
      if (force.id === "gravity") continue;
      out[0] = 0;
      out[1] = 0;
      force.accumulate(0, y, ctx, out);
      expected += dot(out, [y[2]!, y[3]!]);
    }

    expect(aeroEnergyPower(forces, 0, y, ctx)).toBeCloseTo(expected, 12);
  });

  it("drag on, still air: aeroEnergyPower is non-positive (energy dissipates, §3.8 case iii)", () => {
    const { ctx } = makeCtx();
    const forces: readonly ForceModel[] = [new GravityForce(), new QuadraticDragForce()];
    const y = new Float64Array([0, 50, 20, -15]);
    expect(aeroEnergyPower(forces, 0, y, ctx)).toBeLessThanOrEqual(0);
  });
});
