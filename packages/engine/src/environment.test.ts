import { describe, expect, it } from "vitest";
import { EnvSample } from "./env-sample.js";
import {
  ConstantAtmosphere,
  Environment,
  ExponentialAtmosphere,
  UniformGravity,
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
    expect(Math.abs(out.rho - ISA.rho0 / Math.E)).toBeLessThan(1e-15);
  });

  it("is strictly decreasing with altitude and symmetric in log-space", () => {
    const atm = new ExponentialAtmosphere();
    const low = new EnvSample();
    const high = new EnvSample();
    atm.sample(0, 1000, low);
    atm.sample(0, 5000, high);
    expect(high.rho).toBeLessThan(low.rho);
    expect(Math.log(low.rho) - Math.log(high.rho)).toBeCloseTo((5000 - 1000) / ISA.scaleHeight, 12);
  });

  it("holds T, eta, and c constant (isothermal)", () => {
    const atm = new ExponentialAtmosphere();
    const low = new EnvSample();
    const high = new EnvSample();
    atm.sample(0, 0, low);
    atm.sample(0, 10000, high);
    expect(high.T).toBe(low.T);
    expect(high.eta).toBe(low.eta);
    expect(high.c).toBe(low.c);
    expect(low.T).toBe(ISA.T0);
  });

  it("supports a custom rho0/T0/scale height", () => {
    const atm = new ExponentialAtmosphere(2, 300, 1000);
    const out = new EnvSample();
    atm.sample(0, 1000, out);
    expect(out.rho).toBeCloseTo(2 / Math.E, 14);
    expect(out.T).toBe(300);
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
