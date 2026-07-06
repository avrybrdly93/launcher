import { describe, expect, it } from "vitest";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { BuoyancyForce, GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { mechanicalEnergy } from "./energy.js";
import { dot } from "./vec2.js";

function makeContext(): { ctx: EvalContext; env: Environment } {
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0.47),
    liftCoefficient: new SaturatingLiftCoefficient(),
    spin: 180,
  });
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  return { ctx: createEvalContext(env, params), env };
}

describe("mechanicalEnergy", () => {
  it("is (1/2)m|v|^2 + mgy", () => {
    const { ctx } = makeContext();
    ctx.env.g = 9.80665;
    const y = new Float64Array([0, 12, 8, -6]);
    const expected = 0.5 * ctx.params.mass * (8 * 8 + 6 * 6) + ctx.params.mass * ctx.env.g * 12;
    expect(mechanicalEnergy(y, ctx)).toBeCloseTo(expected, 12);
  });
});

describe("createPlanarProjectileModel invariants (P1.24)", () => {
  it("declares an `energy` invariant equal to mechanicalEnergy at the given state", () => {
    const { ctx } = makeContext();
    const model = createPlanarProjectileModel([new GravityForce()]);
    const y = new Float64Array([0, 50, 20, -5]);
    const e = model.invariants?.find((inv) => inv.name === "energy");
    expect(e).toBeDefined();
    expect(e!.evaluate(0, y, ctx)).toBeCloseTo(mechanicalEnergy(y, ctx), 12);
  });

  it("drag-off (gravity only): energy is exactly conserved along the analytic parabola, and the energy-power invariant is 0 to 1e-13 (P1.24 validation)", () => {
    const { ctx, env } = makeContext();
    const model = createPlanarProjectileModel([new GravityForce()]);
    env.sample(0, 0, 0, ctx.env); // populate ctx.env.g before the first mechanicalEnergy call
    const g = ctx.env.g;
    const x0 = 0;
    const y0 = 0;
    const vx0 = 30;
    const vy0 = 20;

    const e0 = mechanicalEnergy(new Float64Array([x0, y0, vx0, vy0]), ctx);
    const powerInvariant = model.invariants?.find((inv) => inv.name === "energy-power");
    expect(powerInvariant).toBeDefined();

    for (const t of [0, 0.1, 0.5, 1, 1.7, 2.3, 3.1]) {
      const x = x0 + vx0 * t;
      const yPos = y0 + vy0 * t - 0.5 * g * t * t;
      const vx = vx0;
      const vy = vy0 - g * t;
      const y = new Float64Array([x, yPos, vx, vy]);

      const e = mechanicalEnergy(y, ctx);
      expect(Math.abs(e - e0) / Math.abs(e0)).toBeLessThan(1e-13);

      const power = powerInvariant!.evaluate(t, y, ctx);
      expect(Math.abs(power)).toBeLessThan(1e-13);
    }
  });

  it("still air with drag on: the energy-power invariant (dE/dt from powers) is <= 0 (monotone dissipation, §3.8)", () => {
    const { ctx } = makeContext();
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const powerInvariant = model.invariants!.find((inv) => inv.name === "energy-power")!;

    for (const [vx, vy] of [
      [20, 0],
      [0, -15],
      [12, 12],
      [-8, 6],
    ] as const) {
      const y = new Float64Array([0, 100, vx, vy]);
      expect(powerInvariant.evaluate(0, y, ctx)).toBeLessThanOrEqual(0);
    }
  });

  it("energy-power invariant equals F_aero . v computed independently from each force's accumulate output", () => {
    const { ctx } = makeContext();
    const forces = [
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
      new BuoyancyForce(),
    ];
    const model = createPlanarProjectileModel(forces);
    const powerInvariant = model.invariants!.find((inv) => inv.name === "energy-power")!;

    const y = new Float64Array([0, 10, 18, -9]);
    const out = new Float64Array(4);
    model.rhs(0, y, out, ctx); // populates ctx.env/vRel/speedRel/re/mach for this state

    let expectedAeroPower = 0;
    const f: [number, number] = [0, 0];
    for (const force of forces) {
      if (force.id === "gravity") continue;
      f[0] = 0;
      f[1] = 0;
      force.accumulate(0, y, ctx, f);
      expectedAeroPower += dot(f, [y[2]!, y[3]!]);
    }

    expect(powerInvariant.evaluate(0, y, ctx)).toBeCloseTo(expectedAeroPower, 10);
  });
});
