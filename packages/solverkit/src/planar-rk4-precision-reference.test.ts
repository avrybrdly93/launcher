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
import { describe, expect, it } from "vitest";
import { ClassicalRK4Stepper } from "./classical-rk4-stepper.js";
import { createStepResult } from "./types.js";
import {
  DIM,
  createPlanarRk4Scratch,
  stepPlanarRk4,
  VX,
  VY,
  X,
  Y,
  identity,
  initPlanarStateF32,
  integratePlanarRk4,
  planarDragRhs,
  roundParams,
  toF32,
  type PlanarDragParams,
} from "./planar-rk4-precision-reference.js";

/**
 * P7.14's reference: what "CPU f32 mode" means for a GPU kernel comparison.
 *
 * **The first describe block is the one that matters.** Everything this module
 * claims about f32 rests on the f64 path being the repository's own RK4 rather
 * than a lookalike, and that is asserted to the **bit** against
 * `ClassicalRK4Stepper` driven over `createPlanarProjectileModel`. If that
 * assertion ever fails, the f32 numbers below stop being about precision and
 * start being about a transcription error, which is exactly the confound
 * P7.11's golden exists to prevent elsewhere.
 */

/** A standard lofted flight: 45 degrees, 60 m/s, a 145 g / 5 cm sphere at Cd 0.47. */
const LAUNCH_SPEED = 60;
const LAUNCH_ANGLE = Math.PI / 4;
const MASS = 0.145;
const RADIUS = 0.05;
const CD = 0.47;
const GRAVITY = 9.80665;
const WIND_X = 3;
const WIND_Y = -1;
const H = 0.01;
const STEPS = 400;

const Y0 = [
  0,
  0,
  LAUNCH_SPEED * Math.cos(LAUNCH_ANGLE),
  LAUNCH_SPEED * Math.sin(LAUNCH_ANGLE),
] as const;

/** The same environment constants the engine would sample, read from the engine itself. */
function engineConstants(): { rho: number; g: number; area: number } {
  const environment = new Environment(
    new ConstantAtmosphere(),
    new UniformGravity(GRAVITY),
    new UniformWind(WIND_X, WIND_Y),
  );
  const params = createSphericalProjectileParams({
    mass: MASS,
    radius: RADIUS,
    dragCoefficient: new ConstantCd(CD),
  });
  const ctx = createEvalContext(environment, params);
  environment.sample(0, 0, 0, ctx.env);
  return { rho: ctx.env.rho, g: ctx.env.g, area: params.area };
}

function referenceParams(): PlanarDragParams {
  const { rho, g, area } = engineConstants();
  return { mass: MASS, area, cd: CD, rho, g, windX: WIND_X, windY: WIND_Y };
}

/** Integrates the engine's own model with the engine's own RK4 stepper. */
function integrateWithEngine(steps: number): Float64Array {
  const environment = new Environment(
    new ConstantAtmosphere(),
    new UniformGravity(GRAVITY),
    new UniformWind(WIND_X, WIND_Y),
  );
  const params = createSphericalProjectileParams({
    mass: MASS,
    radius: RADIUS,
    dragCoefficient: new ConstantCd(CD),
  });
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const stepper = new ClassicalRK4Stepper();
  const ctx = createEvalContext(environment, params);
  stepper.init(model, ctx);

  const out = createStepResult(model.dim);
  const y = new Float64Array(DIM);
  for (let i = 0; i < DIM; i++) y[i] = Y0[i]!;

  for (let i = 0; i < steps; i++) {
    stepper.step(i * H, y, H, out);
    y.set(out.yNext);
  }
  return y;
}

describe("the f64 path is the repository's RK4, asserted to the bit", () => {
  it("reproduces ClassicalRK4Stepper over createPlanarProjectileModel exactly", () => {
    const mine = integratePlanarRk4({
      y0: Y0,
      h: H,
      steps: STEPS,
      params: referenceParams(),
      round: identity,
    });
    const theirs = integrateWithEngine(STEPS);

    // Bit-identity, not a tolerance. A tolerance here would pass a transcription
    // error in the operation order -- which is precisely the defect class
    // `explicit-rk-kernel.ts` documents and P7.07 actually shipped -- because
    // such an error is small at most step counts and only occasionally large
    // (P7.11 swept it: ~3.7e-16 at 1 step, ~1.5e-12 at 400).
    for (let i = 0; i < DIM; i++) {
      expect(Object.is(mine[i]!, theirs[i]!)).toBe(true);
    }
  });

  it("still matches bit-for-bit after a single step, where an association error is smallest", () => {
    const mine = integratePlanarRk4({
      y0: Y0,
      h: H,
      steps: 1,
      params: referenceParams(),
      round: identity,
    });
    const theirs = integrateWithEngine(1);
    for (let i = 0; i < DIM; i++) {
      expect(Object.is(mine[i]!, theirs[i]!)).toBe(true);
    }
  });
});

