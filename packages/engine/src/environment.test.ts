import { describe, expect, it } from "vitest";
import { EnvSample } from "./env-sample.js";
import {
  ConstantAtmosphere,
  Environment,
  ExponentialAtmosphere,
  LogProfileWind,
  UniformGravity,
  UniformWind,
  ZeroWind,
  sutherlandViscosity,
} from "./environment.js";
import { EARTH_RADIUS_M, G_STD, ISA, SUTHERLAND } from "./units.js";

describe("ConstantAtmosphere", () => {
  it("returns ISA sea-level density everywhere", () => {
    const atm = new ConstantAtmosphere();
    const out = new EnvSample();
    for (const y of [0, 100, 5000, -10]) {
      atm.sample(0, y, out);
      expect(out.rho).toBe(ISA.rho0);
    }
  });
});

describe("ExponentialAtmosphere", () => {
  it("rho(H) = rho0/e to 1e-15", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, ISA.scaleHeight, out);
    expect(out.rho).toBeCloseTo(ISA.rho0 / Math.E, 15);
  });

  it("rho(0) = rho0 exactly", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, 0, out);
    expect(out.rho).toBe(ISA.rho0);
  });

  it("p follows the same exponential as rho (isothermal ideal gas)", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, 3000, out);
    expect(out.p / ISA.p0).toBeCloseTo(out.rho / ISA.rho0, 15);
  });

  it("is isothermal: T constant with altitude", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, 0, out);
    const T0 = out.T;
    atm.sample(0, 5000, out);
    expect(out.T).toBe(T0);
  });
});

describe("sutherlandViscosity", () => {
  it("eta(288.15K) = 1.789e-5 to within 1%", () => {
    const eta = sutherlandViscosity(SUTHERLAND.Tref);
    expect(eta).toBeCloseTo(1.789e-5, 0);
    expect(Math.abs(eta - 1.789e-5) / 1.789e-5).toBeLessThan(0.01);
  });

  it("increases with temperature", () => {
    expect(sutherlandViscosity(350)).toBeGreaterThan(sutherlandViscosity(250));
  });
});

describe("UniformWind", () => {
  it("returns the same (wx, wy) everywhere regardless of t, x, y", () => {
    const wind = new UniformWind(5, -2);
    const out = new EnvSample();
    for (const [t, x, y] of [
      [0, 0, 0],
      [10, 100, -50],
      [1000, -1000, 1000],
    ]) {
      wind.sample(t!, x!, y!, out);
      expect(out.wx).toBe(5);
      expect(out.wy).toBe(-2);
    }
  });
});

describe("LogProfileWind", () => {
  const KAPPA = 0.41;

  it("w(y_r*(e-1))*kappa/u* = 1", () => {
    const uStar = 2.5;
    const yR = 0.01;
    const wind = new LogProfileWind(uStar, yR);
    const out = new EnvSample();
    wind.sample(0, 0, yR * (Math.E - 1), out);
    expect((out.wx * KAPPA) / uStar).toBeCloseTo(1, 12);
  });

  it("is finite (zero) at y=0", () => {
    const wind = new LogProfileWind(3, 0.01);
    const out = new EnvSample();
    wind.sample(0, 0, 0, out);
    expect(out.wx).toBe(0);
    expect(out.wy).toBe(0);
  });

  it("stays finite for y < 0 via the ground clamp", () => {
    const wind = new LogProfileWind(3, 0.01);
    const out = new EnvSample();
    wind.sample(0, 0, -5, out);
    expect(Number.isFinite(out.wx)).toBe(true);
    expect(out.wx).toBe(0); // clamped to y=0
  });

  it("increases with height (positive shear)", () => {
    const wind = new LogProfileWind(3, 0.01);
    const outLow = new EnvSample();
    const outHigh = new EnvSample();
    wind.sample(0, 0, 1, outLow);
    wind.sample(0, 0, 10, outHigh);
    expect(outHigh.wx).toBeGreaterThan(outLow.wx);
  });
});

describe("UniformGravity", () => {
  it("returns constant g by default", () => {
    const gravity = new UniformGravity();
    const out = new EnvSample();
    gravity.sample(0, 0, out);
    expect(out.g).toBe(G_STD);
    gravity.sample(0, 10000, out);
    expect(out.g).toBe(G_STD);
  });

  it("matches the altitude-corrected model (eq. 3.3) to 1e-12 when enabled", () => {
    const gravity = new UniformGravity(G_STD, true);
    const outAt0 = new EnvSample();
    const outAt100 = new EnvSample();
    gravity.sample(0, 0, outAt0);
    gravity.sample(0, 100, outAt100);
    const expectedRatio = (EARTH_RADIUS_M / (EARTH_RADIUS_M + 100)) ** 2;
    expect(outAt100.g / outAt0.g).toBeCloseTo(expectedRatio, 12);
  });
});

describe("Environment", () => {
  it("composes atmosphere + gravity + wind into one sample call", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const out = new EnvSample();
    env.sample(0, 0, 0, out);
    expect(out.rho).toBe(ISA.rho0);
    expect(out.g).toBe(G_STD);
    expect(out.wx).toBe(0);
    expect(out.wy).toBe(0);
  });

  it("samples the environment exactly once per call (spy count == 1)", () => {
    let atmosphereCalls = 0;
    const spyAtmosphere = {
      sample(x: number, y: number, out: EnvSample) {
        atmosphereCalls++;
        new ConstantAtmosphere().sample(x, y, out);
      },
    };
    const env = new Environment(spyAtmosphere, new UniformGravity());
    const out = new EnvSample();
    env.sample(0, 0, 0, out);
    expect(atmosphereCalls).toBe(1);
  });
});
