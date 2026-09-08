import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  UniformWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { ClassicalRK4Stepper, createStepResult } from "@ballista/solverkit";
import { beforeAll, describe, expect, it } from "vitest";
import { WasmRk4Kernel } from "./wasm-rk4-backend.js";

/**
 * P7.07's validation criterion: "WASM result matches TS within 1e-15 per step
 * (same order of ops)".
 *
 * These tests assert something stronger than the criterion asks. The
 * parenthesis is the substance of the task -- if the operation order really
 * does match, the two sides are running the identical sequence of IEEE-754
 * binary64 operations on identical inputs, and the answer is not "close", it is
 * *the same bits*. So the assertions are `Object.is` on raw doubles, not
 * `toBeCloseTo`. A 1e-15 tolerance would pass just as happily on a port that
 * had quietly reassociated something, and finding that is the point.
 *
 * `Object.is` rather than `===` so a `-0`/`+0` divergence is caught rather than
 * compared equal, and so a NaN pair compares equal instead of silently passing
 * an `expect(NaN).toBe(NaN)`.
 */

/** The one configuration the kernel targets: constant atmosphere, uniform gravity and wind, constant Cd. */
const CD = 0.47;
const MASS = 0.145;
const RADIUS = 0.0366;
const WX = 3.5;
const WY = -1.25;

function makeTsSide(): {
  step: (t: number, y: Float64Array, h: number) => Float64Array;
  rho: number;
  g: number;
} {
  const params = createSphericalProjectileParams({
    mass: MASS,
    radius: RADIUS,
    dragCoefficient: new ConstantCd(CD),
  });
  const environment = new Environment(
    new ConstantAtmosphere(),
    new UniformGravity(),
    new UniformWind(WX, WY),
  );
  // Gravity BEFORE drag: specializeForces applies them in array order, and
  // that order is part of what the port reproduces.
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const ctx = createEvalContext(environment, params);
  const stepper = new ClassicalRK4Stepper();
  stepper.init(model, ctx);
  const out = createStepResult(model.dim);

  // Sample the environment once to learn the rho/g the TS side will use, so
  // the WASM side is given the same numbers rather than a hard-coded guess.
  environment.sample(0, 0, 0, ctx.env);

  return {
    step(t, y, h) {
      stepper.step(t, y, h, out);
      return Float64Array.from(out.yNext);
    },
    rho: ctx.env.rho,
    g: ctx.env.g,
  };
}

async function makeWasmSide(rho: number, g: number): Promise<WasmRk4Kernel> {
  const kernel = await WasmRk4Kernel.instantiate();
  const params = createSphericalProjectileParams({
    mass: MASS,
    radius: RADIUS,
    dragCoefficient: new ConstantCd(CD),
  });
  kernel.setParams({ mass: MASS, area: params.area, cd: CD, rho, g, wx: WX, wy: WY });
  return kernel;
}

// One reused scratch view rather than one per call. The 2000-step comparison
// below asks for ~8000 ULP distances, and allocating a DataView per call made
// that test slow enough to intermittently exceed vitest's 5s default when the
// full 310-file suite is competing for CPU.
const ULP_SCRATCH = new DataView(new ArrayBuffer(8));

function ulpOrdinal(x: number): bigint {
  ULP_SCRATCH.setFloat64(0, x);
  const bits = ULP_SCRATCH.getBigUint64(0);
  // Map the sign-magnitude bit pattern onto a monotone ordering so a
  // subtraction counts representable doubles between the two values.
  return bits & 0x8000_0000_0000_0000n
    ? 0x8000_0000_0000_0000n - (bits & 0x7fff_ffff_ffff_ffffn)
    : bits;
}

/** Distance in ULP between two doubles, for reporting a divergence rather than just failing. */
function ulpDistance(a: number, b: number): number {
  if (Object.is(a, b)) return 0;
  const d = ulpOrdinal(a) - ulpOrdinal(b);
  return Number(d < 0n ? -d : d);
}