describe("fround around an f64 operation is the f32 operation", () => {
  // The claim the whole f32 path rests on, checked rather than asserted in
  // prose. `Float32Array` round-trips are the reference: storing into one is
  // defined to round to binary32, so `f32[0] = a op b` with binary32 inputs is
  // the correctly-rounded binary32 result by construction.
  const probe = new Float32Array(1);
  const f32 = (x: number): number => {
    probe[0] = x;
    return probe[0]!;
  };

  const samples = [
    1,
    0.5,
    3,
    7,
    0.1,
    9.80665,
    1.2255,
    0.47,
    60,
    42.42640687119285,
    1e-8,
    1e8,
    1 / 3,
    2 / 3,
    123456.789,
    0.0078125,
    5e-39,
    3.4e38,
  ].map((v) => f32(v));

  it("agrees for +, -, * and / across a spread of magnitudes", () => {
    for (const a of samples) {
      for (const b of samples) {
        expect(Object.is(Math.fround(a + b), f32(a + b))).toBe(true);
        expect(Object.is(Math.fround(a - b), f32(a - b))).toBe(true);
        expect(Object.is(Math.fround(a * b), f32(a * b))).toBe(true);
        expect(Object.is(Math.fround(a / b), f32(a / b))).toBe(true);
      }
    }
  });

  it("agrees for sqrt, the other operation the rhs performs", () => {
    for (const a of samples) {
      expect(Object.is(Math.fround(Math.sqrt(a)), f32(Math.sqrt(a)))).toBe(true);
    }
  });

  it("keeps a rounded parameter block fixed under a second rounding", () => {
    // Idempotence is what lets the module round parameters once on entry rather
    // than at every use, which is what makes the double-rounding argument apply
    // to every operation in the rhs.
    const once = roundParams(referenceParams(), toF32);
    const twice = roundParams(once, toF32);
    expect(twice).toStrictEqual(once);
  });
});

