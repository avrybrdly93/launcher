import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createGravityQuadraticDragJacobian } from "./jacobian.js";

const DIM = 4;

/** Central finite-difference Jacobian of `rhs`, row-major like the analytic one. */
function fdJacobian(
  rhs: (t: number, y: Float64Array, out: Float64Array) => void,
  t: number,
  y: Float64Array,
): Float64Array {
  const out = new Float64Array(DIM * DIM);
  const yPlus = Float64Array.from(y);
  const yMinus = Float64Array.from(y);
  const fPlus = new Float64Array(DIM);
  const fMinus = new Float64Array(DIM);

  for (let j = 0; j < DIM; j++) {
    const scale = Math.max(1, Math.abs(y[j]!));
    const h = 1e-6 * scale;
    yPlus[j] = y[j]! + h;
    yMinus[j] = y[j]! - h;
    rhs(t, yPlus, fPlus);
    rhs(t, yMinus, fMinus);
    yPlus[j] = y[j]!;
    yMinus[j] = y[j]!;
    for (let i = 0; i < DIM; i++) {
      out[i * DIM + j] = (fPlus[i]! - fMinus[i]!) / (2 * h);
    }
  }
  return out;
}

describe("createGravityQuadraticDragJacobian", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const params = createSphericalProjectileParams({
    mass,
    radius,
    dragCoefficient: new ConstantCd(0.47),
  });
  const environment = new Environment(
    new ConstantAtmosphere(),
    new UniformGravity(),
    new ZeroWind(),
  );
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const ctx = createEvalContext(environment, params);
  const rhs = (t: number, y: Float64Array, out: Float64Array): void => model.rhs(t, y, out, ctx);
  const jacobian = createGravityQuadraticDragJacobian(params, environment);

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

  it("matches central finite differences to 1e-7 at 10 states", () => {
    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(DIM * DIM);
      jacobian(0, y, analytic);
      const fd = fdJacobian(rhs, 0, y);

      for (let k = 0; k < DIM * DIM; k++) {
        expect(analytic[k]).toBeCloseTo(fd[k]!, 7);
      }
    }
  });

  it("is exactly the identity-velocity / zero-force block at v_rel = 0", () => {
    const out = new Float64Array(DIM * DIM);
    jacobian(0, new Float64Array([1, 2, 0, 0]), out);
    expect(Array.from(out)).toEqual([0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("reproduces the velocity-block eigenvalue ratio 2:1 for pure streamwise motion (§4.6)", () => {
    const out = new Float64Array(DIM * DIM);
    const y = new Float64Array([0, 0, 50, 0]);
    jacobian(0, y, out);

    const dVxDVx = out[VX_ROW + 2]!;
    const dVyDVy = out[VY_ROW + 3]!;
    expect(out[VX_ROW + 3]).toBeCloseTo(0, 12);
    expect(out[VY_ROW + 2]).toBeCloseTo(0, 12);
    expect(dVxDVx / dVyDVy).toBeCloseTo(2, 10);
  });
});

const VX_ROW = 2 * DIM;
const VY_ROW = 3 * DIM;
