import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  UniformWind,
  ZeroWind,
  createEvalContext,
  createSpatialProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { integrate } from "./integrate.js";

/**
 * P4.25 (blueprint §8.2): "Crosswind 3D scenario + lateral-drift validation
 * vs small-perturbation estimate", validation criterion "drift within 10% of
 * linearized prediction at small w_z".
 *
 * Derivation of the linearized (first-order-in-w_z) prediction: write
 * w_z = eps and expand the true trajectory in powers of eps. At eps=0, the
 * spatial model's own z0=vz0=0 z-slice tests (spatial-projectile-model.test.ts)
 * already prove z(t) stays exactly 0 -- the baseline (x, y, vx, vy) motion is
 * the ordinary 2D quadratic-drag trajectory and is *independent of eps to
 * first order*, because u_z = vz - eps is O(eps) and so contributes only
 * O(eps^2) to the drag speed |u| = hypot(ux, uy, uz) that determines Cd/Re/
 * Mach and every x/y force. Writing vz(t) = eps*zeta(t) + O(eps^2), the
 * z-momentum equation m*dvz/dt = -k(t)*|u|*(vz - eps) (k = 0.5*rho*Cd*A)
 * linearizes to the *scalar, time-varying-coefficient* ODE
 *
 *   dzeta/dt = -beta(t) * (zeta - 1),   beta(t) = k(t)*|u0(t)| / m,   zeta(0) = 0
 *   dz_lin/dt = eps * zeta(t),          z_lin(0) = 0
 *
 * where beta(t) is evaluated along the *baseline* (eps=0) 2D trajectory --
 * exactly the same quadratic-drag deceleration rate that already governs
 * ux/uy's own decay, just applied to the lateral channel. This is a genuine
 * tangent-linearization (the same "extra scalar state integrated alongside
 * the main trajectory" shape P4.07/P4.10's spin-decay companion state
 * already uses in this codebase), not a heuristic, and z_lin(T) is what
 * "linearized prediction" means below: it is computed independently of
 * `createSpatialProjectileModel`, using its own small fixed-step RK4 driving
 * the coupled 6-state system (x, y, vx, vy, zeta, z_lin) with beta(t) read
 * off that same integration's own (ux, uy) at each stage -- no call into the
 * production 3D rhs at all.
 */
