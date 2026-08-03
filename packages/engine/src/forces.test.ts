import { describe, expect, it } from "vitest";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import {
  BuoyancyForce,
  buoyancyToWeightRatio,
  composeForces,
  CoriolisForce,
  createForceRegistry,
  GravityForce,
  LinearDragForce,
  MagnusForce,
  QuadraticDragForce,
  type ForceModel,
} from "./forces.js";
import { ISA } from "./units.js";
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

  it("buoyancyToWeightRatio (P4.20) matches BuoyancyForce.accumulate's own ratio, g-independent", () => {
    const params = createSphericalProjectileParams({
      mass: 0.43,
      radius: 0.11,
      dragCoefficient: new ConstantCd(0.25),
    });
    // Two different gravity models -- the ratio must come out identical either way, since |F_b|/|F_g| = rho*V/m has no g term.
    for (const env of [
      new Environment(new ConstantAtmosphere(), new UniformGravity()),
      new Environment(new ConstantAtmosphere(), new UniformGravity(1.62)), // lunar g, sanity-checks g cancels
    ]) {
      const ctx = createEvalContext(env, params);
      const y = new Float64Array([0, 0, 0, 0]);
      refreshDerived(ctx, env, 0, y);
      const out: [number, number] = [0, 0];
      new BuoyancyForce().accumulate(0, y, ctx, out);
      const weight = ctx.params.mass * ctx.env.g;
      expect(buoyancyToWeightRatio(params, ctx.env.rho)).toBeCloseTo(out[1] / weight, 15);
    }
  });

  it("buoyancyToWeightRatio is smaller for a denser/larger-mass-per-volume preset (baseball vs soccer ball)", () => {
    const soccerBall = createSphericalProjectileParams({
      mass: 0.43,
      radius: 0.11,
      dragCoefficient: new ConstantCd(0.25),
    });
    const baseball = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.03645,
      dragCoefficient: new ConstantCd(0.35),
    });
    expect(buoyancyToWeightRatio(baseball, ISA.rho0)).toBeLessThan(
      buoyancyToWeightRatio(soccerBall, ISA.rho0),
    );
  });
});

describe("CoriolisForce", () => {
  it("is a registered id, but throws rather than silently omitting the lateral deflection a 2D model can't represent", () => {
    const force = new CoriolisForce();
    expect(force.id).toBe("coriolis");
    const y = new Float64Array([0, 0, 0, 0]);
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity());
    const ctx = createEvalContext(env, params);
    const out: [number, number] = [0, 0];
    expect(() => force.accumulate(0, y, ctx, out)).toThrow(/3D-only/);
  });

  it("composeForces surfaces the same throw (not swallowed by the registry loop)", () => {
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity());
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 0, 0, 0]);
    expect(() =>
      composeForces([new GravityForce(), new CoriolisForce()], 0, y, ctx, [0, 0]),
    ).toThrow(/3D-only/);
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
