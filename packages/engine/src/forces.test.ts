import { describe, expect, it } from "vitest";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import {
  BuoyancyForce,
  composeForceJacobian,
  composeForces,
  createForceRegistry,
  forcesSupportJacobian,
  GravityForce,
  LinearDragForce,
  MagnusForce,
  QuadraticDragForce,
  type ForceModel,
  type MutForceJacobian,
} from "./forces.js";
import { norm, dot } from "./vec2.js";

function makeContext(overrides: { spin?: number; withLift?: boolean } = {}): {
  ctx: EvalContext;
  env: Environment;
} {
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0.47),
    liftCoefficient: overrides.withLift ? new SaturatingLiftCoefficient() : undefined,
    spin: overrides.spin,
  });
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const ctx = createEvalContext(env, params);
  return { ctx, env };
}

/** Fills ctx.env/vRel/speedRel/re/mach the same way planarProjectileModel.rhs would. */
function refreshDerived(ctx: EvalContext, env: Environment, t: number, y: Float64Array): void {
  env.sample(t, y[0]!, y[1]!, ctx.env);
  ctx.vRel[0] = y[2]! - ctx.env.wx;
  ctx.vRel[1] = y[3]! - ctx.env.wy;
  ctx.speedRel = norm(ctx.vRel);
  ctx.re = (ctx.env.rho * ctx.speedRel * (2 * ctx.params.radius)) / ctx.env.eta;
  ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;
}

