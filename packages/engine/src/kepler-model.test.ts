import { describe, expect, it } from "vitest";
import {
  createKeplerModel,
  keplerAngularMomentum,
  keplerEnergy,
  KEPLER_CHANNELS,
} from "./kepler-model.js";
import type { Model } from "./model.js";

const MU = 3.986e14; // Earth's standard gravitational parameter, m^3/s^2.

/** Evaluates the model rhs at (t, y) and returns a fresh derivative vector. */
function deriv(model: Model, t: number, y: Float64Array): Float64Array {
  const out = new Float64Array(model.dim);
  model.rhs(t, y, out, undefined as never);
  return out;
}

/**
 * Periapsis state of an ellipse of semi-major axis `a` and eccentricity `e`,
 * placed with periapsis on the +x axis and motion counter-clockwise. At
 * periapsis r = a(1-e) and the velocity is purely tangential, with magnitude
 * from vis-viva v^2 = mu(2/r - 1/a).
 */
function periapsisState(a: number, e: number, mu: number): Float64Array {
  const r = a * (1 - e);
  const v = Math.sqrt(mu * (2 / r - 1 / a));
  return new Float64Array([r, 0, 0, v]);
}

describe("KEPLER_CHANNELS", () => {
  it("names and dimensions the four planar state channels", () => {
    expect(KEPLER_CHANNELS.map((c) => c.name)).toEqual(["rx", "ry", "vx", "vy"]);
    expect(KEPLER_CHANNELS.map((c) => c.unit)).toEqual(["m", "m", "m/s", "m/s"]);
  });
});

describe("createKeplerModel", () => {
  it("declares dim 4, the channel metadata, and index-paired q/p partitions", () => {
    const model = createKeplerModel(MU);
    expect(model.dim).toBe(4);
    expect(model.channels).toBe(KEPLER_CHANNELS);
    expect(model.partitions).toEqual({ q: [0, 1], p: [2, 3] });
  });

  it("rejects a non-positive mu rather than silently producing a repulsive or null field", () => {
    expect(() => createKeplerModel(0)).toThrow(/positive mu/);
    expect(() => createKeplerModel(-MU)).toThrow(/positive mu/);
    expect(() => createKeplerModel(Number.NaN)).toThrow(/positive mu/);
  });

  it("copies velocity into the position derivative", () => {
    const model = createKeplerModel(MU);
    const d = deriv(model, 0, new Float64Array([7e6, 1e6, -300, 7500]));
    expect(d[0]).toBe(-300);
    expect(d[1]).toBe(7500);
  });

  it("accelerates toward the primary with magnitude mu/r^2", () => {
    const model = createKeplerModel(MU);
    const rx = 5e6;
    const ry = -1.2e7;
    const r = Math.hypot(rx, ry);
    const d = deriv(model, 0, new Float64Array([rx, ry, 0, 0]));

    const magnitude = Math.hypot(d[2]!, d[3]!);
    expect(magnitude).toBeCloseTo(MU / (r * r), 12);

    // Anti-parallel to r: the unit acceleration is exactly -r/|r|.
    expect(d[2]! / magnitude).toBeCloseTo(-rx / r, 12);
    expect(d[3]! / magnitude).toBeCloseTo(-ry / r, 12);
  });

  it("is time-invariant (autonomous): t never enters the rhs", () => {
    const model = createKeplerModel(MU);
    const y = new Float64Array([7e6, 2e6, -400, 6800]);
    expect(Array.from(deriv(model, 0, y))).toEqual(Array.from(deriv(model, 12345.678, y)));
  });

  it("exposes exactly the energy and angular-momentum invariants", () => {
    const model = createKeplerModel(MU);
    expect(model.invariants?.map((i) => i.name)).toEqual(["E", "L"]);

    const y = periapsisState(1e7, 0.6, MU);
    const [energy, angMom] = model.invariants!;
    expect(energy!.evaluate(0, y, undefined as never)).toBeCloseTo(keplerEnergy(y, MU), 12);
    expect(angMom!.evaluate(0, y, undefined as never)).toBeCloseTo(keplerAngularMomentum(y), 12);
  });
});

