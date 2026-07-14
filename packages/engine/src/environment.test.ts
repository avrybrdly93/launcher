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

describe("ExponentialAtmosphere (P1.27, §3.4)", () => {
  it("rho(H) = rho0/e to 1e-15", () => {
    const atm = new ExponentialAtmosphere();
    const out0 = new EnvSample();
    const outH = new EnvSample();
    atm.sample(0, 0, out0);
    atm.sample(0, atm.scaleHeight, outH);
    expect(outH.rho / out0.rho).toBeCloseTo(1 / Math.E, 15);
  });

  it("rho(0) = rho0", () => {
    const atm = new ExponentialAtmosphere();
    const out = new EnvSample();
    atm.sample(0, 0, out);
    expect(out.rho).toBe(ISA.rho0);
  });

  it("density decreases monotonically with altitude", () => {
    const atm = new ExponentialAtmosphere();
    const heights = [0, 1000, 5000, 8500, 20000];
    const out = new EnvSample();
    let prevRho = Infinity;
    for (const y of heights) {
      atm.sample(0, y, out);
      expect(out.rho).toBeLessThan(prevRho);
      prevRho = out.rho;
    }
  });

  it("holds temperature fixed (isothermal) across altitude", () => {
    const atm = new ExponentialAtmosphere();
    const outLow = new EnvSample();
    const outHigh = new EnvSample();
    atm.sample(0, 0, outLow);
    atm.sample(0, 10000, outHigh);
    expect(outHigh.T).toBe(outLow.T);
    expect(outHigh.eta).toBe(outLow.eta);
    expect(outHigh.c).toBe(outLow.c);
  });

  it("derives scale height from Rs*T/g by default (~8.5km per §3.4)", () => {
    const atm = new ExponentialAtmosphere();
    expect(atm.scaleHeight).toBeCloseTo((ISA.Rs * ISA.T0) / G_STD, 9);
    expect(atm.scaleHeight / 1000).toBeCloseTo(8.5, 0);
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
