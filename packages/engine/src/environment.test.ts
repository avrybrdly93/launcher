import { describe, expect, it } from "vitest";
import { EnvSample } from "./env-sample.js";
import {
  ConstantAtmosphere,
  Environment,
  ExponentialAtmosphere,
  GaussianVortexWind,
  LogProfileWind,
  SinusoidalGustWind,
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

describe("SinusoidalGustWind", () => {
  it("matches wbar + A*sin(Omega*t + phi) at sampled t", () => {
    const wbar = 4;
    const A = 2.5;
    const Omega = 0.7;
    const phi = 0.3;
    const wind = new SinusoidalGustWind(wbar, A, Omega, phi);
    const out = new EnvSample();
    for (const t of [0, 1, 2.5, 10, 100]) {
      wind.sample(t, 0, 0, out);
      expect(out.wx).toBeCloseTo(wbar + A * Math.sin(Omega * t + phi), 12);
      expect(out.wy).toBe(0);
    }
  });
});

describe("GaussianVortexWind", () => {
  it("circulation integral on a ring >> core radius matches Gamma to 1% (numeric quadrature)", () => {
    const gamma = 10;
    const coreRadius = 1;
    const wind = new GaussianVortexWind(0, 0, gamma, coreRadius);
    const R = 5 * coreRadius;
    const n = 10000;
    let circulation = 0;
    const out = new EnvSample();
    for (let i = 0; i < n; i++) {
      const theta = (2 * Math.PI * i) / n;
      const x = R * Math.cos(theta);
      const y = R * Math.sin(theta);
      wind.sample(0, x, y, out);
      // dl for a CCW ring parametrized by theta: R*dtheta*(-sin(theta), cos(theta))
      const dTheta = (2 * Math.PI) / n;
      const dlx = -R * Math.sin(theta) * dTheta;
      const dly = R * Math.cos(theta) * dTheta;
      circulation += out.wx * dlx + out.wy * dly;
    }
    expect(Math.abs(circulation - gamma) / gamma).toBeLessThan(0.01);
  });

  it("vanishes smoothly (no NaN) at the vortex center", () => {
    const wind = new GaussianVortexWind(3, -2, 10, 1);
    const out = new EnvSample();
    wind.sample(0, 3, -2, out);
    expect(out.wx).toBe(0);
    expect(out.wy).toBe(0);
  });

  it("tangential speed vanishes as r -> 0 and approaches Gamma/(2*pi*r) for r >> core", () => {
    const gamma = 10;
    const coreRadius = 0.5;
    const wind = new GaussianVortexWind(0, 0, gamma, coreRadius);
    const out = new EnvSample();
    wind.sample(0, 0.001, 0, out);
    const speedNearCenter = Math.hypot(out.wx, out.wy);
    expect(speedNearCenter).toBeLessThan(0.1);

    const rFar = 10 * coreRadius;
    wind.sample(0, rFar, 0, out);
    const speedFar = Math.hypot(out.wx, out.wy);
    expect(speedFar).toBeCloseTo(gamma / (2 * Math.PI * rFar), 6);
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
