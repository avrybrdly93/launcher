import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { finiteDifferenceJacobian } from "./finite-difference-jacobian.js";

const STATES: [number, number, number, number][] = [
  [0, 0, 12.3, 4.1],
  [10, 5, -8.2, 15.6],
  [-3, 20, 25.0, -30.1],
  [0, 0.5, 3.1, -2.2],
  [100, 10, -1.5, -1.5],
  [0, 0, 40, 0],
  [0, 0, 0, 40],
  [5, 5, 5, 5],
  [-10, -10, -20, 20],
  [1, 1, 33.3, -12.7],
];

describe("finiteDifferenceJacobian (P1.23)", () => {
  const mass = 0.145;
  const radius = 0.0366;

  function makeCtx() {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.47),
    });
    return createEvalContext(env, params);
  }

  it("matches the P1.22 analytic jacobian (gravity + quadratic drag) at 10 random states", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const ctx = makeCtx();
    expect(typeof model.jacobian).toBe("function");

    for (const [x, yPos, vx, vy] of STATES) {
      const y = new Float64Array([x, yPos, vx, vy]);
      const analytic = new Float64Array(16);
      model.jacobian!(0, y, analytic, ctx);

      const fd = new Float64Array(16);
      finiteDifferenceJacobian(model, 0, y, ctx, fd);

      for (let k = 0; k < 16; k++) {
        expect(Math.abs(analytic[k]! - fd[k]!)).toBeLessThan(1e-6);
      }
    }
  });

  it("still gives finite, kinematically-correct rows when no analytic jacobian exists (Magnus present)", () => {
    const cl = new SaturatingLiftCoefficient();
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.47),
      liftCoefficient: cl,
      spin: 180,
    });
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const ctx = createEvalContext(env, params);
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    expect(model.jacobian).toBeUndefined();

    for (const [x, yPos, vx, vy] of STATES) {
      const y = new Float64Array([x, yPos, vx, vy]);
      const fd = new Float64Array(16);
      finiteDifferenceJacobian(model, 0, y, ctx, fd);

      for (let k = 0; k < 16; k++) expect(Number.isFinite(fd[k]!)).toBe(true);

      // dx/dt = vx, dy/dt = vy exactly, regardless of force composition.
      expect(fd[0 * 4 + 2]).toBeCloseTo(1, 5);
      expect(fd[0 * 4 + 0]).toBeCloseTo(0, 5);
      expect(fd[0 * 4 + 1]).toBeCloseTo(0, 5);
      expect(fd[0 * 4 + 3]).toBeCloseTo(0, 5);
      expect(fd[1 * 4 + 3]).toBeCloseTo(1, 5);
      expect(fd[1 * 4 + 0]).toBeCloseTo(0, 5);
      expect(fd[1 * 4 + 1]).toBeCloseTo(0, 5);
      expect(fd[1 * 4 + 2]).toBeCloseTo(0, 5);
    }
  });
});
