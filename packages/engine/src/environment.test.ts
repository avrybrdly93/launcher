import { describe, expect, it } from "vitest";
import { EnvSample } from "./env-sample.js";
import {
  ConstantAtmosphere,
  Environment,
  IsothermalExponentialAtmosphere,
  LogProfileWind,
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

describe("IsothermalExponentialAtmosphere", () => {
  it("rho(0) = rho0 exactly", () => {
    const atm = new IsothermalExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, 0, out);
    expect(out.rho).toBe(ISA.rho0);
  });

  it("rho(H) = rho0/e to 1e-15", () => {
    const atm = new IsothermalExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, ISA.scaleHeight, out);
    expect(out.rho).toBeCloseTo(ISA.rho0 / Math.E, 15);
  });

  it("density decays monotonically with altitude and rises below sea level", () => {
    const atm = new IsothermalExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, 1000, out);
    const rhoAt1km = out.rho;
    atm.sample(0, 10000, out);
    const rhoAt10km = out.rho;
    atm.sample(0, -1000, out);
    const rhoAtMinus1km = out.rho;
    expect(rhoAt10km).toBeLessThan(rhoAt1km);
    expect(rhoAt1km).toBeLessThan(ISA.rho0);
    expect(rhoAtMinus1km).toBeGreaterThan(ISA.rho0);
  });

  it("pressure falls off with the same exponential as density (isothermal ideal gas)", () => {
    const atm = new IsothermalExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, 0, out);
    const rho0 = out.rho;
    const p0 = out.p;
    atm.sample(0, ISA.scaleHeight, out);
    expect(out.p / p0).toBeCloseTo(out.rho / rho0, 12);
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
  it("returns w = (wx, wy) constant everywhere (any t, x, y)", () => {
    const wind = new UniformWind(5, -2);
    const out = new EnvSample();
    for (const [t, x, y] of [
      [0, 0, 0],
      [10, 100, -50],
      [-3, 1e6, -1e6],
      [1000, 0.001, 0.001],
    ]) {
      wind.sample(t!, x!, y!, out);
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

  it("w(y_r*(e-1)) * kappa / u* = 1 (eq. 3.13 reference point)", () => {
    const uStar = 0.5;
    const yr = 0.01;
    const wind = new LogProfileWind(uStar, yr);
    const out = new EnvSample();
    wind.sample(0, 0, yr * (Math.E - 1), out);
    expect((out.wx * KAPPA) / uStar).toBeCloseTo(1, 12);
  });

  it("w is finite (and exactly 0) at y = 0", () => {
    const wind = new LogProfileWind(0.5, 0.01);
    const out = new EnvSample();
    wind.sample(0, 0, 0, out);
    expect(Number.isFinite(out.wx)).toBe(true);
    expect(out.wx).toBe(0);
  });

  it("clamps y <= 0 to the surface value instead of producing NaN/-Infinity", () => {
    const wind = new LogProfileWind(0.5, 0.01);
    const out = new EnvSample();
    for (const y of [-1, -100, -1e6]) {
      wind.sample(0, 0, y, out);
      expect(Number.isFinite(out.wx)).toBe(true);
      expect(out.wx).toBe(0);
    }
  });

  it("increases with height above the surface", () => {
    const wind = new LogProfileWind(0.5, 0.01);
    const out = new EnvSample();
    wind.sample(0, 0, 1, out);
    const wAt1m = out.wx;
    wind.sample(0, 0, 10, out);
    const wAt10m = out.wx;
    expect(wAt10m).toBeGreaterThan(wAt1m);
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
