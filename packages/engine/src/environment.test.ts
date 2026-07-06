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
} from "./environment.js";
import { EARTH_RADIUS_M, G_STD, ISA } from "./units.js";

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
  it("rho(0) = rho0 exactly", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, 0, out);
    expect(out.rho).toBe(ISA.rho0);
  });

  it("rho(H) = rho0/e to 1e-15", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, ISA.scaleHeight, out);
    const expected = ISA.rho0 / Math.E;
    expect(Math.abs(out.rho - expected) / expected).toBeLessThan(1e-15);
  });

  it("pressure decays with the same exponential factor as density", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, ISA.scaleHeight, out);
    expect(out.p / ISA.p0).toBeCloseTo(out.rho / ISA.rho0, 15);
  });

  it("holds temperature and speed of sound fixed (isothermal approximation)", () => {
    const atm = new ExponentialAtmosphere();
    const outLow = new EnvSample();
    const outHigh = new EnvSample();
    atm.sample(0, 0, outLow);
    atm.sample(0, 20000, outHigh);
    expect(outHigh.T).toBe(outLow.T);
    expect(outHigh.c).toBe(outLow.c);
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

describe("UniformWind", () => {
  it("w is constant everywhere (over t, x, y)", () => {
    const wind = new UniformWind(3.5, -1.2);
    const out = new EnvSample();
    for (const [t, x, y] of [
      [0, 0, 0],
      [10, -50, 200],
      [1e6, 1e3, -1e3],
    ]) {
      wind.sample(t!, x!, y!, out);
      expect(out.wx).toBe(3.5);
      expect(out.wy).toBe(-1.2);
    }
  });

  it("defaults wy to 0", () => {
    const wind = new UniformWind(7);
    const out = new EnvSample();
    wind.sample(0, 0, 0, out);
    expect(out.wx).toBe(7);
    expect(out.wy).toBe(0);
  });
});

describe("LogProfileWind", () => {
  it("w(y_r*(e-1)) * kappa/uStar = 1", () => {
    const uStar = 0.5;
    const roughnessLength = 0.01;
    const wind = new LogProfileWind(uStar, roughnessLength);
    const out = new EnvSample();
    const KAPPA = 0.41;
    const y = roughnessLength * (Math.E - 1);
    wind.sample(0, 0, y, out);
    expect((out.wx * KAPPA) / uStar).toBeCloseTo(1, 12);
  });

  it("is finite (and zero) at y = 0", () => {
    const wind = new LogProfileWind(0.5);
    const out = new EnvSample();
    wind.sample(0, 0, 0, out);
    expect(Number.isFinite(out.wx)).toBe(true);
    expect(out.wx).toBe(0);
  });

  it("stays finite for y below ground (clamped)", () => {
    const wind = new LogProfileWind(0.5);
    const out = new EnvSample();
    wind.sample(0, 0, -5, out);
    expect(Number.isFinite(out.wx)).toBe(true);
    expect(out.wx).toBe(0);
  });

  it("wind speed increases monotonically with height", () => {
    const wind = new LogProfileWind(0.5);
    const out = new EnvSample();
    const heights = [0.01, 0.1, 1, 10, 100];
    let previous = -Infinity;
    for (const y of heights) {
      wind.sample(0, 0, y, out);
      expect(out.wx).toBeGreaterThan(previous);
      previous = out.wx;
    }
  });
});

describe("SinusoidalGustWind", () => {
  it("matches w(t) = mean + amplitude*sin(omega*t + phase) at sampled t", () => {
    const mean = 5;
    const amplitude = 2;
    const omega = 0.7;
    const phase = 0.3;
    const wind = new SinusoidalGustWind(mean, amplitude, omega, phase);
    const out = new EnvSample();

    for (const t of [0, 1, 2.5, 10, 100]) {
      wind.sample(t, 0, 0, out);
      const expected = mean + amplitude * Math.sin(omega * t + phase);
      expect(out.wx).toBeCloseTo(expected, 14);
      expect(out.wy).toBe(0);
    }
  });

  it("defaults phase to 0", () => {
    const wind = new SinusoidalGustWind(0, 1, 1);
    const out = new EnvSample();
    wind.sample(0, 0, 0, out);
    expect(out.wx).toBe(0); // sin(0) = 0
  });
});

describe("GaussianVortexWind", () => {
  it("is finite (and zero) at the vortex center", () => {
    const wind = new GaussianVortexWind(10, 0.5);
    const out = new EnvSample();
    wind.sample(0, 0, 0, out);
    expect(Number.isFinite(out.wx)).toBe(true);
    expect(Number.isFinite(out.wy)).toBe(true);
    expect(out.wx).toBeCloseTo(0, 15);
    expect(out.wy).toBeCloseTo(0, 15);
  });

  it("flow is purely tangential (w . r_hat = 0) off-center", () => {
    const wind = new GaussianVortexWind(10, 0.5, 1, 2);
    const out = new EnvSample();
    const dx = 0.8;
    const dy = -1.3;
    wind.sample(0, 1 + dx, 2 + dy, out);
    expect(out.wx * dx + out.wy * dy).toBeCloseTo(0, 12);
  });

  it("circulation integral on a ring a few core radii out ≈ Gamma to 1% (numeric quadrature)", () => {
    const circulation = 10; // m^2/s
    const coreRadius = 0.5;
    const wind = new GaussianVortexWind(circulation, coreRadius, 0, 0);
    const out = new EnvSample();
    const r = 5 * coreRadius;
    const n = 2000;

    let circ = 0;
    for (let i = 0; i < n; i++) {
      const theta0 = (2 * Math.PI * i) / n;
      const theta1 = (2 * Math.PI * (i + 1)) / n;
      const thetaMid = (theta0 + theta1) / 2;
      wind.sample(0, r * Math.cos(thetaMid), r * Math.sin(thetaMid), out);
      const dx = r * (Math.cos(theta1) - Math.cos(theta0));
      const dy = r * (Math.sin(theta1) - Math.sin(theta0));
      circ += out.wx * dx + out.wy * dy;
    }

    expect(Math.abs(circ - circulation) / circulation).toBeLessThan(0.01);
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
