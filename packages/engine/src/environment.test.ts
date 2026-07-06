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

  it("eta matches Sutherland's law at ISA sea-level temperature (P1.28)", () => {
    const atm = new ConstantAtmosphere();
    const out = new EnvSample();
    atm.sample(0, 0, out);
    expect(out.eta).toBeCloseTo(1.789e-5, 10);
  });
});

describe("sutherlandViscosity (P1.28, eq. 3.12)", () => {
  it("matches the reference viscosity at the reference temperature to 1%", () => {
    const eta = sutherlandViscosity(SUTHERLAND.Tref);
    expect(Math.abs(eta - 1.789e-5) / 1.789e-5).toBeLessThan(0.01);
  });

  it("is exact at T = Tref (both correction factors become 1)", () => {
    expect(sutherlandViscosity(SUTHERLAND.Tref)).toBe(SUTHERLAND.etaRef);
  });

  it("increases monotonically with temperature", () => {
    const etaCold = sutherlandViscosity(250);
    const etaWarm = sutherlandViscosity(288.15);
    const etaHot = sutherlandViscosity(350);
    expect(etaCold).toBeLessThan(etaWarm);
    expect(etaWarm).toBeLessThan(etaHot);
  });
});

describe("ExponentialAtmosphere (P1.27)", () => {
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
    expect(out.rho / ISA.rho0).toBeCloseTo(1 / Math.E, 15);
  });

  it("density decreases monotonically with altitude", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    let previous = Infinity;
    for (const y of [0, 1000, 5000, 8500, 20000]) {
      atm.sample(0, y, out);
      expect(out.rho).toBeLessThan(previous);
      previous = out.rho;
    }
  });

  it("stays isothermal: T and eta (Sutherland's law) are constant with altitude", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, 0, out);
    const [t0, eta0] = [out.T, out.eta];
    atm.sample(0, 12000, out);
    expect(out.T).toBe(t0);
    expect(out.eta).toBe(eta0);
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

describe("UniformSteadyWind (P1.29)", () => {
  it("returns the same (wx, wy) everywhere in space and time", () => {
    const wind = new UniformSteadyWind(5, -2);
    const out = new EnvSample();
    for (const [t, x, y] of [
      [0, 0, 0],
      [10, 100, -50],
      [-3, -20, 5000],
    ] as const) {
      wind.sample(t, x, y, out);
      expect(out.wx).toBe(5);
      expect(out.wy).toBe(-2);
    }
  });

  it("defaults wy to 0 (horizontal wind only)", () => {
    const wind = new UniformSteadyWind(7);
    const out = new EnvSample();
    wind.sample(0, 0, 0, out);
    expect(out.wx).toBe(7);
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
