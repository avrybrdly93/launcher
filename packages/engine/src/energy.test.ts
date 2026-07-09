import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { aeroPower, mechanicalEnergy } from "./energy.js";

describe("mechanicalEnergy", () => {
  it("is (1/2)m|v|^2 + mgy", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 2,
      radius: 0.1,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 10, 3, 4]);
    const e = mechanicalEnergy(0, y, ctx);
    expect(e).toBeCloseTo(0.5 * 2 * (3 * 3 + 4 * 4) + 2 * ctx.env.g * 10, 12);
  });

  it("is wired as the model's 'energy' invariant", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    expect(model.invariants?.[0]?.name).toBe("energy");

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 2,
      radius: 0.1,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 10, 3, 4]);
    expect(model.invariants![0]!.evaluate(0, y, ctx)).toBe(mechanicalEnergy(0, y, ctx));
  });
});

describe("aeroPower / eq. (3.19) wiring", () => {
  it("drag-off (gravity + Magnus only, still air): dE/dt from powers is 0 to 1e-13", () => {
    const cl = new SaturatingLiftCoefficient();
    const forces = [new GravityForce(), new MagnusForce()];
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0), // unused: QuadraticDragForce isn't registered at all
      liftCoefficient: cl,
      spin: 180,
    });
    const ctx = createEvalContext(env, params);

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [0, 20, 25.0, -30.1],
      [0, 0, 40, 0],
      [5, 5, 5, 5],
    ];

    for (const state of states) {
      const y = new Float64Array(state);
      // aeroPower needs ctx.vRel refreshed the same way rhs() does.
      env.sample(0, y[0]!, y[1]!, ctx.env);
      ctx.vRel[0] = y[2]! - ctx.env.wx;
      ctx.vRel[1] = y[3]! - ctx.env.wy;
      ctx.speedRel = Math.hypot(ctx.vRel[0], ctx.vRel[1]);

      expect(Math.abs(aeroPower(forces, 0, y, ctx))).toBeLessThan(1e-13);
    }
  });

  it("equals the analytic dE/dt = m*v.a + m*g*vy at 10 random states with drag on", () => {
    const cl = new SaturatingLiftCoefficient();
    const forces = [new GravityForce(), new QuadraticDragForce(), new MagnusForce()];
    const model = createPlanarProjectileModel(forces);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
      liftCoefficient: cl,
      spin: 180,
    });
    const ctx = createEvalContext(env, params);

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [0, 0.5, 0.5, -0.7],
      [100, 10, -1.5, -1.5],
      [0, 0, 40, 0.001],
      [0, 0, 0.001, 40],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
      [1, 1, 33.3, -12.7],
    ];

    const out = new Float64Array(4);
    for (const state of states) {
      const y = new Float64Array(state);
      model.rhs(0, y, out, ctx);
      const [vx, vy] = state.slice(2) as [number, number];
      const ax = out[2]!;
      const ay = out[3]!;
      const analyticDEdt = ctx.params.mass * (vx * ax + vy * ay) + ctx.params.mass * ctx.env.g * vy;

      // aeroPower needs ctx.vRel refreshed the same way rhs() just did (still valid post-rhs call).
      const power = aeroPower(forces, 0, y, ctx);
      expect(analyticDEdt).toBeCloseTo(power, 10);
    }
  });
});
