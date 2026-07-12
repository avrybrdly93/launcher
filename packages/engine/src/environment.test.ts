import { describe, expect, it } from "vitest";
import { EnvSample } from "./env-sample.js";
import {
  ConstantAtmosphere,
  Environment,
  UniformGravity,
  ZeroWind,
  sutherlandViscosity,
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
  it("eta(288.15 K) = 1.789e-5 within 1%", () => {
    const eta = sutherlandViscosity(288.15);
    expect(eta).toBeCloseTo(1.789e-5, 6);
    expect(Math.abs(eta - 1.789e-5) / 1.789e-5).toBeLessThan(0.01);
  });

  it("equals SUTHERLAND.etaRef exactly at the reference temperature", () => {
    expect(sutherlandViscosity(SUTHERLAND.Tref)).toBe(SUTHERLAND.etaRef);
  });

  it("increases with temperature (air viscosity rises with T)", () => {
    expect(sutherlandViscosity(350)).toBeGreaterThan(sutherlandViscosity(250));
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
