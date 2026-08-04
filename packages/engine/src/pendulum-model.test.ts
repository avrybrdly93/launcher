import { describe, expect, it } from "vitest";
import { createPendulumModel, pendulumEnergy, PENDULUM_CHANNELS } from "./pendulum-model.js";
import type { Model } from "./model.js";

/**
 * Complete elliptic integral of the first kind K(k) via the AGM (Gauss's
 * arithmetic-geometric mean) iteration: K(k) = pi / (2*agm(1, sqrt(1-k^2))).
 * Quadratically convergent -- a handful of iterations already exceeds the
 * double-precision floor, far past the 1e-6 this test needs.
 */
function completeEllipticK(k: number): number {
  let a = 1;
  let b = Math.sqrt(1 - k * k);
  for (let i = 0; i < 20; i++) {
    const aNext = (a + b) / 2;
    const bNext = Math.sqrt(a * b);
    if (Math.abs(aNext - bNext) < 1e-16) {
      a = aNext;
      break;
    }
    a = aNext;
    b = bNext;
  }
  return Math.PI / (2 * a);
}

/** Exact period-vs-amplitude reference for a simple pendulum (large-angle). */
function referencePeriod(L: number, g: number, theta0: number): number {
  return 4 * Math.sqrt(L / g) * completeEllipticK(Math.sin(theta0 / 2));
}

function rk4Step(model: Model, t: number, y: Float64Array, h: number): Float64Array {
  const dim = model.dim;
  const k1 = new Float64Array(dim);
  const k2 = new Float64Array(dim);
  const k3 = new Float64Array(dim);
  const k4 = new Float64Array(dim);
  const tmp = new Float64Array(dim);
  const out = new Float64Array(dim);

  model.rhs(t, y, k1, undefined as never);
  for (let i = 0; i < dim; i++) tmp[i] = y[i]! + (h / 2) * k1[i]!;
  model.rhs(t + h / 2, tmp, k2, undefined as never);
  for (let i = 0; i < dim; i++) tmp[i] = y[i]! + (h / 2) * k2[i]!;
  model.rhs(t + h / 2, tmp, k3, undefined as never);
  for (let i = 0; i < dim; i++) tmp[i] = y[i]! + h * k3[i]!;
  model.rhs(t + h, tmp, k4, undefined as never);

  for (let i = 0; i < dim; i++) {
    out[i] = y[i]! + (h / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
  }
  return out;
}

/**
 * Numerically measures the pendulum's full period by releasing it from rest
 * at theta0 and finding the first time thetadot returns to zero (half a
 * period, at theta=-theta0), then doubling it. The half-period crossing is
 * bracketed with a coarse RK4 sweep and then bisected -- each bisection
 * probe re-integrates from the last known-good state with a single RK4 step
 * sized to land exactly on the probe time -- so the reported time is not
 * limited by interpolation error, only by RK4's O(h^4) discretization error
 * over a handful of steps (negligible at the step sizes used here).
 */
function measurePeriod(L: number, g: number, theta0: number): number {
  const model = createPendulumModel(L, g);
  const smallAngleEstimate = 2 * Math.PI * Math.sqrt(L / g);
  const h = smallAngleEstimate / 2000;

  let t = 0;
  let y: Float64Array = new Float64Array([theta0, 0]);
  let tPrev = t;
  let yPrev: Float64Array = y;

  for (let i = 0; i < 200_000; i++) {
    const yNext = rk4Step(model, t, y, h);
    const tNext = t + h;
    if (i > 0 && y[1]! < 0 && yNext[1]! >= 0) {
      tPrev = t;
      yPrev = y;
      t = tNext;
      y = yNext;
      break;
    }
    tPrev = t;
    yPrev = y;
    t = tNext;
    y = yNext;
  }

  let lo = tPrev;
  let loY: Float64Array = yPrev;
  let hi = t;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const midY = rk4Step(model, lo, loY, mid - lo);
    if (midY[1]! < 0) {
      lo = mid;
      loY = midY;
    } else {
      hi = mid;
    }
  }

  const tHalf = (lo + hi) / 2;
  return 2 * tHalf;
}

describe("createPendulumModel", () => {
  it("declares dim=2 with the [theta, thetadot] channels", () => {
    const model = createPendulumModel(1, 9.81);
    expect(model.dim).toBe(2);
    expect(model.channels).toBe(PENDULUM_CHANNELS);
    expect(model.channels.map((c) => c.name)).toEqual(["theta", "thetadot"]);
  });

  it("rhs matches thetadotdot = -(g/L)*sin(theta) at several states", () => {
    const L = 1.5;
    const g = 9.81;
    const model = createPendulumModel(L, g);
    const out = new Float64Array(2);
    for (const [theta, thetadot] of [
      [0, 0],
      [0.3, 1.2],
      [Math.PI / 2, -0.5],
      [-2.1, 0.9],
    ] as const) {
      model.rhs(0, new Float64Array([theta, thetadot]), out, undefined as never);
      expect(out[0]).toBe(thetadot);
      expect(out[1]).toBeCloseTo(-(g / L) * Math.sin(theta), 15);
    }
  });

  it("declares q/p partitions as [theta] / [thetadot]", () => {
    const model = createPendulumModel(1, 9.81);
    expect(model.partitions).toEqual({ q: [0], p: [1] });
  });

  it("declares a single H invariant equal to pendulumEnergy", () => {
    const L = 1;
    const g = 9.81;
    const model = createPendulumModel(L, g);
    expect(model.invariants).toHaveLength(1);
    const y = new Float64Array([0.7, -1.1]);
    expect(model.invariants![0]!.name).toBe("H");
    expect(model.invariants![0]!.evaluate(0, y, undefined as never)).toBeCloseTo(
      pendulumEnergy(y, L, g),
      15,
    );
  });

  it("H is conserved along an RK4-integrated trajectory to high precision", () => {
    const L = 1;
    const g = 9.81;
    const model = createPendulumModel(L, g);
    let t = 0;
    let y: Float64Array = new Float64Array([2.0, 0]);
    const h = 1e-4;
    const H0 = pendulumEnergy(y, L, g);
    for (let i = 0; i < 5000; i++) {
      y = rk4Step(model, t, y, h);
      t += h;
    }
    expect(pendulumEnergy(y, L, g)).toBeCloseTo(H0, 8);
  });

  it("period vs amplitude matches the elliptic-integral reference to 1e-6 (relative)", () => {
    const L = 1;
    const g = 9.81;
    for (const theta0 of [0.05, 0.5, 1.0, 2.0, 2.8]) {
      const measured = measurePeriod(L, g, theta0);
      const reference = referencePeriod(L, g, theta0);
      expect(Math.abs(measured - reference) / reference).toBeLessThan(1e-6);
    }
  });

  it("small-amplitude period matches the linearized 2*pi*sqrt(L/g) limit", () => {
    const L = 1;
    const g = 9.81;
    const measured = measurePeriod(L, g, 0.001);
    expect(measured).toBeCloseTo(2 * Math.PI * Math.sqrt(L / g), 4);
  });
});