describe("every rhs intermediate is rounded, checked against an independent evaluator", () => {
  /**
   * This block exists because a control found a hole rather than confirming a
   * green. Replacing the drag factor's rounded chain with a single f64
   * expression -- one un-rounded intermediate, exactly the defect that makes a
   * "true f32" reference untrue -- left all sixteen of the other tests passing.
   * The state-channel checks only see the step's *output*, which is rounded on
   * the way out either way, so an internal f64 intermediate hides inside them.
   *
   * The fix is a second evaluator written in a different style: every
   * intermediate goes through a `Float32Array` slot, which is the language's own
   * definition of rounding to binary32 and shares no code with {@link toF32}.
   * Agreement to the bit over a spread of inputs is then a real statement about
   * where rounding happens, not a restatement of the implementation.
   */
  const slot = new Float32Array(1);
  const r = (x: number): number => {
    slot[0] = x;
    return slot[0]!;
  };

  /** The planar rhs with every intermediate forced through binary32 storage. */
  function independentF32Rhs(y: Float64Array, p: PlanarDragParams): Float64Array {
    const vx = y[VX]!;
    const vy = y[VY]!;
    const vRelX = r(vx - p.windX);
    const vRelY = r(vy - p.windY);
    const sq = r(r(r(vRelX * vRelX) + r(vRelY * vRelY)));
    const speedRel = r(Math.sqrt(sq));
    const half = r(0.5 * p.rho);
    const halfCd = r(half * p.cd);
    const halfCdArea = r(halfCd * p.area);
    const k = r(halfCdArea * speedRel);
    const gravity = r(-p.mass * p.g);
    const f0 = r(0 + r(-k * vRelX));
    const f1 = r(gravity + r(-k * vRelY));
    return new Float64Array([vx, vy, r(f0 / p.mass), r(f1 / p.mass)]);
  }

  it("agrees bit-for-bit with an independent Float32Array evaluator", () => {
    const params = roundParams(referenceParams(), toF32);
    const out = new Float64Array(DIM);

    // A deterministic spread, including the adversarial cases: wind-matched
    // (speedRel exactly 0), at rest, straight up, straight down, very fast, and
    // very slow relative motion where the subtraction cancels hardest.
    const states: number[][] = [
      [0, 0, 42.4264, 42.4264],
      [0, 100, WIND_X, WIND_Y],
      [0, 0, 0, 0],
      [0, 50, 0, 80],
      [0, 50, 0, -80],
      [0, 10, 300, -300],
      [0, 10, WIND_X + 1e-7, WIND_Y - 1e-7],
      [0, 10, -12.5, 0.03125],
      [0, 10, 1e-6, 1e-6],
      [0, 10, 1234.5, -0.0009765625],
    ];
    let seed = 0x9e3779b9;
    for (let n = 0; n < 400; n++) {
      // xorshift32, so the sweep is wide and reproducible without a dependency.
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      const u = seed / 0x1_0000_0000;
      states.push([0, 100 * u, 200 * (u - 0.5), 200 * (u * 7919 - Math.floor(u * 7919) - 0.5)]);
    }

    for (const s of states) {
      const y = initPlanarStateF32(s);
      planarDragRhs(0, y, out, params, toF32);
      const expected = independentF32Rhs(y, params);
      for (let i = 0; i < DIM; i++) {
        expect(Object.is(out[i]!, expected[i]!)).toBe(true);
      }
    }
  });
});

describe("every STEP intermediate is rounded too, tableau coefficients included", () => {
  /**
   * The rhs check above does not cover the stepper, and a second defect lived
   * in exactly that gap: `b = [1/6, 1/3, 1/3, 1/6]` has two entries that are
   * **not representable in binary32**, so `f64(1/6) * f32(k)` rounded once is
   * not `f32(1/6) * f32(k)`. Over 200000 sampled `k`, the two forms disagree on
   * **33.5%** of products. A WGSL kernel computes the second; the reference
   * originally computed the first.
   *
   * This block is the rhs check extended to a whole step, with the tableau
   * written out longhand in the independent evaluator so a coefficient that
   * fails to round has nowhere to hide.
   */
  const slot = new Float32Array(1);
  const r = (x: number): number => {
    slot[0] = x;
    return slot[0]!;
  };

  const B32 = [r(1 / 6), r(1 / 3), r(1 / 3), r(1 / 6)];
  const A32 = [r(0.5), r(0.5), r(1)];

  function independentF32Step(y: Float64Array, h: number, p: PlanarDragParams): Float64Array {
    const rhs = (yy: Float64Array): Float64Array => {
      const out = new Float64Array(DIM);
      planarDragRhs(0, yy, out, p, toF32);
      return out;
    };
    const hh = r(h);

    const k1 = rhs(y);
    const s2 = new Float64Array(DIM);
    for (let i = 0; i < DIM; i++) s2[i] = r(y[i]! + r(r(hh * A32[0]!) * k1[i]!));
    const k2 = rhs(s2);
    const s3 = new Float64Array(DIM);
    for (let i = 0; i < DIM; i++) {
      // The zero `a` entry is multiplied, not skipped, exactly as the module does.
      const withZero = r(y[i]! + r(r(hh * r(0)) * k1[i]!));
      s3[i] = r(withZero + r(r(hh * A32[1]!) * k2[i]!));
    }
    const k3 = rhs(s3);
    const s4 = new Float64Array(DIM);
    for (let i = 0; i < DIM; i++) {
      let acc = r(y[i]! + r(r(hh * r(0)) * k1[i]!));
      acc = r(acc + r(r(hh * r(0)) * k2[i]!));
      s4[i] = r(acc + r(r(hh * A32[2]!) * k3[i]!));
    }
    const k4 = rhs(s4);

    const out = new Float64Array(DIM);
    const ks = [k1, k2, k3, k4];
    for (let i = 0; i < DIM; i++) {
      let weighted = 0;
      for (let s = 0; s < 4; s++) weighted = r(weighted + r(B32[s]! * ks[s]![i]!));
      out[i] = r(y[i]! + r(hh * weighted));
    }
    return out;
  }

  it("agrees bit-for-bit with an independent longhand f32 step", () => {
    const params = roundParams(referenceParams(), toF32);
    const scratch = createPlanarRk4Scratch();
    const out = new Float64Array(DIM);

    for (const h of [0.01, 0.001, 0.1]) {
      for (const s of [
        [0, 0, 42.4264, 42.4264],
        [0, 120, 30, -5],
        [0, 10, WIND_X, WIND_Y],
        [0, 0, 0, 0],
        [0, 80, -60, 0.25],
      ]) {
        const y = initPlanarStateF32(s);
        stepPlanarRk4(0, y, Math.fround(h), params, toF32, scratch, out);
        const expected = independentF32Step(y, h, params);
        for (let i = 0; i < DIM; i++) {
          expect(Object.is(out[i]!, expected[i]!)).toBe(true);
        }
      }
    }
  });
});

