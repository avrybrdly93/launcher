import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { gravityQuadraticDragJacobian } from "./jacobian.js";
import { createFdJacobianScratch, finiteDifferenceJacobian } from "./fd-jacobian.js";

const DIM = 4;

describe("finiteDifferenceJacobian", () => {
  it("matches the P1.22 analytic Jacobian at 10 random states", () => {
    const mass = 0.145;
    const radius = 0.0366;
    const cd = new ConstantCd(0.47);

    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    const ctx = createEvalContext(env, params);
    const scratch = createFdJacobianScratch(DIM);

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [0, 0.5, 0.5, -0.7],
      [100, 10, -1.5, -1.5],
      [0, 0, 40, 0],
      [0, 0, 0, 40],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
      [1, 1, 33.3, -12.7],
    ];

    const analytic = new Float64Array(DIM * DIM);
    const fd = new Float64Array(DIM * DIM);

    for (const [x, yPos, vx, vy] of states) {
      const y = new Float64Array([x, yPos, vx, vy]);

      gravityQuadraticDragJacobian(0, y, ctx, analytic);
      finiteDifferenceJacobian(model, 0, y, ctx, fd, scratch);

      for (let i = 0; i < DIM * DIM; i++) {
        expect(fd[i]).toBeCloseTo(analytic[i]!, 6);
      }
    }
  });

  it("does not mutate the input state (perturbation is restored each column)", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const scratch = createFdJacobianScratch(DIM);

    const y = new Float64Array([1, 2, 10, -5]);
    const yBefore = Float64Array.from(y);
    const out = new Float64Array(DIM * DIM);

    finiteDifferenceJacobian(model, 0, y, ctx, out, scratch);

    expect(Array.from(y)).toEqual(Array.from(yBefore));
  });

  it("also works generically on a model with Magnus (no analytic reference, just finiteness)", () => {
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
      spin: 180,
    });
    const ctx = createEvalContext(env, params);
    const scratch = createFdJacobianScratch(DIM);

    const out = new Float64Array(DIM * DIM);
    finiteDifferenceJacobian(model, 0, new Float64Array([0, 0, 20, 10]), ctx, out, scratch);

    expect(Array.from(out).some((v) => Number.isNaN(v))).toBe(false);
    // dx/dvx and dy/dvy are exactly 1 for any force set (position rows are the identity).
    expect(out[0 * DIM + 2]).toBeCloseTo(1, 6);
    expect(out[1 * DIM + 3]).toBeCloseTo(1, 6);
  });
});