describe("GravityForce", () => {
  it("is exactly F = (0, -mg)", () => {
    const { ctx, env } = makeContext();
    const y = new Float64Array([0, 0, 10, 5]);
    refreshDerived(ctx, env, 0, y);
    const out: [number, number] = [0, 0];
    new GravityForce().accumulate(0, y, ctx, out);
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(-ctx.params.mass * ctx.env.g, 15);
  });

  it("jacobian() adds nothing: F_g is constant under uniform gravity (P1.22)", () => {
    const { ctx, env } = makeContext();
    const y = new Float64Array([0, 0, 10, 5]);
    refreshDerived(ctx, env, 0, y);
    const out: MutForceJacobian = [1, 2, 3, 4, 5, 6, 7, 8];
    new GravityForce().jacobian!(0, y, ctx, out);
    expect(out).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("LinearDragForce", () => {
  it("is anti-parallel to v_rel with magnitude b*|v_rel|", () => {
    const { ctx, env } = makeContext();
    const y = new Float64Array([0, 0, 3, -4]);
    refreshDerived(ctx, env, 0, y);
    const out: [number, number] = [0, 0];
    new LinearDragForce().accumulate(0, y, ctx, out);
    const b = 6 * Math.PI * ctx.env.eta * ctx.params.radius;
    expect(norm(out)).toBeCloseTo(b * ctx.speedRel, 15);
    expect(dot(out, ctx.vRel)).toBeLessThan(0);
  });
});

describe("QuadraticDragForce", () => {
  it("has magnitude 0.5*rho*Cd*A*|u|^2 at random states", () => {
    const { ctx, env } = makeContext();
    const force = new QuadraticDragForce();
    for (const [vx, vy] of [
      [10, 0],
      [0, -20],
      [7, 7],
      [-15, 3],
      [1, -1],
    ] as const) {
      const y = new Float64Array([0, 0, vx, vy]);
      refreshDerived(ctx, env, 0, y);
      const out: [number, number] = [0, 0];
      force.accumulate(0, y, ctx, out);
      const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
      const expected = 0.5 * ctx.env.rho * cd * ctx.params.area * ctx.speedRel * ctx.speedRel;
      expect(norm(out)).toBeCloseTo(expected, 10);
    }
  });

  it("returns finite zeros when v_rel = 0 (no NaN, P1.09)", () => {
    const { ctx, env } = makeContext();
    const y = new Float64Array([0, 0, 0, 0]);
    refreshDerived(ctx, env, 0, y);
    const out: [number, number] = [0, 0];
    new QuadraticDragForce().accumulate(0, y, ctx, out);
    expect(Number.isFinite(out[0])).toBe(true);
    expect(Number.isFinite(out[1])).toBe(true);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
  });

  it("jacobian() matches central finite differences of accumulate() w.r.t. (vx, vy) (P1.22)", () => {
    const { ctx, env } = makeContext();
    const force = new QuadraticDragForce();
    const h = 1e-5;

    for (const [vx, vy] of [
      [10, 0],
      [0, -20],
      [7, 7],
      [-15, 3],
      [1, -1],
    ] as const) {
      const y = new Float64Array([0, 0, vx, vy]);
      refreshDerived(ctx, env, 0, y);
      const analytic: MutForceJacobian = [0, 0, 0, 0, 0, 0, 0, 0];
      force.jacobian!(0, y, ctx, analytic);

      const evalAt = (dvx: number, dvy: number): [number, number] => {
        const yy = new Float64Array([0, 0, vx + dvx, vy + dvy]);
        refreshDerived(ctx, env, 0, yy);
        const out: [number, number] = [0, 0];
        force.accumulate(0, yy, ctx, out);
        return out;
      };
      const fPlusVx = evalAt(h, 0);
      const fMinusVx = evalAt(-h, 0);
      const fPlusVy = evalAt(0, h);
      const fMinusVy = evalAt(0, -h);

      expect(analytic[0]).toBe(0); // dFx/dx
      expect(analytic[1]).toBe(0); // dFx/dy
      expect(analytic[2]).toBeCloseTo((fPlusVx[0] - fMinusVx[0]) / (2 * h), 5); // dFx/dvx
      expect(analytic[3]).toBeCloseTo((fPlusVy[0] - fMinusVy[0]) / (2 * h), 5); // dFx/dvy
      expect(analytic[4]).toBe(0); // dFy/dx
      expect(analytic[5]).toBe(0); // dFy/dy
      expect(analytic[6]).toBeCloseTo((fPlusVx[1] - fMinusVx[1]) / (2 * h), 5); // dFy/dvx
      expect(analytic[7]).toBeCloseTo((fPlusVy[1] - fMinusVy[1]) / (2 * h), 5); // dFy/dvy
    }
  });

  it("jacobian() adds nothing (leaves outJ untouched) at v_rel = 0", () => {
    const { ctx, env } = makeContext();
    const y = new Float64Array([0, 0, 0, 0]);
    refreshDerived(ctx, env, 0, y);
    const out: MutForceJacobian = [1, 2, 3, 4, 5, 6, 7, 8];
    new QuadraticDragForce().jacobian!(0, y, ctx, out);
    expect(out).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("MagnusForce", () => {
  it("backspin lifts a rightward-moving projectile (F_M . y-hat > 0)", () => {
    const { ctx, env } = makeContext({ spin: 200, withLift: true });
    const y = new Float64Array([0, 0, 30, 0]);
    refreshDerived(ctx, env, 0, y);
    const out: [number, number] = [0, 0];
    new MagnusForce().accumulate(0, y, ctx, out);
    expect(out[1]).toBeGreaterThan(0);
  });

  it("is perpendicular to v_rel to 1e-14", () => {
    const { ctx, env } = makeContext({ spin: 150, withLift: true });
    const y = new Float64Array([0, 0, 25, 10]);
    refreshDerived(ctx, env, 0, y);
    const out: [number, number] = [0, 0];
    new MagnusForce().accumulate(0, y, ctx, out);
    const cos = dot(out, ctx.vRel) / (norm(out) * norm(ctx.vRel));
    expect(Math.abs(cos)).toBeLessThan(1e-14);
  });

  it("produces no NaN at the apex of a vertical throw in still air (v_rel = 0)", () => {
    const { ctx, env } = makeContext({ spin: 300, withLift: true });
    const y = new Float64Array([0, 10, 0, 0]);
    refreshDerived(ctx, env, 0, y);
    const out: [number, number] = [0, 0];
    new MagnusForce().accumulate(0, y, ctx, out);
    expect(Number.isFinite(out[0])).toBe(true);
    expect(Number.isFinite(out[1])).toBe(true);
  });
});

describe("BuoyancyForce", () => {
  it("is ~1.0-1.6% of weight for a soccer-ball preset (P1.16 validation criterion)", () => {
    const params = createSphericalProjectileParams({
      mass: 0.43,
      radius: 0.11,
      dragCoefficient: new ConstantCd(0.25),
    });
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity());
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 0, 0, 0]);
    refreshDerived(ctx, env, 0, y);
    const out: [number, number] = [0, 0];
    new BuoyancyForce().accumulate(0, y, ctx, out);
    const weight = ctx.params.mass * ctx.env.g;
    const ratio = out[1] / weight;
    expect(ratio).toBeGreaterThan(0.01);
    expect(ratio).toBeLessThan(0.016);
  });
});

describe("createForceRegistry / composeForces", () => {
  it("sums multiple forces into a zeroed accumulator", () => {
    const a: ForceModel = {
      id: "a",
      accumulate: (_t, _y, _ctx, out) => {
        out[0] += 1;
        out[1] += 2;
      },
    };
    const b: ForceModel = {
      id: "b",
      accumulate: (_t, _y, _ctx, out) => {
        out[0] += 10;
        out[1] += 20;
      },
    };
    const { ctx, env } = makeContext();
    const y = new Float64Array([0, 0, 0, 0]);
    refreshDerived(ctx, env, 0, y);
    const out: [number, number] = [999, 999]; // composeForces must zero this first
    composeForces(createForceRegistry([a, b]), 0, y, ctx, out);
    expect(out).toEqual([11, 22]);
  });

  it("gives the same result regardless of registration order (bit-identical)", () => {
    const { ctx, env } = makeContext({ spin: 120, withLift: true });
    const y = new Float64Array([0, 0, 18, -6]);
    refreshDerived(ctx, env, 0, y);
    const forces = [
      new GravityForce(),
      new LinearDragForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
      new BuoyancyForce(),
    ];
    const outA: [number, number] = [0, 0];
    composeForces(createForceRegistry(forces), 0, y, ctx, outA);
    const outB: [number, number] = [0, 0];
    composeForces(createForceRegistry([...forces].reverse()), 0, y, ctx, outB);
    expect(outA[0]).toBe(outB[0]);
    expect(outA[1]).toBe(outB[1]);
  });
});

describe("forcesSupportJacobian / composeForceJacobian (P1.22)", () => {
  it("is true for gravity+quadratic-drag and false once Magnus joins", () => {
    expect(forcesSupportJacobian([new GravityForce(), new QuadraticDragForce()])).toBe(true);
    expect(
      forcesSupportJacobian([new GravityForce(), new QuadraticDragForce(), new MagnusForce()]),
    ).toBe(false);
  });

  it("sums multiple forces' jacobians into a zeroed accumulator", () => {
    const a: ForceModel = {
      id: "a",
      accumulate: () => {},
      jacobian: (_t, _y, _ctx, out) => {
        out[0] += 1;
        out[7] += 2;
      },
    };
    const b: ForceModel = {
      id: "b",
      accumulate: () => {},
      jacobian: (_t, _y, _ctx, out) => {
        out[0] += 10;
        out[7] += 20;
      },
    };
    const { ctx, env } = makeContext();
    const y = new Float64Array([0, 0, 0, 0]);
    refreshDerived(ctx, env, 0, y);
    const out: MutForceJacobian = [999, 999, 999, 999, 999, 999, 999, 999];
    composeForceJacobian(createForceRegistry([a, b]), 0, y, ctx, out);
    expect(out).toEqual([11, 0, 0, 0, 0, 0, 0, 22]);
  });
});