describe("true f32 and storage-rounded f32 are different objects", () => {
  /**
   * Storage-rounded f32, as `integrate.ts` implements
   * `SolverConfig.precision = "float32"`: f64 arithmetic throughout a step,
   * `Math.fround` applied to the accepted state between steps. Reproduced here
   * over the same stepper so the comparison isolates *where* the rounding
   * happens and nothing else.
   */
  function integrateStorageRounded(steps: number, h: number = H): Float64Array {
    const environment = new Environment(
      new ConstantAtmosphere(),
      new UniformGravity(GRAVITY),
      new UniformWind(WIND_X, WIND_Y),
    );
    const params = createSphericalProjectileParams({
      mass: MASS,
      radius: RADIUS,
      dragCoefficient: new ConstantCd(CD),
    });
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const stepper = new ClassicalRK4Stepper();
    const ctx = createEvalContext(environment, params);
    stepper.init(model, ctx);

    const out = createStepResult(model.dim);
    const y = new Float64Array(DIM);
    for (let i = 0; i < DIM; i++) y[i] = Math.fround(Y0[i]!);

    for (let i = 0; i < steps; i++) {
      stepper.step(i * h, y, h, out);
      y.set(out.yNext);
      for (let c = 0; c < DIM; c++) y[c] = Math.fround(y[c]!);
    }
    return y;
  }

  /** Worst relative difference over the four channels, and the channel index. */
  function worstRelative(a: Float64Array, b: Float64Array): number {
    let worst = 0;
    for (let i = 0; i < DIM; i++) {
      const denominator = Math.abs(b[i]!);
      if (denominator === 0) continue;
      worst = Math.max(worst, Math.abs(a[i]! - b[i]!) / denominator);
    }
    return worst;
  }

  it("are genuinely different objects: they disagree on at least one fixture", () => {
    // The definitions are not the same computation, and this is the assertion
    // that says so. It is deliberately "at least one fixture" and not "every
    // fixture": at h=0.01 / 2000 steps the projectile has reached terminal
    // velocity and the two modes agree to the bit, which is a fact about that
    // fixture rather than about the definitions.
    const sweep = [100, 400, 1000, 2000];
    const differs = sweep.some((steps) => {
      const trueF32 = integratePlanarRk4({
        y0: Y0,
        h: 0.001,
        steps,
        params: referenceParams(),
        round: toF32,
      });
      const storage = integrateStorageRounded(steps, 0.001);
      return worstRelative(trueF32, storage) > 0;
    });
    expect(differs).toBe(true);
  });

  it("nevertheless agree far inside 1e-4, which falsifies the claim's T4", () => {
    // T4 predicted these two modes would differ by MORE than the 1e-4 relative
    // bound P7.14's criterion names. **They do not, and the prediction is
    // recorded as wrong rather than quietly dropped.** Measured across the
    // sweep below: worst 1.50e-6, at h=0.001 / 2000 steps on `vy` -- roughly
    // 66x inside the gate, and most fixtures are two orders better still.
    //
    // The consequence is the useful part, and it retires a question the 95th,
    // 96th and 97th runs each carried forward: **at 1e-4, it does not matter
    // which definition of "CPU f32 mode" P7.14 means.** A GPU kernel validated
    // against either one gets the same verdict. The distinction is real (the
    // test above) and, at this tolerance, immaterial.
    //
    // The bound here is 1e-5, an order above the worst measurement and two
    // below the criterion's gate, so this fails if the modes ever diverge
    // enough for the choice to start mattering.
    for (const [h, steps] of [
      [0.01, 100],
      [0.01, 400],
      [0.01, 1000],
      [0.001, 1000],
      [0.001, 2000],
      [0.001, 4000],
    ] as const) {
      const trueF32 = integratePlanarRk4({
        y0: Y0,
        h,
        steps,
        params: referenceParams(),
        round: toF32,
      });
      const storage = integrateStorageRounded(steps, h);
      expect(worstRelative(trueF32, storage)).toBeLessThan(1e-5);
    }
  });

  it("agree exactly at zero steps, so the difference is accumulated and not an input mismatch", () => {
    // Guards the comparison itself: both modes must start from the same
    // binary32 state, or the divergence above would be partly a setup artefact.
    const trueF32 = integratePlanarRk4({
      y0: Y0,
      h: H,
      steps: 0,
      params: referenceParams(),
      round: toF32,
    });
    const storage = integrateStorageRounded(0);
    for (let i = 0; i < DIM; i++) {
      expect(Object.is(trueF32[i]!, storage[i]!)).toBe(true);
    }
  });
});

