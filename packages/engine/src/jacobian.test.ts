import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createFiniteDifferenceJacobianScratch, finiteDifferenceJacobian } from "./jacobian.js";

describe("finiteDifferenceJacobian", () => {
  it("matches P1.22's analytic gravityQuadraticDragJacobian to 1e-7 at 10 states", () => {
    const cd = new ConstantCd(0.47);
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    expect(model.jacobian).toBeDefined();

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: cd,
    });
    const ctx = createEvalContext(env, params);
    const scratch = createFiniteDifferenceJacobianScratch(model.dim);

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [0, 0.5, 0.001, -0.002],
      [100, 10, -1.5, -1.5],
      [0, 0, 40, 0],
      [0, 0, 0, 40],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
      [1, 1, 33.3, -12.7],
    ];

    for (const [x, yPos, vx, vy] of states) {
      const y = new Float64Array([x, yPos, vx, vy]);
      const analytic = new Float64Array(16);
      model.jacobian!(0, y, analytic, ctx);
      const fd = new Float64Array(16);
      finiteDifferenceJacobian(model, 0, y, fd, ctx, scratch);

      for (let k = 0; k < 16; k++) {
        expect(fd[k]).toBeCloseTo(analytic[k]!, 7);
      }
    }
  });

  it("recovers the exact kinematic rows (dx/dt=vx, dy/dt=vy) for a composition with no analytic jacobian", () => {
    const cd = new ConstantCd(0.47);
    const cl = new SaturatingLiftCoefficient();
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    expect(model.jacobian).toBeUndefined();

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: cd,
      liftCoefficient: cl,
      spin: 180,
    });
    const ctx = createEvalContext(env, params);
    const scratch = createFiniteDifferenceJacobianScratch(model.dim);

    const y = new Float64Array([10, 5, 12.3, 4.1]);
    const fd = new Float64Array(16);
    finiteDifferenceJacobian(model, 0, y, fd, ctx, scratch);

    // Row 0 (dx/dt = vx) and row 1 (dy/dt = vy) are exactly linear in y,
    // independent of the force composition, so FD recovers them far tighter
    // than the general 1e-7 FD-truncation tolerance -- limited only by the
    // difference quotient's round-off floor (~eps/h, not eps) at this h.
    expect(fd[0]).toBeCloseTo(0, 9);
    expect(fd[1]).toBeCloseTo(0, 9);
    expect(fd[2]).toBeCloseTo(1, 9);
    expect(fd[3]).toBeCloseTo(0, 9);
    expect(fd[4]).toBeCloseTo(0, 9);
    expect(fd[5]).toBeCloseTo(0, 9);
    expect(fd[6]).toBeCloseTo(0, 9);
    expect(fd[7]).toBeCloseTo(1, 9);
  });

  it("does not allocate scratch buffers across repeated calls (ADR-004)", () => {
    const cd = new ConstantCd(0.47);
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: cd,
    });
    const ctx = createEvalContext(env, params);
    const scratch = createFiniteDifferenceJacobianScratch(model.dim);
    const y = new Float64Array([0, 0, 30, 10]);
    const out = new Float64Array(16);

    const before = scratch.yPerturbed;
    for (let i = 0; i < 1000; i++) {
      finiteDifferenceJacobian(model, i * 1e-3, y, out, ctx, scratch);
    }
    expect(scratch.yPerturbed).toBe(before);
  });
});
