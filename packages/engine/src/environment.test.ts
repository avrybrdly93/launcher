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

describe("sutherlandViscosity", () => {
  it("eta(288.15 K) = 1.789e-5 to within 1%", () => {
    expect(sutherlandViscosity(288.15)).toBeCloseTo(1.789e-5, 7);
    expect(Math.abs(sutherlandViscosity(288.15) - 1.789e-5) / 1.789e-5).toBeLessThan(0.01);
  });

  it("reduces exactly to etaRef at T = Tref", () => {
    expect(sutherlandViscosity(SUTHERLAND.Tref)).toBe(SUTHERLAND.etaRef);
  });

  it("increases with temperature (viscosity of gases rises with T)", () => {
    const etaCold = sutherlandViscosity(250);
    const etaHot = sutherlandViscosity(350);
    expect(etaHot).toBeGreaterThan(etaCold);
  });
});

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

  it("density decreases monotonically with altitude and matches the exponential formula", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    let previous = Infinity;
    for (const y of [0, 1000, 5000, 8500, 20000]) {
      atm.sample(0, y, out);
      expect(out.rho).toBeLessThan(previous);
      expect(out.rho).toBeCloseTo(ISA.rho0 * Math.exp(-y / ISA.scaleHeight), 15);
      previous = out.rho;
    }
  });

  it("holds temperature, viscosity, and sound speed at ISA sea-level values (isothermal)", () => {
    const atm = new ExponentialAtmosphere();
    const outLow = new EnvSample();
    const outHigh = new EnvSample();
    atm.sample(0, 0, outLow);
    atm.sample(0, 10000, outHigh);
    expect(outHigh.T).toBe(outLow.T);
    expect(outHigh.eta).toBe(outLow.eta);
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
  it("returns constant (wx, wy) everywhere and for all time", () => {
    const wind = new UniformWind(5, -2);
    const out = new EnvSample();
    for (const [t, x, y] of [
      [0, 0, 0],
      [10, 100, -50],
      [1e6, -1e3, 1e4],
    ]) {
      wind.sample(t!, x!, y!, out);
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