function crosswindLinearizedDrift(
  mass: number,
  radius: number,
  area: number,
  cd: ConstantCd,
  rho: number,
  g: number,
  wz: number,
  x0: number,
  y0: number,
  vx0: number,
  vy0: number,
  h: number,
  steps: number,
): number {
  // State: [x, y, vx, vy, zeta, zLin]
  const cdValue = cd.cd(0, 0); // ConstantCd ignores (re, mach) -- see drag-coefficient.ts
  const k = 0.5 * rho * cdValue * area;

  function rhs(y: Float64Array, out: Float64Array): void {
    const vx = y[2]!;
    const vy = y[3]!;
    const zeta = y[4]!;
    const speed = Math.hypot(vx, vy); // baseline (eps=0) relative speed |u0(t)|; wx=wy=0 here
    const beta = (k * speed) / mass;
    out[0] = vx;
    out[1] = vy;
    out[2] = (-k * speed * vx) / mass;
    out[3] = (-k * speed * vy) / mass - g;
    out[4] = -beta * (zeta - 1);
    out[5] = wz * zeta;
  }

  let y = new Float64Array([x0, y0, vx0, vy0, 0, 0]);
  const k1 = new Float64Array(6);
  const k2 = new Float64Array(6);
  const k3 = new Float64Array(6);
  const k4 = new Float64Array(6);
  const tmp = new Float64Array(6);

  for (let s = 0; s < steps; s++) {
    rhs(y, k1);
    for (let i = 0; i < 6; i++) tmp[i] = y[i]! + (h / 2) * k1[i]!;
    rhs(tmp, k2);
    for (let i = 0; i < 6; i++) tmp[i] = y[i]! + (h / 2) * k2[i]!;
    rhs(tmp, k3);
    for (let i = 0; i < 6; i++) tmp[i] = y[i]! + h * k3[i]!;
    rhs(tmp, k4);

    const next = new Float64Array(6);
    for (let i = 0; i < 6; i++) {
      next[i] = y[i]! + (h / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
    }
    y = next;
  }

  return y[5]!; // z_lin(T)
}

/** Actual simulated lateral position at t=tEnd under a small constant crosswind `wz`, integrated well short of ground impact (so tFinal===tEnd exactly, no event truncation). */
function simulateCrosswindZ(
  mass: number,
  radius: number,
  cd: ConstantCd,
  wz: number,
  v0: number,
  theta: number,
  tEnd: number,
): number {
  const env = new Environment(
    new ConstantAtmosphere(),
    new UniformGravity(),
    new UniformWind(0, 0, wz),
  );
  const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
  const ctx = createEvalContext(env, params);
  const model = createSpatialProjectileModel([new GravityForce(), new QuadraticDragForce()]);

  const y0 = new Float64Array([0, 0, 0, v0 * Math.cos(theta), v0 * Math.sin(theta), 0]);
  const stepper = createDormandPrince54Stepper();
  const report = integrate(
    model,
    ctx,
    y0,
    [0, tEnd],
    { stepper: stepper.info.id, rtol: 1e-12, atol: 1e-13, maxSteps: 200_000 },
    stepper,
  );

  expect(report.status).toBe("ok");
  expect(report.tFinal).toBe(tEnd); // never truncated by the ground-impact event
  return report.yFinal[2]!; // z channel
}

describe("crosswind 3D scenario + lateral-drift validation vs small-perturbation estimate (P4.25, §8.2)", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const area = Math.PI * radius * radius;
  const rho = 1.225; // ConstantAtmosphere's ISA sea-level rho0
  const cd = new ConstantCd(0.47);
  const v0 = 40;
  const theta = (30 * Math.PI) / 180;
  const tEnd = 1.0; // well before apex/impact at v0=40, theta=30deg (time to apex ~= 2s)

  it("drift within 10% of the linearized prediction at small w_z (validation criterion)", () => {
    const wz = 0.5; // ~1.25% of v0: a genuinely "small" perturbation

    const actual = simulateCrosswindZ(mass, radius, cd, wz, v0, theta, tEnd);
    const linearized = crosswindLinearizedDrift(
      mass,
      radius,
      area,
      cd,
      rho,
      9.80665,
      wz,
      0,
      0,
      v0 * Math.cos(theta),
      v0 * Math.sin(theta),
      0.0005,
      2000,
    );

    expect(Math.abs(actual - linearized) / Math.abs(linearized)).toBeLessThan(0.1);
  });

  it("drift is in the same direction as the crosswind (positive wz -> positive z)", () => {
    const zPositive = simulateCrosswindZ(mass, radius, cd, 0.5, v0, theta, tEnd);
    const zNegative = simulateCrosswindZ(mass, radius, cd, -0.5, v0, theta, tEnd);
    expect(zPositive).toBeGreaterThan(0);
    expect(zNegative).toBeLessThan(0);
    expect(zNegative).toBeCloseTo(-zPositive, 6); // odd symmetry: quadratic drag's dependence on wz is linear at this order
  });

  it("drift scales linearly with w_z in the small-perturbation regime (halving w_z halves the drift)", () => {
    const zFull = simulateCrosswindZ(mass, radius, cd, 0.4, v0, theta, tEnd);
    const zHalf = simulateCrosswindZ(mass, radius, cd, 0.2, v0, theta, tEnd);
    expect(Math.abs(zHalf / zFull - 0.5)).toBeLessThan(0.02);
  });

  it("with w_z=0 (ZeroWind), lateral drift is exactly zero -- the eps=0 baseline this task's linearization expands around", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    const ctx = createEvalContext(env, params);
    const model = createSpatialProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const y0 = new Float64Array([0, 0, 0, v0 * Math.cos(theta), v0 * Math.sin(theta), 0]);
    const stepper = createDormandPrince54Stepper();
    const report = integrate(
      model,
      ctx,
      y0,
      [0, tEnd],
      { stepper: stepper.info.id, rtol: 1e-12, atol: 1e-13, maxSteps: 200_000 },
      stepper,
    );
    expect(report.yFinal[2]).toBe(0);
  });
});