describe("P7.14's 1e-4 RELATIVE gate is not a property of the kernel", () => {
  /**
   * T5 of the claim, confirmed and **worse than the warning it inherited**.
   *
   * The 95th run measured the f64 case at 1.5e-12 against a 1e-12 gate and the
   * 97th warned the f32 case would be far coarser near a `vy` zero crossing.
   * P7.11 made the same finding for the backend-equivalence golden and resolved
   * it by gating on ULP rather than on a relative difference.
   *
   * Measured here, on the same trajectory at h=0.001, comparing true-f32
   * against f64 -- which is the comparison P7.14's criterion actually performs:
   *
   * ```
   *   t=2.050s  vy= 1.538e+0   abs(vy)=3.343e-6   rel(vy)=2.173e-6
   *   t=2.150s  vy= 5.093e-1   abs(vy)=3.002e-6   rel(vy)=5.893e-6
   *   t=2.200s  vy= 4.342e-3   abs(vy)=2.927e-6   rel(vy)=6.743e-4
   * ```
   *
   * **The absolute error is flat -- it moves by 12% across the whole sweep --
   * while the relative error moves by a factor of 310 and crosses the gate.**
   * Nothing about the kernel's accuracy changed between t=2.150s and t=2.200s.
   * What changed is that the denominator passed through zero.
   *
   * So "1e4 trajectories match CPU f32 mode within 1e-4 rel" is met or missed
   * according to where a fixture's last step happens to land relative to apex.
   * That is not a statement about a GPU kernel, and P7.14 should not be gated
   * on it as written. The recommendation carried into the task's notes is the
   * one P7.11 already adopted for the same reason: gate on absolute error per
   * channel, or on ULP, and keep the relative figure as documentation.
   */
  const H_FINE = 0.001;

  function absoluteAndRelativeVyError(steps: number): { abs: number; rel: number } {
    const params = referenceParams();
    const trueF32 = integratePlanarRk4({ y0: Y0, h: H_FINE, steps, params, round: toF32 });
    const f64 = integratePlanarRk4({ y0: Y0, h: H_FINE, steps, params, round: identity });
    const abs = Math.abs(trueF32[VY]! - f64[VY]!);
    return { abs, rel: abs / Math.abs(f64[VY]!) };
  }

  it("passes at t=2.150s and fails at t=2.200s while the absolute error barely moves", () => {
    const before = absoluteAndRelativeVyError(2150);
    const after = absoluteAndRelativeVyError(2200);

    // The gate's verdict flips...
    expect(before.rel).toBeLessThan(1e-4);
    expect(after.rel).toBeGreaterThan(1e-4);

    // ...while the thing it is supposed to be measuring does not. Both absolute
    // errors sit near 3.1e-6; asserting they stay within a factor of two of each
    // other is what makes this a demonstration rather than a coincidence.
    expect(after.abs).toBeGreaterThan(before.abs / 2);
    expect(after.abs).toBeLessThan(before.abs * 2);
  });

  it("puts the whole flight comfortably inside 1e-4 when measured absolutely", () => {
    // The counter-proposal, measured: on the same sweep the absolute error on
    // every channel's velocity stays far below the gate. This is the figure a
    // rewritten criterion would use.
    for (const steps of [2050, 2100, 2150, 2200]) {
      expect(absoluteAndRelativeVyError(steps).abs).toBeLessThan(1e-4);
    }
  });

  it("is a distinction rather than a ban on relative tolerances", () => {
    // The 96th run's checksum guard is the counter-example and it is preserved
    // here: a relative bound on a quantity that stays far from zero is fine.
    // `x` grows monotonically and never approaches zero after launch, so its
    // relative error stays tiny exactly where `vy`'s blows up.
    const params = referenceParams();
    const trueF32 = integratePlanarRk4({ y0: Y0, h: H_FINE, steps: 2200, params, round: toF32 });
    const f64 = integratePlanarRk4({ y0: Y0, h: H_FINE, steps: 2200, params, round: identity });
    const relX = Math.abs(trueF32[X]! - f64[X]!) / Math.abs(f64[X]!);
    expect(relX).toBeLessThan(1e-5);
  });
});

