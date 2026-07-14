import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";

// Deterministic pseudo-random states (no state has v_rel = 0, where the
// drag Jacobian has a removable singularity handled separately below).
const STATES: readonly [number, number, number, number][] = [
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

const DIM = 4;

function centralDifferenceJacobian(
  model: ReturnType<typeof createPlanarProjectileModel>,
  t: number,
  y: Float64Array,
  ctx: ReturnType<typeof createEvalContext>,
): Float64Array {
  const J = new Float64Array(DIM * DIM);
  const plus = new Float64Array(DIM);
  const minus = new Float64Array(DIM);
  const outPlus = new Float64Array(DIM);
  const outMinus = new Float64Array(DIM);

  for (let j = 0; j < DIM; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(y[j]!));
    plus.set(y);
    minus.set(y);
    plus[j] = y[j]! + h;
    minus[j] = y[j]! - h;

    model.rhs(t, plus, outPlus, ctx);
    model.rhs(t, minus, outMinus, ctx);

    for (let i = 0; i < DIM; i++) {
      J[i * DIM + j] = (outPlus[i]! - outMinus[i]!) / (2 * h);
    }
  }

  return J;
}

function buildScenario() {
  const model = createPlanarProjectileModel(
    [new GravityForce(), new QuadraticDragForce()],
    undefined,
  );
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0.47),
  });
  const ctx = createEvalContext(env, params);
  return { model, ctx };
}

describe("gravityQuadraticDragJacobian (P1.22)", () => {
  it("is attached only when forces are exactly gravity+quadratic-drag", () => {
    const ctx = createEvalContext(
      new Environment(new ConstantAtmosphere(), new UniformGravity()),
      createSphericalProjectileParams({
        mass: 1,
        radius: 0.05,
        dragCoefficient: new ConstantCd(0.47),
      }),
    );

    const withJacobian = createPlanarProjectileModel(
      [new GravityForce(), new QuadraticDragForce()],
      ctx,
    );
    expect(withJacobian.jacobian).toBeTypeOf("function");

    const withoutCtx = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    expect(withoutCtx.jacobian).toBeUndefined();

    const withMagnus = createPlanarProjectileModel(
      [new GravityForce(), new QuadraticDragForce(), new MagnusForce()],
      ctx,
    );
    expect(withMagnus.jacobian).toBeUndefined();
  });

  it("matches central finite differences to 1e-7 at 10 states", () => {
    // Build the model with its own ctx bound for the analytic jacobian, and a
    // second independent ctx for the FD reference so neither evaluation path
    // mutates state the other depends on.
    const { model: fdModel, ctx: fdCtx } = buildScenario();
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const jacCtx = createEvalContext(env, params);
    const model = createPlanarProjectileModel(
      [new GravityForce(), new QuadraticDragForce()],
      jacCtx,
    );

    const t = 1.5;
    const out = new Float64Array(DIM * DIM);

    for (const [x, yPos, vx, vy] of STATES) {
      const y = new Float64Array([x, yPos, vx, vy]);

      model.jacobian!(t, y, out);
      const fd = centralDifferenceJacobian(fdModel, t, y, fdCtx);

      for (let i = 0; i < DIM * DIM; i++) {
        expect(out[i]!, `entry ${i} at state (${x},${yPos},${vx},${vy})`).toBeCloseTo(fd[i]!, 7);
      }
    }
  });

  it("degrades gracefully (zero drag block) at v_rel = 0", () => {
    const { ctx } = buildScenario();
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()], ctx);
    const y = new Float64Array([0, 0, 0, 0]);
    const out = new Float64Array(DIM * DIM);

    model.jacobian!(0, y, out);

    expect(out[2 * DIM + 2]).toBe(0);
    expect(out[2 * DIM + 3]).toBe(0);
    expect(out[3 * DIM + 2]).toBe(0);
    expect(out[3 * DIM + 3]).toBe(0);
    // Kinematic rows are unaffected.
    expect(out[0 * DIM + 2]).toBe(1);
    expect(out[1 * DIM + 3]).toBe(1);
  });

  it("streamwise eigenvalue is double the crosswise rate (§4.6, eq. 4.12)", () => {
    const { ctx } = buildScenario();
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()], ctx);
    const u = 40; // pure +x motion, no wind => u_rel aligned with x-axis
    const y = new Float64Array([0, 0, u, 0]);
    const out = new Float64Array(DIM * DIM);

    model.jacobian!(0, y, out);

    const streamwise = out[2 * DIM + 2]!; // d(v_x_dot)/d(v_x)
    const crosswise = out[3 * DIM + 3]!; // d(v_y_dot)/d(v_y)
    expect(streamwise).toBeCloseTo(2 * crosswise, 10);
    expect(out[2 * DIM + 3]).toBeCloseTo(0, 10); // off-diagonal vanishes when u_y = 0
    expect(out[3 * DIM + 2]).toBeCloseTo(0, 10);
  });
});
