import { describe, expect, it } from "vitest";
import { EnvSample } from "./env-sample.js";
import {
  ConstantAtmosphere,
  Environment,
  ExponentialAtmosphere,
  UniformGravity,
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

  it("computes eta from Sutherland's law at ISA sea-level temperature", () => {
    const atm = new ConstantAtmosphere();
    const out = new EnvSample();
    atm.sample(0, 0, out);
    expect(out.eta).toBe(sutherlandViscosity(ISA.T0));
  });
});

describe("ExponentialAtmosphere", () => {
  it("matches ISA sea-level density and pressure at y=0", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, 0, out);
    expect(out.rho).toBe(ISA.rho0);
    expect(out.p).toBe(ISA.p0);
    expect(out.T).toBe(ISA.T0);
  });

  it("rho(H) = rho0/e to 1e-15 (validation criterion)", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, ISA.scaleHeight, out);
    const expected = ISA.rho0 / Math.E;
    expect(Math.abs(out.rho - expected) / expected).toBeLessThan(1e-15);
  });

  it("decays monotonically with altitude and matches the closed form at an arbitrary height", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, 3000, out);
    const expected = ISA.rho0 * Math.exp(-3000 / ISA.scaleHeight);
    expect(out.rho).toBeCloseTo(expected, 15);
    expect(out.rho).toBeLessThan(ISA.rho0);
  });

  it("decays pressure by the same exponential factor as density, keeping p/rho = p0/rho0", () => {
    const atm = new ExponentialAtmosphere();
    const sea = new EnvSample();
    const alt = new EnvSample();
    atm.sample(0, 0, sea);
    atm.sample(0, 4000, alt);
    expect(alt.p / alt.rho).toBeCloseTo(sea.p / sea.rho, 10);
  });

  it("is isothermal: temperature does not vary with altitude", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, 0, out);
    const T0 = out.T;
    atm.sample(0, 8000, out);
    expect(out.T).toBe(T0);
  });

  it("computes eta from Sutherland's law at the (fixed) isothermal temperature", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, 5000, out);
    expect(out.eta).toBe(sutherlandViscosity(ISA.T0));
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
