import { describe, expect, it } from "vitest";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import {
  BuoyancyForce,
  GravityForce,
  MagnusForce,
  QuadraticDragForce,
  type ForceModel,
} from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { mechanicalEnergy, nonGravitationalPower } from "./energy.js";

const VX = 2;
const VY = 3;

/** Chain-rule dE/dt = dE/dy . f(t,y), independent of `nonGravitationalPower`'s
 * force-by-force bookkeeping — the cross-check that eq. 3.19's wiring is
 * actually consistent with `mechanicalEnergy`'s definition. */
function chainRuleEnergyRate(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  const model = createPlanarProjectileModel(forces);
  const rhs = new Float64Array(4);
  model.rhs(t, y, rhs, ctx);

  const g = ctx.env.g;
  const vx = y[VX]!;
  const vy = y[VY]!;
  const vxDot = rhs[VX]!;
  const vyDot = rhs[VY]!;

  return ctx.params.mass * g * vy + ctx.params.mass * (vx * vxDot + vy * vyDot);
}

describe("mechanicalEnergy / nonGravitationalPower (eq. 3.19)", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass,
    radius,
    dragCoefficient: new ConstantCd(0.47),
    liftCoefficient: new SaturatingLiftCoefficient(),
    spin: 180,
  });
  const ctx = createEvalContext(env, params);

  const states: [number, number, number, number][] = [
    [0, 0, 12.3, 4.1],
    [10, 5, -8.2, 15.6],
    [-3, 20, 25.0, -30.1],
    [100, 10, -1.5, -1.5],
    [0, 0, 40, 0],
    [5, 5, 5, 5],
    [-10, -10, -20, 20],
  ];

  it("drag-off: dE/dt from powers is 0 to 1e-13", () => {
    const forces: ForceModel[] = [new GravityForce()];
    for (const state of states) {
      const y = new Float64Array(state);
      expect(nonGravitationalPower(forces, 0, y, ctx)).toBeCloseTo(0, 13);
    }
  });

  it("drag-off: the invariant's chain-rule dE/dt also vanishes to 1e-13", () => {
    const forces: ForceModel[] = [new GravityForce()];
    for (const state of states) {
      const y = new Float64Array(state);
      expect(chainRuleEnergyRate(forces, 0, y, ctx)).toBeCloseTo(0, 13);
    }
  });

  it("with drag + Magnus, dE/dt from powers matches the chain-rule derivative", () => {
    const forces: ForceModel[] = [new GravityForce(), new QuadraticDragForce(), new MagnusForce()];
    for (const state of states) {
      const y = new Float64Array(state);
      const fromPowers = nonGravitationalPower(forces, 0, y, ctx);
      const fromChainRule = chainRuleEnergyRate(forces, 0, y, ctx);
      expect(fromPowers).toBeCloseTo(fromChainRule, 10);
    }
  });

  it("with buoyancy, dE/dt from powers still matches the chain-rule derivative", () => {
    const forces: ForceModel[] = [
      new GravityForce(),
      new BuoyancyForce(),
      new QuadraticDragForce(),
    ];
    for (const state of states) {
      const y = new Float64Array(state);
      const fromPowers = nonGravitationalPower(forces, 0, y, ctx);
      const fromChainRule = chainRuleEnergyRate(forces, 0, y, ctx);
      expect(fromPowers).toBeCloseTo(fromChainRule, 10);
    }
  });

  it("drag alone in still air strictly dissipates: dE/dt <= 0", () => {
    const forces: ForceModel[] = [new GravityForce(), new QuadraticDragForce()];
    for (const state of states) {
      const y = new Float64Array(state);
      expect(nonGravitationalPower(forces, 0, y, ctx)).toBeLessThanOrEqual(1e-13);
    }
  });

  it("Magnus alone does no work (ideal lift is perpendicular to v_rel)", () => {
    const forces: ForceModel[] = [new GravityForce(), new MagnusForce()];
    for (const state of states) {
      const y = new Float64Array(state);
      expect(nonGravitationalPower(forces, 0, y, ctx)).toBeCloseTo(0, 10);
    }
  });

  it("is wired onto createPlanarProjectileModel as an InvariantSpec named mechanicalEnergy", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    expect(model.invariants?.map((inv) => inv.name)).toEqual(["mechanicalEnergy"]);
    const y = new Float64Array([0, 100, 10, 0]);
    expect(model.invariants![0]!.evaluate(0, y, ctx)).toBeCloseTo(mechanicalEnergy(0, y, ctx), 13);
  });
});
