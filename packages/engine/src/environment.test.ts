import { describe, expect, it } from "vitest";
import { EnvSample } from "./env-sample.js";
import {
  ConstantAtmosphere,
  Environment,
  ExponentialAtmosphere,
  LogProfileWind,
  SinusoidalGustWind,
  sutherlandViscosity,
  UniformGravity,
  UniformWind,
  ZeroWind,
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

describe("ExponentialAtmosphere (P1.27)", () => {
  it("rho(H) = rho0/e to 1e-15 (relative)", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, ISA.scaleHeight, out);
    const expected = ISA.rho0 / Math.E;
    expect(Math.abs(out.rho - expected) / expected).toBeLessThan(1e-15);
  });

  it("reduces to rho0 at y=0", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, 0, out);
    expect(out.rho).toBe(ISA.rho0);
  });

  it("stays isothermal: T, eta, c match ConstantAtmosphere at every altitude", () => {
    const exp = new ExponentialAtmosphere();
    const constant = new ConstantAtmosphere();
    const outExp = new EnvSample();
    const outConst = new EnvSample();
    for (const y of [0, 1000, 8500, 20000]) {
      exp.sample(0, y, outExp);
      constant.sample(0, y, outConst);
      expect(outExp.T).toBe(outConst.T);
      expect(outExp.eta).toBeCloseTo(outConst.eta, 10);
      expect(outExp.c).toBeCloseTo(outConst.c, 10);
    }
  });
});

describe("sutherlandViscosity (P1.28)", () => {
  it("eta(288.15K) = 1.789e-5 within 1%", () => {
    const eta = sutherlandViscosity(SUTHERLAND.Tref);
    expect(eta).toBeCloseTo(1.789e-5, 0);
    expect(Math.abs(eta - 1.789e-5) / 1.789e-5).toBeLessThan(0.01);
  });

  it("equals etaRef exactly at T = Tref", () => {
    expect(sutherlandViscosity(SUTHERLAND.Tref)).toBeCloseTo(SUTHERLAND.etaRef, 15);
  });

  it("increases with temperature (air viscosity rises with T, unlike liquids)", () => {
    const etaCold = sutherlandViscosity(250);
    const etaHot = sutherlandViscosity(350);
    expect(etaHot).toBeGreaterThan(etaCold);
  });
});

describe("UniformWind (P1.29)", () => {
  it("is constant everywhere in space and time", () => {
    const wind = new UniformWind(5, -2);
    const out = new EnvSample();
    for (const [t, x, y] of [
      [0, 0, 0],
      [10, 100, -50],
      [-5, -1000, 2000],
    ] as const) {
      wind.sample(t, x, y, out);
      expect(out.wx).toBe(5);
      expect(out.wy).toBe(-2);
    }
  });
});

describe("LogProfileWind (P1.30)", () => {
  it("satisfies w(y_r*(e-1)) * kappa / u_star = 1", () => {
    const uStar = 2;
    const yr = 0.01;
    const wind = new LogProfileWind(uStar, yr);
    const out = new EnvSample();
    wind.sample(0, 0, yr * (Math.E - 1), out);
    expect((out.wx * LogProfileWind.VON_KARMAN) / uStar).toBeCloseTo(1, 12);
  });

  it("is finite (and zero) at y=0", () => {
    const wind = new LogProfileWind(3, 0.01);
    const out = new EnvSample();
    wind.sample(0, 0, 0, out);
    expect(Number.isFinite(out.wx)).toBe(true);
    expect(out.wx).toBe(0);
  });

  it("is finite below ground (y<0), clamped to the y=0 value", () => {
    const wind = new LogProfileWind(3, 0.01);
    const out = new EnvSample();
    for (const y of [-0.005, -1, -1000]) {
      wind.sample(0, 0, y, out);
      expect(Number.isFinite(out.wx)).toBe(true);
      expect(out.wx).toBe(0);
    }
  });

  it("only has a horizontal component", () => {
    const wind = new LogProfileWind(3, 0.01);
    const out = new EnvSample();
    wind.sample(0, 0, 10, out);
    expect(out.wy).toBe(0);
  });
});

describe("SinusoidalGustWind (P1.31)", () => {
  it("matches wMean + amplitude*sin(omega*t+phase) at sampled t", () => {
    const wMean = 4;
    const amplitude = 2.5;
    const omega = 1.3;
    const phase = 0.7;
    const wind = new SinusoidalGustWind(wMean, amplitude, omega, phase);
    const out = new EnvSample();
    for (const t of [0, 0.5, 1.7, 10, -3.2]) {
      wind.sample(t, 0, 0, out);
      expect(out.wx).toBeCloseTo(wMean + amplitude * Math.sin(omega * t + phase), 14);
      expect(out.wy).toBe(0);
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
