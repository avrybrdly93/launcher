import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { createForceRegistry, GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { composeEnergyPower, planarMechanicalEnergy } from "./energy-invariant.js";

const Y = 1;
const VX = 2;
const VY = 3;

// Deterministic pseudo-random states (avoid a test dependency on a RNG library).
const STATES: [number, number, number, number][] = [
  [0, 0, 12.3, 4.1],
  [10, 5, -8.2, 15.6],
  [-3, 20, 25.0, -30.1],
  [100, 10, -1.5, -1.5],
  [0, 0, 40, 0],
  [5, 5, 5, 5],
  [-10, -10, -20, 20],
];

function dEdt(
  forces: ReturnType<typeof createForceRegistry>,
  y: Float64Array,
  ctx: ReturnType<typeof createEvalContext>,
): number {
  // dE/dt = d(KE)/dt + d(PE)/dt = (sum of force powers) + m*g*vy (eq. 3.19).
  return composeEnergyPower(forces, 0, y, ctx) + ctx.params.mass * ctx.env.g * y[VY]!;
}

describe("planar energy invariant", () => {
  it("attaches an 'energy' InvariantSpec to the planar projectile model", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    expect(model.invariants?.map((inv) => inv.name)).toEqual(["energy"]);
  });

  it("planarMechanicalEnergy matches (1/2)m|v|^2 + mgy directly", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 12, 8, 3]);
    const e = planarMechanicalEnergy(0, y, ctx);
    const expected = 0.5 * 0.145 * (8 * 8 + 3 * 3) + 0.145 * 9.80665 * 12;
    expect(e).toBeCloseTo(expected, 12);
  });

  it("drag-off: dE/dt from powers is 0 to 1e-13 (gravity alone)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const forces = createForceRegistry([new GravityForce()]);

    for (const state of STATES) {
      const y = new Float64Array(state);
      env.sample(0, y[0]!, y[Y]!, ctx.env);
      ctx.vRel[0] = y[VX]!;
      ctx.vRel[1] = y[VY]!;
      expect(Math.abs(dEdt(forces, y, ctx))).toBeLessThan(1e-13);
    }
  });

  it("Magnus alone (still air): dE/dt from powers is 0 to 1e-13 (ideal lift does no work)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0),
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 180,
    });
    const ctx = createEvalContext(env, params);
    const forces = createForceRegistry([new GravityForce(), new MagnusForce()]);

    for (const state of STATES) {
      const y = new Float64Array(state);
      env.sample(0, y[0]!, y[Y]!, ctx.env);
      ctx.vRel[0] = y[VX]!;
      ctx.vRel[1] = y[VY]!;
      ctx.speedRel = Math.hypot(ctx.vRel[0], ctx.vRel[1]);
      expect(Math.abs(dEdt(forces, y, ctx))).toBeLessThan(1e-13);
    }
  });

  it("drag on in still air: dE/dt from powers is monotone non-positive (dissipative)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const forces = createForceRegistry([new GravityForce(), new QuadraticDragForce()]);

    for (const state of STATES) {
      const y = new Float64Array(state);
      env.sample(0, y[0]!, y[Y]!, ctx.env);
      ctx.vRel[0] = y[VX]!;
      ctx.vRel[1] = y[VY]!;
      ctx.speedRel = Math.hypot(ctx.vRel[0], ctx.vRel[1]);
      ctx.re = (ctx.env.rho * ctx.speedRel * (2 * params.radius)) / ctx.env.eta;
      ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;
      expect(dEdt(forces, y, ctx)).toBeLessThanOrEqual(0);
    }
  });
});
