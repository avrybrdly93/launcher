import { describe, expect, it } from "vitest";
import { EnvSample } from "./env-sample.js";
import {
  ConstantAtmosphere,
  Environment,
  ExponentialAtmosphere,
  sutherlandViscosity,
  UniformGravity,
  UniformSteadyWind,
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

describe("ExponentialAtmosphere", () => {
  it("rho(H) = rho0/e to 1e-15 (P1.27 validation criterion)", () => {
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

  it("rho decreases monotonically with altitude", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    let previous = Infinity;
    for (const y of [0, 1000, 5000, 10000, 20000]) {
      atm.sample(0, y, out);
      expect(out.rho).toBeLessThan(previous);
      previous = out.rho;
    }
  });

  it("holds temperature at the isothermal reference and derives eta via Sutherland's law", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, 5000, out);
    expect(out.T).toBe(ISA.T0);
    expect(out.eta).toBeCloseTo(sutherlandViscosity(ISA.T0), 15);
  });
});

describe("sutherlandViscosity", () => {
  it("eta(288.15K) = 1.789e-5 to 1% (P1.28 validation criterion)", () => {
    const eta = sutherlandViscosity(288.15);
    expect(eta).toBeCloseTo(1.789e-5, 6);
    expect(Math.abs(eta - 1.789e-5) / 1.789e-5).toBeLessThan(0.01);
  });

  it("eta(Tref) reproduces etaRef exactly (Tref is the Sutherland reference temperature)", () => {
    expect(sutherlandViscosity(SUTHERLAND.Tref)).toBe(SUTHERLAND.etaRef);
  });

  it("increases with temperature (gas viscosity rises with T, unlike liquids)", () => {
    expect(sutherlandViscosity(350)).toBeGreaterThan(sutherlandViscosity(250));
  });
});

describe("UniformSteadyWind", () => {
  it("returns a constant w everywhere in time and space (P1.29 validation criterion)", () => {
    const wind = new UniformSteadyWind(5, -2);
    const out = new EnvSample();
    for (const [t, x, y] of [
      [0, 0, 0],
      [10, 100, 50],
      [-5, -20, 3000],
    ] as const) {
      wind.sample(t, x, y, out);
      expect(out.wx).toBe(5);
      expect(out.wy).toBe(-2);
    }
  });

  it("defaults wy to 0 when only wx is given", () => {
    const wind = new UniformSteadyWind(3);
    const out = new EnvSample();
    wind.sample(0, 0, 0, out);
    expect(out.wx).toBe(3);
    expect(out.wy).toBe(0);
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
