import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createGravityQuadraticDragJacobian } from "./jacobian.js";
import { createFiniteDifferenceJacobian } from "./finite-difference-jacobian.js";
import type { Model } from "./model.js";

const DIM = 4;

const STATES: [number, number, number, number][] = [
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

describe("createFiniteDifferenceJacobian", () => {
  it("matches P1.22's analytic gravity+quadratic-drag Jacobian at 10 states", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const ctx = createEvalContext(env, params);
    const analyticJacobian = createGravityQuadraticDragJacobian(env, params);
    const fdJacobian = createFiniteDifferenceJacobian(model, ctx);

    for (const [x, y, vx, vy] of STATES) {
      const state = new Float64Array([x, y, vx, vy]);
      const analytic = new Float64Array(DIM * DIM);
      const fd = new Float64Array(DIM * DIM);
      analyticJacobian(0, state, analytic);
      fdJacobian(0, state, fd);

      for (let i = 0; i < DIM * DIM; i++) {
        expect(fd[i]).toBeCloseTo(analytic[i]!, 7);
      }
    }
  });

  it("reproduces an exactly linear rhs's constant Jacobian to near machine precision", () => {
    // f(y) = A*y for a fixed A; central differences of a linear function have
    // zero truncation error, so this isolates roundoff and validates the
    // scaled-step choice independent of the projectile model entirely.
    const A = [
      [2, -1, 0],
      [0, 3, 4],
      [5, 0, -6],
    ];
    const linearModel: Pick<Model, "dim" | "rhs"> = {
      dim: 3,
      rhs(_t, y, out) {
        for (let i = 0; i < 3; i++) {
          out[i] = A[i]![0]! * y[0]! + A[i]![1]! * y[1]! + A[i]![2]! * y[2]!;
        }
      },
    };
    // The linear rhs above ignores ctx entirely; a real one is only needed to satisfy the type.
    const unusedCtx = createEvalContext(
      new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind()),
      createSphericalProjectileParams({
        mass: 1,
        radius: 0.05,
        dragCoefficient: new ConstantCd(0.47),
      }),
    );
    const fdJacobian = createFiniteDifferenceJacobian(linearModel, unusedCtx);
    const out = new Float64Array(9);
    fdJacobian(0, new Float64Array([3.7, -1.2, 8.5]), out);

    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(out[i * 3 + j]).toBeCloseTo(A[i]![j]!, 8);
      }
    }
  });

  it("stays finite on a model outside P1.22's scope (gravity+drag+Magnus)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 180,
    });
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    const ctx = createEvalContext(env, params);
    const fdJacobian = createFiniteDifferenceJacobian(model, ctx);
    const out = new Float64Array(DIM * DIM);
    fdJacobian(0, new Float64Array([0, 0, 30, 10]), out);

    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
    }
    // Kinematic identity block still holds regardless of which forces are wired.
    expect(out[0 * DIM + 2]).toBeCloseTo(1, 9);
    expect(out[1 * DIM + 3]).toBeCloseTo(1, 9);
  });
});
