import { describe, expect, it } from "vitest";
import { EnvSample } from "./env-sample.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { EARTH_RADIUS_M, G_STD, ISA, SUTHERLAND, sutherlandViscosity } from "./units.js";

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

describe("sutherlandViscosity (eq. 3.12)", () => {
  it("matches the ISA sea-level reference to within 1%", () => {
    const eta = sutherlandViscosity(288.15);
    expect(Math.abs(eta - SUTHERLAND.etaRef) / SUTHERLAND.etaRef).toBeLessThan(0.01);
  });

  it("is exactly etaRef at T = Tref", () => {
    expect(sutherlandViscosity(SUTHERLAND.Tref)).toBe(SUTHERLAND.etaRef);
  });

  it("increases monotonically with temperature (gas viscosity, unlike liquids)", () => {
    const etaCold = sutherlandViscosity(250);
    const etaWarm = sutherlandViscosity(300);
    const etaHot = sutherlandViscosity(400);
    expect(etaCold).toBeLessThan(etaWarm);
    expect(etaWarm).toBeLessThan(etaHot);
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
