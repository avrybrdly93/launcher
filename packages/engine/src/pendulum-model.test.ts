import { describe, expect, it } from "vitest";
import { createPendulumModel, pendulumHamiltonian, PENDULUM_CHANNELS } from "./pendulum-model.js";
import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";
import { G_STD } from "./units.js";

// -- Structural checks -------------------------------------------------

describe("createPendulumModel", () => {
  it("dim/channels/partitions match the [theta, omega] state layout", () => {
    const model = createPendulumModel({ length: 1 });
    expect(model.dim).toBe(2);
    expect(model.channels).toBe(PENDULUM_CHANNELS);
    expect(model.channels.map((c) => c.name)).toEqual(["theta", "omega"]);
    expect(model.partitions).toEqual({ q: [0], p: [1] });
  });

  it("rhs matches the hand-derived nonlinear pendulum equation theta'=omega, omega'=-(g/L)sin(theta)", () => {
    const length = 2.5;
    const gravity = 9.80665;
    const model = createPendulumModel({ length, gravity });
    const ctx = {} as EvalContext;
    const out = new Float64Array(2);

    for (const [theta, omega] of [
      [0, 0],
      [0.4, -1.2],
      [-1.1, 0.7],
      [Math.PI / 2, 0],
    ] as const) {
      const y = new Float64Array([theta, omega]);
      model.rhs(0, y, out, ctx);
      expect(out[0]).toBe(omega);
      expect(out[1]).toBeCloseTo(-(gravity / length) * Math.sin(theta), 12);
    }
  });

  it("rhs ignores ctx entirely -- no EvalContext dependency, unlike the projectile models", () => {
    const model = createPendulumModel({ length: 1 });
    const out = new Float64Array(2);
    // Passing an empty object where EvalContext is expected must not throw:
    // the whole point of a Stage-B "seed" model is it needs none of the
    // projectile-specific environment/params machinery.
    expect(() => model.rhs(0, new Float64Array([0.3, 0]), out, {} as EvalContext)).not.toThrow();
  });

  it("H invariant matches the hand-derived Hamiltonian at several sample states", () => {
    const length = 1.5;
    const gravity = 9.80665;
    const mass = 2;
    const model = createPendulumModel({ length, gravity, mass });
    const ctx = {} as EvalContext;
    const hInvariant = model.invariants!.find((inv) => inv.name === "H")!;
    expect(hInvariant).toBeDefined();

    for (const [theta, omega] of [
      [0, 0],
      [0.5, 1.3],
      [Math.PI / 3, -0.4],
    ] as const) {
      const y = new Float64Array([theta, omega]);
      const expected =
        0.5 * mass * length * length * omega * omega +
        mass * gravity * length * (1 - Math.cos(theta));
      expect(hInvariant.evaluate(0, y, ctx)).toBeCloseTo(expected, 12);
      expect(pendulumHamiltonian(y, length, gravity, mass)).toBeCloseTo(expected, 12);
    }
  });

  it("defaults gravity to G_STD and mass to 1", () => {
    const model = createPendulumModel({ length: 1 });
    const ctx = {} as EvalContext;
    const out = new Float64Array(2);
    model.rhs(0, new Float64Array([0.2, 0]), out, ctx);
    expect(out[1]).toBeCloseTo(-G_STD * Math.sin(0.2), 12);

    const hInvariant = model.invariants!.find((inv) => inv.name === "H")!;
    const y = new Float64Array([0.2, 0]);
    expect(hInvariant.evaluate(0, y, ctx)).toBeCloseTo(1 * G_STD * (1 - Math.cos(0.2)), 12);
  });
});

// -- Period-vs-amplitude validation against an independent elliptic-integral
// reference (P4.31's validation criterion) --------------------------------
//
// `packages/engine` may not depend on `@ballista/solverkit` (§2.1's
// layering, enforced by `.dependency-cruiser.cjs`: `engine`'s allowed deps
// are `[]` -- see `spatial-projectile-model.test.ts`'s precedent), so this
// file drives its own tiny fixed-step RK4 integrator plus a from-scratch
// bisection root-finder rather than importing DOPRI5/event detection from
// solverkit.

