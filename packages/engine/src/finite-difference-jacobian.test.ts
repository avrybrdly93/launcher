import { describe, expect, it } from "vitest";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import {
  createFiniteDifferenceJacobianScratch,
  finiteDifferenceJacobian,
} from "./finite-difference-jacobian.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { analyticJacobianGravityQuadraticDrag } from "./jacobian.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import type { Model } from "./model.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createSphericalProjectileParams } from "./projectile-params.js";

const DIM = 4;

describe("finiteDifferenceJacobian", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const params = createSphericalProjectileParams({
    mass,
    radius,
    dragCoefficient: new ConstantCd(0.47),
  });
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);

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

  it("matches the P1.22 analytic jacobian where available, at 10 states", () => {
    const ctx = createEvalContext(env, params);
    const analytic = new Float64Array(DIM * DIM);
    const fd = new Float64Array(DIM * DIM);

    for (const state of states) {
      const y = new Float64Array(state);
      analyticJacobianGravityQuadraticDrag(0, y, ctx, analytic);
      finiteDifferenceJacobian(model, 0, y, ctx, fd);

      for (let k = 0; k < DIM * DIM; k++) {
        expect(fd[k]).toBeCloseTo(analytic[k]!, 6);
      }
    }
  });

  it("also handles a model with no analytic jacobian (gravity+drag+Magnus)", () => {
    const cl = new SaturatingLiftCoefficient();
    const spinParams = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.47),
      liftCoefficient: cl,
      spin: 150,
    });
    const magnusModel = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    expect(magnusModel.jacobian).toBeUndefined(); // confirms this exercises the FD fallback path

    const ctx = createEvalContext(env, spinParams);
    const y = new Float64Array([0, 0, 25, 10]);
    const out = new Float64Array(DIM * DIM);
    finiteDifferenceJacobian(magnusModel, 0, y, ctx, out);

    // Sanity: dx/dt = vx and dy/dt = vy are exact regardless of force model.
    expect(out[0 * DIM + 2]).toBeCloseTo(1, 8);
    expect(out[1 * DIM + 3]).toBeCloseTo(1, 8);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });

  it("reuses scratch buffers without allocating fresh ones on repeated calls", () => {
    const ctx = createEvalContext(env, params);
    const scratch = createFiniteDifferenceJacobianScratch(DIM);
    const out = new Float64Array(DIM * DIM);
    const y = new Float64Array([0, 0, 20, 5]);

    finiteDifferenceJacobian(model, 0, y, ctx, out, scratch);
    const yPertRef = scratch.yPert;
    finiteDifferenceJacobian(model, 0, y, ctx, out, scratch);

    expect(scratch.yPert).toBe(yPertRef); // same buffer identity across calls
  });

  it("works generically on a trivial dim-1 model (dy/dt = -y => J = [-1])", () => {
    const decayModel: Pick<Model, "dim" | "rhs"> = {
      dim: 1,
      rhs(_t, y, out) {
        out[0] = -y[0]!;
      },
    };
    const out = new Float64Array(1);
    finiteDifferenceJacobian(decayModel, 0, new Float64Array([3]), {} as EvalContext, out);
    expect(out[0]).toBeCloseTo(-1, 6);
  });
});
