import { describe, expect, it } from "vitest";
import { EnvSample } from "./env-sample.js";
import {
  ConstantAtmosphere,
  Environment,
  ExponentialAtmosphere,
  GaussianVortexWind,
  GriddedWindField,
  LogProfileWind,
  SinusoidalGustWind,
  UniformGravity,
  UniformWind,
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

describe("UniformWind", () => {
  it("returns a constant w everywhere in space and time (validation criterion)", () => {
    const wind = new UniformWind(5, -1.5);
    const out = new EnvSample();
    for (const [t, x, y] of [
      [0, 0, 0],
      [10, 100, -50],
      [1e6, -1e3, 1e3],
    ] as const) {
      wind.sample(t, x, y, out);
      expect(out.wx).toBe(5);
      expect(out.wy).toBe(-1.5);
    }
  });

  it("defaults wy to 0 for a purely horizontal wind", () => {
    const wind = new UniformWind(3);
    const out = new EnvSample();
    wind.sample(0, 0, 0, out);
    expect(out.wx).toBe(3);
    expect(out.wy).toBe(0);
  });
});

describe("LogProfileWind", () => {
  it("satisfies w(yr*(e-1))*kappa/u* = 1 (validation criterion)", () => {
    const uStar = 2.5;
    const yr = 0.01;
    const wind = new LogProfileWind(uStar, yr);
    const out = new EnvSample();
    const KAPPA = 0.41;
    wind.sample(0, 0, yr * (Math.E - 1), out);
    expect((out.wx * KAPPA) / uStar).toBeCloseTo(1, 12);
  });

  it("is finite (not NaN) at y=0", () => {
    const wind = new LogProfileWind(2.5, 0.01);
    const out = new EnvSample();
    wind.sample(0, 0, 0, out);
    expect(Number.isFinite(out.wx)).toBe(true);
    expect(out.wx).toBe(0);
  });

  it("clamps to the y=0 value below ground instead of producing NaN/Infinity", () => {
    const wind = new LogProfileWind(2.5, 0.01);
    const out = new EnvSample();
    for (const y of [-1e-6, -0.01, -1, -100]) {
      wind.sample(0, 0, y, out);
      expect(Number.isFinite(out.wx)).toBe(true);
      expect(out.wx).toBe(0);
    }
  });

  it("increases monotonically with height above ground", () => {
    const wind = new LogProfileWind(2.5, 0.01);
    const out = new EnvSample();
    const heights = [0.1, 1, 5, 20, 100];
    let prev = -Infinity;
    for (const y of heights) {
      wind.sample(0, 0, y, out);
      expect(out.wx).toBeGreaterThan(prev);
      prev = out.wx;
    }
  });
});

describe("SinusoidalGustWind", () => {
  it("matches the formula wbar + A*sin(Omega*t + phi) at sampled t (validation criterion)", () => {
    const wbar = 3;
    const amplitude = 1.5;
    const omega = 2.0;
    const phi = 0.7;
    const wind = new SinusoidalGustWind(wbar, amplitude, omega, phi);
    const out = new EnvSample();
    for (const t of [0, 0.5, 1, 3.7, 10]) {
      wind.sample(t, 0, 0, out);
      expect(out.wx).toBeCloseTo(wbar + amplitude * Math.sin(omega * t + phi), 14);
    }
  });

  it("defaults to zero phase and zero wy", () => {
    const wind = new SinusoidalGustWind(0, 2, 1);
    const out = new EnvSample();
    wind.sample(0, 0, 0, out);
    expect(out.wx).toBeCloseTo(0, 14);
    expect(out.wy).toBe(0);
    wind.sample(Math.PI / 2, 0, 0, out);
    expect(out.wx).toBeCloseTo(2, 14);
  });

  it("is independent of x and y (a spatially uniform gust)", () => {
    const wind = new SinusoidalGustWind(1, 1, 1);
    const outA = new EnvSample();
    const outB = new EnvSample();
    wind.sample(2, 0, 0, outA);
    wind.sample(2, 500, -500, outB);
    expect(outB.wx).toBe(outA.wx);
  });
});

describe("GaussianVortexWind", () => {
  it("circulation integral on a ring far outside the core matches Gamma to 1% (numeric quadrature)", () => {
    const gamma = 5;
    const rc = 0.5;
    const wind = new GaussianVortexWind(gamma, rc);
    const R = 10 * rc;
    const out = new EnvSample();
    const n = 2000;
    const dTheta = (2 * Math.PI) / n;
    let circulation = 0;
    for (let i = 0; i < n; i++) {
      const theta = i * dTheta;
      const x = R * Math.cos(theta);
      const y = R * Math.sin(theta);
      wind.sample(0, x, y, out);
      const tx = -Math.sin(theta);
      const ty = Math.cos(theta);
      circulation += (out.wx * tx + out.wy * ty) * R * dTheta;
    }
    expect(Math.abs(circulation - gamma) / gamma).toBeLessThan(0.01);
  });

  it("is finite (zero) at the vortex center, not NaN from a 0/0 division", () => {
    const wind = new GaussianVortexWind(5, 0.5);
    const out = new EnvSample();
    wind.sample(0, 0, 0, out);
    expect(out.wx).toBe(0);
    expect(out.wy).toBe(0);
  });

  it("is purely tangential: velocity is perpendicular to the radial direction from the center", () => {
    const wind = new GaussianVortexWind(3, 1, 2, -1);
    const out = new EnvSample();
    for (const [x, y] of [
      [5, 3],
      [-2, 4],
      [2, -1.001],
    ] as const) {
      wind.sample(0, x, y, out);
      const dx = x - 2;
      const dy = y - -1;
      expect(Math.abs(out.wx * dx + out.wy * dy)).toBeLessThan(1e-10);
    }
  });
});

describe("GriddedWindField", () => {
  const x0 = -1;
  const y0 = -2;
  const dx = 2;
  const dy = 3;
  const nx = 5;
  const ny = 4;
  const wxOf = (x: number, y: number) => 1 + 0.5 * x - 0.25 * y;
  const wyOf = (x: number, y: number) => -2 + 1.5 * x + 0.75 * y;

  function buildLinearGrid() {
    const wx: number[] = [];
    const wy: number[] = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * dx;
        const y = y0 + j * dy;
        wx.push(wxOf(x, y));
        wy.push(wyOf(x, y));
      }
    }
    return new GriddedWindField({ x0, y0, dx, dy, nx, ny, wx, wy });
  }

  it("reproduces a linear field exactly at interior points (validation criterion)", () => {
    const field = buildLinearGrid();
    const out = new EnvSample();
    const points: Array<[number, number]> = [
      [0, 0],
      [-0.3, 1.1],
      [3.7, 4.2],
      [x0, y0],
      [x0 + (nx - 1) * dx, y0 + (ny - 1) * dy],
    ];
    for (const [x, y] of points) {
      field.sample(0, x, y, out);
      expect(out.wx).toBeCloseTo(wxOf(x, y), 10);
      expect(out.wy).toBeCloseTo(wyOf(x, y), 10);
    }
  });

  it("clamps out-of-domain queries to the edge value (documented+tested policy)", () => {
    const field = buildLinearGrid();
    const out = new EnvSample();
    const edgeOut = new EnvSample();

    // Left of domain: clamps to the x0 edge, still varying with y within range.
    field.sample(0, x0 - 100, 0, out);
    field.sample(0, x0, 0, edgeOut);
    expect(out.wx).toBe(edgeOut.wx);
    expect(out.wy).toBe(edgeOut.wy);

    // Beyond the top-right corner: clamps to the far corner node.
    const xMax = x0 + (nx - 1) * dx;
    const yMax = y0 + (ny - 1) * dy;
    field.sample(0, xMax + 50, yMax + 50, out);
    field.sample(0, xMax, yMax, edgeOut);
    expect(out.wx).toBe(edgeOut.wx);
    expect(out.wy).toBe(edgeOut.wy);
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