/** One classical RK4 step, mirroring `spatial-projectile-model.test.ts`'s precedent. */
function rk4Step(model: Model, ctx: EvalContext, t: number, y: Float64Array, h: number) {
  const dim = y.length;
  const k1 = new Float64Array(dim);
  const k2 = new Float64Array(dim);
  const k3 = new Float64Array(dim);
  const k4 = new Float64Array(dim);
  const tmp = new Float64Array(dim);

  model.rhs(t, y, k1, ctx);
  for (let i = 0; i < dim; i++) tmp[i] = y[i]! + (h / 2) * k1[i]!;
  model.rhs(t + h / 2, tmp, k2, ctx);
  for (let i = 0; i < dim; i++) tmp[i] = y[i]! + (h / 2) * k2[i]!;
  model.rhs(t + h / 2, tmp, k3, ctx);
  for (let i = 0; i < dim; i++) tmp[i] = y[i]! + h * k3[i]!;
  model.rhs(t + h, tmp, k4, ctx);

  const next = new Float64Array(dim);
  for (let i = 0; i < dim; i++) {
    next[i] = y[i]! + (h / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
  }
  return next;
}

/** Fixed-step RK4 from `tStart` to `tEnd` in `steps` equal substeps. */
function rk4Integrate(
  model: Model,
  ctx: EvalContext,
  y0: Float64Array,
  tStart: number,
  tEnd: number,
  steps: number,
) {
  let y = y0;
  let t = tStart;
  const h = (tEnd - tStart) / steps;
  for (let s = 0; s < steps; s++) {
    y = rk4Step(model, ctx, t, y, h);
    t += h;
  }
  return y;
}

const REFINE_SUBSTEPS = 30;
const REFINE_ITERATIONS = 50;

/**
 * Bisects `theta=0` between `(tLo, yLo)` and `tHi` (opposite-signed
 * `theta`), each trial midpoint evaluated by a fresh fine RK4 sub-
 * integration from the already-accurate `(tLo, yLo)` rather than by
 * interpolating -- so the localized root time's accuracy is limited only by
 * RK4's own O(h^4) integration error over a shrinking interval, not by any
 * separate interpolant.
 */
function refineThetaZeroCrossing(
  model: Model,
  ctx: EvalContext,
  tLo: number,
  yLo: Float64Array,
  tHi: number,
): number {
  let a = tLo;
  let ya = yLo;
  let b = tHi;

  for (let iter = 0; iter < REFINE_ITERATIONS; iter++) {
    const mid = (a + b) / 2;
    const yMid = rk4Integrate(model, ctx, ya, a, mid, REFINE_SUBSTEPS);
    if (Math.sign(yMid[0]!) === Math.sign(ya[0]!) || yMid[0] === 0) {
      a = mid;
      ya = yMid;
    } else {
      b = mid;
    }
  }
  return (a + b) / 2;
}

/**
 * Arithmetic-geometric mean, quadratically convergent -- converges to double
 * precision in well under 10 iterations for any `a, b > 0` (Abramowitz &
 * Stegun §17.6). Written from scratch here, sharing no code with
 * `pendulum-model.ts`, as the independent numerical building block for the
 * elliptic-integral reference below (this codebase's other analytic
 * references follow the same "never assume numerical correctness"
 * discipline, e.g. `analytic-references.ts`).
 */
function agm(a0: number, b0: number): number {
  let a = a0;
  let b = b0;
  for (let i = 0; i < 60; i++) {
    if (Math.abs(a - b) <= 1e-16 * Math.max(Math.abs(a), Math.abs(b), 1e-300)) break;
    const aNext = (a + b) / 2;
    const bNext = Math.sqrt(a * b);
    a = aNext;
    b = bNext;
  }
  return (a + b) / 2;
}

/**
 * Complete elliptic integral of the first kind, modulus `k` (not parameter
 * `m=k^2`): `K(k) = pi / (2*AGM(1, sqrt(1-k^2)))` (Abramowitz & Stegun
 * 17.6.4), the standard AGM evaluation -- accurate to machine precision for
 * any `k` in `[0, 1)`, unlike a truncated series which slows badly as
 * `k -> 1`.
 */
function ellipticK(k: number): number {
  return Math.PI / (2 * agm(1, Math.sqrt(1 - k * k)));
}

/**
 * Exact period of a simple pendulum released from rest at amplitude
 * `theta0` (standard large-amplitude pendulum result, e.g. Landau &
 * Lifshitz *Mechanics* §11 problem 1, or any classical-mechanics text):
 * `T = 4*sqrt(L/g) * K(sin(theta0/2))`. This is the independent reference
 * `pendulum-model.test.ts` validates the numerically-integrated model
 * against -- it shares no formula or code with `createPendulumModel`'s
 * `omega' = -(g/L) sin(theta)` rhs.
 */
function exactPendulumPeriod(length: number, gravity: number, theta0: number): number {
  const k = Math.sin(theta0 / 2);
  return 4 * Math.sqrt(length / gravity) * ellipticK(k);
}

const COARSE_STEPS = 4000;

/**
 * Numerically measures the pendulum's period at amplitude `theta0`: releases
 * from rest, coarse-scans forward with fixed-step RK4 to bracket the first
 * two `theta=0` crossings (each half a period apart), then localizes each to
 * near machine precision via {@link refineThetaZeroCrossing}. The coarse
 * horizon is sized off {@link exactPendulumPeriod} only to know how far to
 * scan -- the crossing times themselves are found purely by numerically
 * integrating `model.rhs`, independent of the elliptic-integral formula this
 * measurement is compared against below.
 */
function measurePeriod(length: number, gravity: number, theta0: number): number {
  const model = createPendulumModel({ length, gravity });
  const ctx = {} as EvalContext;
  const y0 = new Float64Array([theta0, 0]);

  const tFinal = 2.5 * exactPendulumPeriod(length, gravity, theta0);
  const h = tFinal / COARSE_STEPS;

  const crossings: number[] = [];
  let t = 0;
  let y = y0;
  for (let s = 0; s < COARSE_STEPS && crossings.length < 2; s++) {
    const tNext = t + h;
    const yNext = rk4Step(model, ctx, t, y, h);
    if (Math.sign(yNext[0]!) !== Math.sign(y[0]!)) {
      crossings.push(refineThetaZeroCrossing(model, ctx, t, y, tNext));
    }
    t = tNext;
    y = yNext;
  }

  if (crossings.length < 2) {
    throw new Error(`measurePeriod: expected 2 theta-zero crossings, found ${crossings.length}`);
  }
  // Consecutive theta=0 crossings are half a period apart (t ~ T/4, 3T/4).
  return 2 * (crossings[1]! - crossings[0]!);
}

describe("Pendulum period vs amplitude matches the elliptic-integral reference (P4.31 validation)", () => {
  const length = 1;
  const gravity = 9.80665;

  it.each([0.05, 0.2, 0.6, 1.0, 1.4, 1.8, 2.3])(
    "theta0=%f rad: numerically-integrated period matches T=4*sqrt(L/g)*K(sin(theta0/2)) to 1e-6 relative",
    (theta0) => {
      const expected = exactPendulumPeriod(length, gravity, theta0);
      const measured = measurePeriod(length, gravity, theta0);
      expect(Math.abs(measured / expected - 1)).toBeLessThan(1e-6);
    },
  );

  it("large-amplitude period exceeds the small-angle estimate 2*pi*sqrt(L/g), growing with amplitude", () => {
    const smallAngleT = 2 * Math.PI * Math.sqrt(length / gravity);
    const tAt1 = exactPendulumPeriod(length, gravity, 1.0);
    const tAt2_3 = exactPendulumPeriod(length, gravity, 2.3);
    expect(tAt1).toBeGreaterThan(smallAngleT);
    expect(tAt2_3).toBeGreaterThan(tAt1);
  });

  it("small-amplitude (theta0=0.05) period matches the small-angle estimate to within its own O(theta0^2) error", () => {
    const smallAngleT = 2 * Math.PI * Math.sqrt(length / gravity);
    const measured = measurePeriod(length, gravity, 0.05);
    // Leading correction is T ~ T0*(1 + theta0^2/16); at theta0=0.05 that's
    // ~1.6e-4 relative -- comfortably inside a 1e-3 band, tightly outside
    // the noise floor a bug (e.g. a sign error) would blow through.
    expect(Math.abs(measured / smallAngleT - 1)).toBeLessThan(1e-3);
  });
});
