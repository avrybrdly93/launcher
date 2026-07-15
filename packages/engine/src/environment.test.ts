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
} from "./environment.js";
import { EARTH_RADIUS_M, G_STD, ISA, sutherlandViscosity } from "./units.js";

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
  it("rho(0) = rho0", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, 0, out);
    expect(out.rho).toBe(ISA.rho0);
  });

  it("rho(H) = rho0/e to 1e-15 (P1.27 validation criterion)", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, ISA.scaleHeight, out);
    const expected = ISA.rho0 / Math.E;
    expect(Math.abs(out.rho - expected)).toBeLessThan(1e-15);
  });

  it("is monotonically decreasing with altitude", () => {
    const atm = new ExponentialAtmosphere();
    const samples = [0, 1000, 5000, 10000].map((y) => {
      const out = new EnvSample();
      atm.sample(0, y, out);
      return out.rho;
    });
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeLessThan(samples[i - 1]!);
    }
  });

  it("is independent of x", () => {
    const atm = new ExponentialAtmosphere();
    const outA = new EnvSample();
    const outB = new EnvSample();
    atm.sample(0, 500, outA);
    atm.sample(999, 500, outB);
    expect(outB.rho).toBe(outA.rho);
  });

  it("keeps pressure consistent with the ideal gas law (p = rho*Rs*T)", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, 2000, out);
    expect(out.p).toBeCloseTo(out.rho * ISA.Rs * out.T, 8);
  });

  it("uses Sutherland viscosity at the isothermal T0", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, 3000, out);
    expect(out.eta).toBe(sutherlandViscosity(ISA.T0));
  });
});

describe("UniformWind", () => {
  it("is constant everywhere (P1.29 validation criterion)", () => {
    const wind = new UniformWind(5, -1.5);
    const out = new EnvSample();
    for (const [t, x, y] of [
      [0, 0, 0],
      [10, 100, -50],
      [-3, -1000, 2000],
    ] as const) {
      wind.sample(t, x, y, out);
      expect(out.wx).toBe(5);
      expect(out.wy).toBe(-1.5);
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

describe("LogProfileWind (eq. 3.13)", () => {
  it("w(yr*(e-1))*kappa/uStar = 1 (P1.30 validation criterion)", () => {
    const uStar = 0.5;
    const roughnessLength = 0.01;
    const kappa = 0.41;
    const wind = new LogProfileWind(uStar, roughnessLength, kappa);
    const out = new EnvSample();
    wind.sample(0, 0, roughnessLength * (Math.E - 1), out);
    expect((out.wx * kappa) / uStar).toBeCloseTo(1, 12);
  });

  it("is finite (0) at y=0", () => {
    const wind = new LogProfileWind(0.5);
    const out = new EnvSample();
    wind.sample(0, 0, 0, out);
    expect(out.wx).toBe(0);
    expect(Number.isFinite(out.wx)).toBe(true);
  });

  it("stays finite for y well below ground (guard clamps to y=0)", () => {
    const wind = new LogProfileWind(0.5);
    const out = new EnvSample();
    wind.sample(0, 0, -100, out);
    expect(Number.isFinite(out.wx)).toBe(true);
    expect(out.wx).toBe(0);
  });

  it("increases with height above ground", () => {
    const wind = new LogProfileWind(0.5);
    const low = new EnvSample();
    const high = new EnvSample();
    wind.sample(0, 0, 1, low);
    wind.sample(0, 0, 10, high);
    expect(high.wx).toBeGreaterThan(low.wx);
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
