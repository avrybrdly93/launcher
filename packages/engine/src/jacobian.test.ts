import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import type { Model } from "./model.js";
import {
  FiniteDifferenceJacobianScratch,
  finiteDifferenceJacobian,
  gravityQuadraticDragJacobian,
} from "./jacobian.js";

describe("gravityQuadraticDragJacobian", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const cd = new ConstantCd(0.47);

  function makeCtx() {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    return { env, ctx: createEvalContext(env, params) };
  }

  it("matches central finite differences to 1e-7 at 10 states", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const { ctx } = makeCtx();

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [0, 0.5, 5.0, -2.0],
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
      finiteDifferenceJacobian(model, 0, y, ctx, fd, new FiniteDifferenceJacobianScratch(4));

      for (let i = 0; i < 16; i++) {
        expect(analytic[i]).toBeCloseTo(fd[i]!, 7);
      }
    }
  });

  it("attaches jacobian to gravity+quadratic-drag-only models", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    expect(model.jacobian).toBe(gravityQuadraticDragJacobian);
  });

  it("does not attach jacobian when Magnus is present", () => {
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    expect(model.jacobian).toBeUndefined();
  });

  it("is exactly zero at v_rel = 0 (no NaN from the 0/0 limit)", () => {
    const { ctx } = makeCtx();
    const y = new Float64Array([0, 0, 0, 0]);
    const out = new Float64Array(16);
    gravityQuadraticDragJacobian(0, y, out, ctx);

    expect(Array.from(out)).toEqual([0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

/** Trivial dy/dt = -y decay model: Model-agnostic stand-in, Jacobian known exactly (-1). */
function createDecayModel(): Model {
  return {
    dim: 1,
    channels: [{ name: "y", unit: "1" }],
    rhs(_t, y, out, _ctx) {
      out[0] = -y[0]!;
    },
  };
}

describe("finiteDifferenceJacobian (P1.23)", () => {
  it("matches P1.22's analytic Jacobian where available, at 10 states", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const scratch = new FiniteDifferenceJacobianScratch(4);

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [0, 0.5, 5.0, -2.0],
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
      finiteDifferenceJacobian(model, 0, y, ctx, fd, scratch);

      for (let i = 0; i < 16; i++) {
        expect(fd[i]).toBeCloseTo(analytic[i]!, 7);
      }
    }
  });

  it("works generically on any Model, not just the planar projectile (dy/dt = -y => J = [-1])", () => {
    const model = createDecayModel();
    const ctx = {} as ReturnType<typeof createEvalContext>; // the mock rhs never touches ctx
    const scratch = new FiniteDifferenceJacobianScratch(1);
    const out = new Float64Array(1);

    finiteDifferenceJacobian(model, 0, new Float64Array([3.7]), ctx, out, scratch);

    expect(out[0]).toBeCloseTo(-1, 7);
  });

  it("reuses its scratch buffers without leaking state across calls", () => {
    const model = createDecayModel();
    const ctx = {} as ReturnType<typeof createEvalContext>;
    const scratch = new FiniteDifferenceJacobianScratch(1);
    const out = new Float64Array(1);

    for (const y0 of [1, -5, 100, 0.001]) {
      finiteDifferenceJacobian(model, 0, new Float64Array([y0]), ctx, out, scratch);
      expect(out[0]).toBeCloseTo(-1, 7);
    }
  });
});
