import { describe, expect, it } from "vitest";
import { EnvSample } from "./env-sample.js";
import {
  ConstantAtmosphere,
  Environment,
  ExponentialAtmosphere,
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
    expect(out.rho).toBeCloseTo(ISA.rho0 / Math.E, 15);
  });

  it("is isothermal: T constant across altitude", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, 0, out);
    const T0 = out.T;
    atm.sample(0, 20000, out);
    expect(out.T).toBe(T0);
  });

  it("density decreases monotonically with altitude", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    let prevRho = Infinity;
    for (const y of [0, 1000, 5000, 10000, 20000]) {
      atm.sample(0, y, out);
      expect(out.rho).toBeLessThan(prevRho);
      prevRho = out.rho;
    }
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
  it("w is constant everywhere (space and time)", () => {
    const wind = new UniformWind(5, -2);
    const out = new EnvSample();
    for (const [t, x, y] of [
      [0, 0, 0],
      [10, 100, -50],
      [1e6, -1e3, 1e3],
    ] as const) {
      wind.sample(t, x, y, out);
      expect(out.wx).toBe(5);
      expect(out.wy).toBe(-2);
    }
  });

  it("defaults to zero wind", () => {
    const wind = new UniformWind();
    const out = new EnvSample();
    wind.sample(0, 0, 0, out);
    expect(out.wx).toBe(0);
    expect(out.wy).toBe(0);
  });
});

describe("LogProfileWind", () => {
  const KAPPA = 0.41;
  const uStar = 2;
  const yr = 0.01;

  it("w(y_r*(e-1)) * kappa/u* = 1 (eq. 3.13 spot check)", () => {
    const wind = new LogProfileWind(uStar, yr);
    const out = new EnvSample();
    wind.sample(0, 0, yr * (Math.E - 1), out);
    expect((out.wx * KAPPA) / uStar).toBeCloseTo(1, 12);
  });

  it("is finite (and zero) at y=0", () => {
    const wind = new LogProfileWind(uStar, yr);
    const out = new EnvSample();
    wind.sample(0, 0, 0, out);
    expect(Number.isFinite(out.wx)).toBe(true);
    expect(out.wx).toBe(0);
  });

  it("stays finite (guarded to the y=0 value) for y < 0", () => {
    const wind = new LogProfileWind(uStar, yr);
    const out = new EnvSample();
    for (const y of [-0.001, -yr, -1, -100]) {
      wind.sample(0, 0, y, out);
      expect(Number.isFinite(out.wx)).toBe(true);
      expect(out.wx).toBe(0);
    }
  });

  it("increases monotonically with height above ground", () => {
    const wind = new LogProfileWind(uStar, yr);
    const out = new EnvSample();
    let prev = -Infinity;
    for (const y of [0, 0.1, 1, 10, 100]) {
      wind.sample(0, 0, y, out);
      expect(out.wx).toBeGreaterThan(prev);
      prev = out.wx;
    }
  });

  it("has no vertical component", () => {
    const wind = new LogProfileWind(uStar, yr);
    const out = new EnvSample();
    wind.sample(0, 0, 5, out);
    expect(out.wy).toBe(0);
  });
});

describe("SinusoidalGustWind", () => {
  it("matches wBar + A*sin(omega*t + phase) at sampled t", () => {
    const wBar = 3;
    const amplitude = 2;
    const omega = 0.5;
    const phase = 0.7;
    const wind = new SinusoidalGustWind(wBar, amplitude, omega, phase);
    const out = new EnvSample();

    for (const t of [0, 1, 2.5, 10, -3]) {
      wind.sample(t, 0, 0, out);
      const expected = wBar + amplitude * Math.sin(omega * t + phase);
      expect(out.wx).toBeCloseTo(expected, 14);
      expect(out.wy).toBe(0);
    }
  });

  it("defaults phase to 0", () => {
    const wind = new SinusoidalGustWind(0, 5, 1);
    const out = new EnvSample();
    wind.sample(0, 0, 0, out);
    expect(out.wx).toBeCloseTo(0, 14); // sin(0) = 0
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
