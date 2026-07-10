import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { gravityQuadraticDragJacobian } from "./jacobian.js";

const DIM = 4;
const VX_ROW_VX = 2 * DIM + 2;
const VY_ROW_VY = 3 * DIM + 3;

/** Generic central finite-difference Jacobian, used only to validate the analytic one. */
function finiteDifferenceJacobian(
  rhs: (t: number, y: Float64Array, out: Float64Array) => void,
  t: number,
  y: Float64Array,
  out: Float64Array,
): void {
  const plus = new Float64Array(DIM);
  const minus = new Float64Array(DIM);
  const yPerturbed = Float64Array.from(y);

  for (let j = 0; j < DIM; j++) {
    const base = y[j]!;
    const h = Math.max(Math.abs(base), 1) * 1e-6;

    yPerturbed[j] = base + h;
    rhs(t, yPerturbed, plus);
    yPerturbed[j] = base - h;
    rhs(t, yPerturbed, minus);
    yPerturbed[j] = base;

    for (let i = 0; i < DIM; i++) {
      out[i * DIM + j] = (plus[i]! - minus[i]!) / (2 * h);
    }
  }
}

describe("gravityQuadraticDragJacobian", () => {
  it("matches central finite differences to 1e-7 at 10 random states", () => {
    const mass = 0.145;
    const radius = 0.0366;
    const cd = new ConstantCd(0.47);

    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    const ctx = createEvalContext(env, params);

    const rhs = (t: number, y: Float64Array, out: Float64Array): void => model.rhs(t, y, out, ctx);

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
      finiteDifferenceJacobian(rhs, 0, y, fd);

      for (let i = 0; i < DIM * DIM; i++) {
        expect(analytic[i]).toBeCloseTo(fd[i]!, 7);
      }
    }
  });

  it("streamwise/crosswise eigenvalue ratio matches the linearization in §4.6 (2:1)", () => {
    const mass = 1;
    const radius = 0.05;
    const cd = new ConstantCd(0.47);

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    const ctx = createEvalContext(env, params);

    const out = new Float64Array(DIM * DIM);
    // Pure streamwise motion: v_rel = (u, 0).
    gravityQuadraticDragJacobian(0, new Float64Array([0, 0, 30, 0]), ctx, out);
    const dAxDvx = out[VX_ROW_VX]!;
    const dAyDvy = out[VY_ROW_VY]!;
    expect(dAxDvx / dAyDvy).toBeCloseTo(2, 10);
  });

  it("is zero at v_rel = 0 (no NaN, matches the P1.09 drag guard)", () => {
    const mass = 1;
    const radius = 0.05;
    const cd = new ConstantCd(0.47);

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    const ctx = createEvalContext(env, params);

    const out = new Float64Array(DIM * DIM);
    gravityQuadraticDragJacobian(0, new Float64Array([0, 0, 0, 0]), ctx, out);
    expect(Array.from(out)).not.toContain(NaN);
    expect(out[VX_ROW_VX]).toBe(0);
    expect(out[VY_ROW_VY]).toBe(0);
  });
});
