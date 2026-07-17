import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ConstantCd } from "./drag-coefficient.js";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, UniformWind } from "./environment.js";
import {
  BuoyancyForce,
  composeForces,
  createForceRegistry,
  GravityForce,
  QuadraticDragForce,
} from "./forces.js";
import { createSphericalProjectileParams } from "./projectile-params.js";

const MASS = 0.145;
const RADIUS = 0.0366;
const PARAMS = createSphericalProjectileParams({
  mass: MASS,
  radius: RADIUS,
  dragCoefficient: new ConstantCd(0.47),
});

/** No Magnus: a spin-carrying force isn't mirror-symmetric under a plain x-reflection
 *  (that would also require flipping the sign of the spin pseudovector). */
const GRAVITY_DRAG_BUOYANCY = createForceRegistry([
  new GravityForce(),
  new QuadraticDragForce(),
  new BuoyancyForce(),
]);

function contextWithWind(wx: number, wy: number): { ctx: EvalContext; env: Environment } {
  const env = new Environment(
    new ConstantAtmosphere(),
    new UniformGravity(),
    new UniformWind(wx, wy),
  );
  return { ctx: createEvalContext(env, PARAMS), env };
}

/** Populates ctx.env/vRel/speedRel/re/mach for state y at time t, same as the model's rhs would. */
function refreshDerived(ctx: EvalContext, env: Environment, y: Float64Array): void {
  env.sample(0, y[0]!, y[1]!, ctx.env);
  ctx.vRel[0] = y[2]! - ctx.env.wx;
  ctx.vRel[1] = y[3]! - ctx.env.wy;
  ctx.speedRel = Math.hypot(ctx.vRel[0]!, ctx.vRel[1]!);
  ctx.re = (ctx.env.rho * ctx.speedRel * (2 * ctx.params.radius)) / ctx.env.eta;
  ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;
}

const coord = fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true });
const NUM_RUNS = 1000;

describe("force composition properties (fast-check, 1e3 cases each)", () => {
  it("mirror x ⇒ mirror F_x: gravity+quadratic-drag+buoyancy composed force mirrors under x -> -x", () => {
    fc.assert(
      fc.property(coord, coord, coord, coord, coord, coord, (x, yPos, vx, vy, wx, wy) => {
        const { ctx: ctx1, env: env1 } = contextWithWind(wx, wy);
        const y1 = new Float64Array([x, yPos, vx, vy]);
        refreshDerived(ctx1, env1, y1);
        const f1: [number, number] = [0, 0];
        composeForces(GRAVITY_DRAG_BUOYANCY, 0, y1, ctx1, f1);

        // Mirror x: negate x, vx, and wx; y, vy, wy unchanged.
        const { ctx: ctx2, env: env2 } = contextWithWind(-wx, wy);
        const y2 = new Float64Array([-x, yPos, -vx, vy]);
        refreshDerived(ctx2, env2, y2);
        const f2: [number, number] = [0, 0];
        composeForces(GRAVITY_DRAG_BUOYANCY, 0, y2, ctx2, f2);

        expect(f2[0]).toBeCloseTo(-f1[0]!, 9);
        expect(f2[1]).toBeCloseTo(f1[1]!, 9);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rotational consistency of quadratic drag: F(R_theta u) = R_theta F(u)", () => {
    fc.assert(
      fc.property(
        coord,
        coord,
        coord,
        coord,
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        (vx, vy, wx, wy, theta) => {
          const cosT = Math.cos(theta);
          const sinT = Math.sin(theta);
          const rotate = (px: number, py: number): [number, number] => [
            px * cosT - py * sinT,
            px * sinT + py * cosT,
          ];

          const { ctx: ctx1, env: env1 } = contextWithWind(wx, wy);
          const y1 = new Float64Array([0, 0, vx, vy]);
          refreshDerived(ctx1, env1, y1);
          const f1: [number, number] = [0, 0];
          new QuadraticDragForce().accumulate(0, y1, ctx1, f1);

          const [wxR, wyR] = rotate(wx, wy);
          const [vxR, vyR] = rotate(vx, vy);
          const { ctx: ctx2, env: env2 } = contextWithWind(wxR, wyR);
          const y2 = new Float64Array([0, 0, vxR, vyR]);
          refreshDerived(ctx2, env2, y2);
          const f2: [number, number] = [0, 0];
          new QuadraticDragForce().accumulate(0, y2, ctx2, f2);

          const [f1xRot, f1yRot] = rotate(f1[0]!, f1[1]!);
          expect(f2[0]).toBeCloseTo(f1xRot, 6);
          expect(f2[1]).toBeCloseTo(f1yRot, 6);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
