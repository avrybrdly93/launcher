import { describe, expect, it } from "vitest";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import {
  composeEnergyPower,
  GravityForce,
  MagnusForce,
  QuadraticDragForce,
  type ForceModel,
} from "./forces.js";
import { mechanicalEnergy } from "./energy.js";

const STATES: [number, number, number, number][] = [
  [0, 0, 12.3, 4.1],
  [10, 5, -8.2, 15.6],
  [-3, 20, 25.0, -30.1],
  [100, 10, -1.5, -1.5],
  [5, 5, 5, 5],
];

function makeContext(withLift = false): { ctx: EvalContext; env: Environment } {
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0.47),
    liftCoefficient: withLift ? new SaturatingLiftCoefficient() : undefined,
    spin: withLift ? 180 : undefined,
  });
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const ctx = createEvalContext(env, params);
  return { ctx, env };
}

/** Refreshes ctx.env/vRel/speedRel the way rhs would, ahead of an energyPower/mechanicalEnergy call. */
function refresh(ctx: EvalContext, env: Environment, t: number, y: Float64Array): void {
  env.sample(t, y[0]!, y[1]!, ctx.env);
  ctx.vRel[0] = y[2]! - ctx.env.wx;
  ctx.vRel[1] = y[3]! - ctx.env.wy;
  ctx.speedRel = Math.hypot(ctx.vRel[0], ctx.vRel[1]);
}

/** dE/dt = d(KE)/dt + d(PE)/dt = composeEnergyPower(forces) + mg*vy (§3.19). */
function energyRate(forces: readonly ForceModel[], ctx: EvalContext, y: Float64Array): number {
  return composeEnergyPower(forces, 0, y, ctx) + ctx.params.mass * ctx.env.g * y[3]!;
}

describe("mechanicalEnergy", () => {
  it("is exactly (1/2)m|v|^2 + mgy", () => {
    const { ctx, env } = makeContext();
    const y = new Float64Array([0, 10, 3, 4]);
    refresh(ctx, env, 0, y);
    const expected = 0.5 * ctx.params.mass * (3 * 3 + 4 * 4) + ctx.params.mass * ctx.env.g * 10;
    expect(mechanicalEnergy(y, ctx)).toBeCloseTo(expected, 12);
  });
});

describe("composeEnergyPower", () => {
  it("sums energyPower across forces, treating a missing energyPower as 0", () => {
    const withPower: ForceModel = {
      id: "a",
      accumulate: () => {},
      energyPower: () => 3,
    };
    const withoutPower: ForceModel = {
      id: "b",
      accumulate: () => {},
    };
    const { ctx, env } = makeContext();
    const y = new Float64Array([0, 0, 0, 0]);
    refresh(ctx, env, 0, y);
    expect(composeEnergyPower([withPower, withoutPower], 0, y, ctx)).toBe(3);
  });
});

describe("energy invariant (P1.24, §3.19 runtime checks)", () => {
  it("drag-off: dE/dt from powers is 0 to 1e-13 (mechanical energy conserved under gravity alone)", () => {
    const { ctx, env } = makeContext();
    const forces = [new GravityForce()];

    for (const state of STATES) {
      const y = new Float64Array(state);
      refresh(ctx, env, 0, y);
      expect(Math.abs(energyRate(forces, ctx, y))).toBeLessThan(1e-13);
    }
  });

  it("Magnus-only: dE/dt is 0 to 1e-10 (ideal Magnus lift does no work)", () => {
    const { ctx, env } = makeContext(true);
    const forces = [new GravityForce(), new MagnusForce()];

    for (const state of STATES) {
      const y = new Float64Array(state);
      refresh(ctx, env, 0, y);
      expect(Math.abs(energyRate(forces, ctx, y))).toBeLessThan(1e-10);
    }
  });

  it("drag on in still air: dE/dt is strictly non-positive (energy strictly dissipates)", () => {
    const { ctx, env } = makeContext();
    const forces = [new GravityForce(), new QuadraticDragForce()];

    for (const state of STATES) {
      const y = new Float64Array(state);
      refresh(ctx, env, 0, y);
      expect(energyRate(forces, ctx, y)).toBeLessThanOrEqual(1e-13);
    }
  });
});