describe("keplerEnergy", () => {
  it("matches -mu/(2a) on an elliptic orbit, independent of where on the orbit it is sampled", () => {
    const a = 1.2e7;
    const model = createKeplerModel(MU);
    const expected = -MU / (2 * a);

    for (const e of [0, 0.3, 0.7, 0.95]) {
      const peri = periapsisState(a, e, MU);
      // Apoapsis of the same ellipse: opposite side, tangential velocity again.
      const rApo = a * (1 + e);
      const vApo = Math.sqrt(MU * (2 / rApo - 1 / a));
      const apo = new Float64Array([-rApo, 0, 0, -vApo]);

      expect(keplerEnergy(peri, MU) / expected).toBeCloseTo(1, 10);
      expect(keplerEnergy(apo, MU) / expected).toBeCloseTo(1, 10);
      expect(model.invariants![0]!.evaluate(0, apo, undefined as never) / expected).toBeCloseTo(
        1,
        10,
      );
    }
  });

  it("is negative for a bound orbit, zero at escape speed, positive above it", () => {
    const r = 8e6;
    const vEscape = Math.sqrt((2 * MU) / r);
    expect(keplerEnergy(new Float64Array([r, 0, 0, 0.5 * vEscape]), MU)).toBeLessThan(0);
    expect(keplerEnergy(new Float64Array([r, 0, 0, vEscape]), MU)).toBeCloseTo(0, 6);
    expect(keplerEnergy(new Float64Array([r, 0, 0, 1.5 * vEscape]), MU)).toBeGreaterThan(0);
  });
});

describe("keplerAngularMomentum", () => {
  it("matches sqrt(mu*a*(1-e^2)) on an elliptic orbit", () => {
    const a = 1.2e7;
    for (const e of [0, 0.3, 0.7, 0.95]) {
      const expected = Math.sqrt(MU * a * (1 - e * e));
      expect(keplerAngularMomentum(periapsisState(a, e, MU))).toBeCloseTo(expected, 4);
    }
  });

  it("vanishes on a purely radial (degenerate) trajectory and flips sign with the orbit direction", () => {
    expect(keplerAngularMomentum(new Float64Array([7e6, 0, -1200, 0]))).toBe(0);

    const prograde = periapsisState(1e7, 0.5, MU);
    const retrograde = new Float64Array([prograde[0]!, prograde[1]!, -prograde[2]!, -prograde[3]!]);
    expect(keplerAngularMomentum(retrograde)).toBeCloseTo(-keplerAngularMomentum(prograde), 6);
  });
});

describe("continuous-flow conservation (analytic, not integrated)", () => {
  /**
   * Both invariants are conserved by the exact flow, so their material
   * derivative along the rhs must vanish identically -- at any state, not
   * just on a special orbit. This checks the model's *own* consistency
   * (dE/dt = v.a + mu*(r.v)/|r|^3 and dL/dt = rx*ay - ry*ax) without any
   * integrator in the loop, isolating a model bug from a stepper bug before
   * SolverKit's drift comparison runs.
   */
  const states: readonly (readonly number[])[] = [
    [7e6, 0, 0, 8200],
    [4e6, -9e6, 1500, 600],
    [-1.1e7, 3e6, -2400, -5100],
    [2e6, 2e6, 9000, -1000],
  ];

  it("has zero dE/dt along the rhs at every sampled state", () => {
    const model = createKeplerModel(MU);
    for (const raw of states) {
      const y = new Float64Array(raw);
      const d = deriv(model, 0, y);
      const r = Math.hypot(y[0]!, y[1]!);
      // dE/dt = v.a  +  d/dt(-mu/r) = v.a + mu*(r.v)/|r|^3
      const kineticRate = y[2]! * d[2]! + y[3]! * d[3]!;
      const potentialRate = (MU * (y[0]! * y[2]! + y[1]! * y[3]!)) / (r * r * r);
      const scale = Math.abs(kineticRate) + Math.abs(potentialRate) + 1;
      expect((kineticRate + potentialRate) / scale).toBeCloseTo(0, 12);
    }
  });

  it("has zero dL/dt along the rhs at every sampled state (central force)", () => {
    const model = createKeplerModel(MU);
    for (const raw of states) {
      const y = new Float64Array(raw);
      const d = deriv(model, 0, y);
      // dL/dt = (rx*vy - ry*vx)' = rx*ay - ry*ax (the velocity cross terms cancel).
      const dLdt = y[0]! * d[3]! - y[1]! * d[2]!;
      const scale = Math.abs(y[0]! * d[3]!) + Math.abs(y[1]! * d[2]!) + 1;
      expect(dLdt / scale).toBeCloseTo(0, 12);
    }
  });
});