describe("the WASM kernel reproduces the TypeScript RK4 step", () => {
  let ts: ReturnType<typeof makeTsSide>;
  let wasm: WasmRk4Kernel;

  beforeAll(async () => {
    ts = makeTsSide();
    wasm = await makeWasmSide(ts.rho, ts.g);
  });

  it("exposes the dimension and parameter count the host expects", () => {
    expect(wasm.state.length).toBe(4);
    expect(wasm.params.length).toBe(7);
  });

  it("matches bit-for-bit on a single step from a launch state", () => {
    const y0 = Float64Array.from([0, 1.5, 42, 31]);
    const h = 1 / 64;

    const tsNext = ts.step(0, y0, h);
    wasm.setState(y0);
    wasm.step(0, h);

    for (let i = 0; i < 4; i++) {
      expect(ulpDistance(wasm.state[i]!, tsNext[i]!)).toBe(0);
      expect(Object.is(wasm.state[i], tsNext[i])).toBe(true);
    }
  });

  it("matches bit-for-bit at every step of a 2000-step flight, not just at the end", () => {
    // Stepping both sides in lockstep and comparing at each step is what makes
    // this a per-step claim. Comparing only the final state would let an early
    // divergence be masked by a later one of the opposite sign, and would say
    // nothing about the criterion's "per step".
    const h = 1 / 128;
    const y = Float64Array.from([0, 1.5, 55, 38]);
    wasm.setState(y);

    // Every step is compared; only the first divergence is reported. Calling
    // `expect` 2000 times inside the loop cost enough under a loaded full-suite
    // run to trip the default 5s timeout, and it buys nothing -- recording the
    // first failing step and asserting once makes exactly the same claim and
    // gives a better message when it breaks.
    let worst = 0;
    let firstDivergence: { step: number; component: number; ulp: number } | undefined;
    for (let n = 0; n < 2000; n++) {
      const t = n * h;
      const tsNext = ts.step(t, y, h);
      wasm.step(t, h);
      for (let i = 0; i < 4; i++) {
        const ulp = ulpDistance(wasm.state[i]!, tsNext[i]!);
        if (ulp > worst) worst = ulp;
        if (ulp !== 0 && firstDivergence === undefined) {
          firstDivergence = { step: n, component: i, ulp };
        }
      }
      y.set(tsNext);
    }
    expect(firstDivergence).toBeUndefined();
    expect(worst).toBe(0);
  });

  it("matches bit-for-bit across a spread of states, step sizes and regimes", () => {
    const states: readonly (readonly number[])[] = [
      [0, 0, 0, 0], // at rest: drag is exactly zero, no division by |v|
      [0, 0, WX, WY], // moving exactly with the wind: v_rel is exactly zero
      [-500, 2000, -120, -95], // descending, negative quadrant
      [1e6, 1e-6, 1e-8, 1e8], // wide exponent spread
      [0, 10, 1e-300, 1e-300], // subnormal-adjacent speeds
      [0, 10, 900, 0.5], // transonic-ish speed, though Cd is constant here
    ];
    const steps = [1e-6, 1 / 1024, 1 / 64, 0.5, 2];

    for (const s of states) {
      for (const h of steps) {
        const y = Float64Array.from(s);
        const tsNext = ts.step(0.75, y, h);
        wasm.setState(y);
        wasm.step(0.75, h);
        for (let i = 0; i < 4; i++) {
          expect({
            state: s,
            h,
            i,
            ulp: ulpDistance(wasm.state[i]!, tsNext[i]!),
          }).toEqual({ state: s, h, i, ulp: 0 });
        }
      }
    }
  });

  it("agrees with the TS on the sign of zero, which a tolerance would not check", () => {
    // v_rel exactly zero makes drag exactly zero, and the accumulated force in
    // x is then `0 + (-0 * 0)`. Whether that lands on +0 or -0 is a property of
    // the operation order, so it is worth asserting explicitly rather than
    // leaving to the loops above.
    const y0 = Float64Array.from([0, 100, WX, WY]);
    const tsNext = ts.step(0, y0, 1 / 64);
    wasm.setState(y0);
    wasm.step(0, 1 / 64);
    for (let i = 0; i < 4; i++) {
      expect(Object.is(wasm.state[i], tsNext[i])).toBe(true);
    }
  });

  it("step_n(n) equals n calls to step, so the batch entry point is not a second implementation", () => {
    const y0 = Float64Array.from([0, 2, 60, 45]);
    const h = 1 / 100;
    const n = 250;

    wasm.setState(y0);
    for (let i = 0; i < n; i++) wasm.step(i * h, h);
    const stepped = Float64Array.from(wasm.state);

    wasm.setState(y0);
    wasm.stepN(0, h, n);

    for (let i = 0; i < 4; i++) {
      expect(Object.is(wasm.state[i], stepped[i]!)).toBe(true);
    }
  });

  it("advances the state through the same memory the host holds a view of", () => {
    // Guards the zero-copy claim: if the kernel ever returned a copy, or grew
    // its memory and detached this view, `state` would stop tracking.
    const before = Float64Array.from([0, 5, 10, 10]);
    wasm.setState(before);
    const view = wasm.state;
    wasm.step(0, 1 / 64);
    expect(view).toBe(wasm.state);
    expect(view[1]).not.toBe(before[1]);
  });
});