describe("the f32 path stays in f32", () => {
  it("emits only binary32-representable values at every step", () => {
    // The property that makes this a faithful GPU reference: no channel may
    // carry a value a WGSL f32 register could not hold. One un-rounded
    // operation anywhere in the step would show up here.
    const probe = new Float32Array(1);
    integratePlanarRk4({
      y0: Y0,
      h: H,
      steps: 200,
      params: referenceParams(),
      round: toF32,
      onStep: (_step, _t, y) => {
        for (let i = 0; i < DIM; i++) {
          probe[0] = y[i]!;
          expect(Object.is(probe[0]!, y[i]!)).toBe(true);
        }
      },
    });
  });

  it("rounds the initial state to binary32 via initPlanarStateF32", () => {
    const y = initPlanarStateF32([0, 0, 1 / 3, 2 / 3]);
    expect(y[VX]!).toBe(Math.fround(1 / 3));
    expect(y[VY]!).toBe(Math.fround(2 / 3));
  });
});

describe("the rhs edge cases a GPU kernel will also hit", () => {
  const params = referenceParams();

  it("produces zero drag and pure gravity when the projectile matches the wind exactly", () => {
    // speedRel is exactly 0, so the drag factor is 0 and the only acceleration
    // is gravity. A kernel that divided by speedRel would produce NaN here; a
    // kernel that normalised vRel would too. This module does neither, and the
    // test pins that.
    const y = new Float64Array([0, 100, WIND_X, WIND_Y]);
    const out = new Float64Array(DIM);
    planarDragRhs(0, y, out, roundParams(params, toF32), toF32);

    expect(out[X]!).toBe(Math.fround(WIND_X));
    expect(out[Y]!).toBe(Math.fround(WIND_Y));
    expect(out[VX]!).toBe(0);
    expect(out[VY]!).toBe(Math.fround(Math.fround(-params.mass * params.g) / params.mass));
    expect(Number.isNaN(out[VY]!)).toBe(false);
  });

  it("is finite at rest with no wind, the other speedRel-zero case", () => {
    const still: PlanarDragParams = { ...params, windX: 0, windY: 0 };
    const y = new Float64Array([0, 0, 0, 0]);
    const out = new Float64Array(DIM);
    planarDragRhs(0, y, out, roundParams(still, toF32), toF32);
    for (let i = 0; i < DIM; i++) expect(Number.isFinite(out[i]!)).toBe(true);
    expect(out[VX]!).toBe(0);
  });

  it("multiplies the zero tableau entries rather than skipping them", () => {
    // Not directly observable from the outputs -- adding +-0.0 to a finite
    // accumulator is exact -- so this asserts the consequence that *is*
    // observable: a zero-length flight leaves the state untouched, which
    // requires every stage to have been formed without a spurious term.
    const y = integratePlanarRk4({
      y0: Y0,
      h: 0,
      steps: 3,
      params,
      round: identity,
    });
    expect(y[X]!).toBe(Y0[X]);
    expect(y[Y]!).toBe(Y0[Y]);
  });
});
