import { describe, expect, it } from "vitest";
import { EnvSample } from "./env-sample.js";
import {
  ConstantAtmosphere,
  Environment,
  ExponentialAtmosphere,
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

describe("sutherlandViscosity", () => {
  it("reproduces the reference viscosity at the reference temperature to 1%", () => {
    const eta = sutherlandViscosity(SUTHERLAND.Tref);
    expect(Math.abs(eta - SUTHERLAND.etaRef) / SUTHERLAND.etaRef).toBeLessThan(0.01);
  });

  it("increases with temperature (air gets more viscous when hotter)", () => {
    expect(sutherlandViscosity(300)).toBeGreaterThan(sutherlandViscosity(250));
  });
});

describe("ExponentialAtmosphere", () => {
  it("rho(H) = rho0/e to 1e-15 (isothermal exponential atmosphere, eq. §3.4)", () => {
    const atm = new ExponentialAtmosphere(ISA.scaleHeight);
    const out = new EnvSample();
    atm.sample(0, ISA.scaleHeight, out);
    expect(out.rho).toBeCloseTo(ISA.rho0 / Math.E, 15);
  });

  it("rho(0) = rho0 and density decreases monotonically with altitude", () => {
    const atm = new ExponentialAtmosphere();
    const out0 = new EnvSample();
    atm.sample(0, 0, out0);
    expect(out0.rho).toBe(ISA.rho0);

    const outHigh = new EnvSample();
    atm.sample(0, 10000, outHigh);
    expect(outHigh.rho).toBeLessThan(out0.rho);
  });

  it("is isothermal: eta and c are the same at every altitude", () => {
    const atm = new ExponentialAtmosphere();
    const outLow = new EnvSample();
    const outHigh = new EnvSample();
    atm.sample(0, 0, outLow);
    atm.sample(0, 8000, outHigh);
    expect(outHigh.eta).toBe(outLow.eta);
    expect(outHigh.c).toBe(outLow.c);
    expect(outHigh.T).toBe(outLow.T);
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
  it("returns the same constant (wx, wy) regardless of t, x, y", () => {
    const wind = new UniformWind(5, -2);
    const out = new EnvSample();
    for (const [t, x, y] of [
      [0, 0, 0],
      [10, 100, -50],
      [-3, 1e6, 1e6],
    ] as const) {
      wind.sample(t, x, y, out);
      expect(out.wx).toBe(5);
      expect(out.wy).toBe(-2);
    }
  });

  it("defaults wy to 0", () => {
    const wind = new UniformWind(3);
    const out = new EnvSample();
    wind.sample(0, 0, 0, out);
    expect(out.wx).toBe(3);
    expect(out.wy).toBe(0);
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
