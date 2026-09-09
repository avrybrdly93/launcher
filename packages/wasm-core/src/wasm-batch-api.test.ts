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
import { OBS, PARAM, WasmRk4Kernel } from "./wasm-rk4-backend.js";

/**
 * P7.08's validation criterion: "1e4 batch round-trip; no per-call allocation".
 *
 * Two halves, and each is measured rather than argued:
 *
 * - **The round-trip** is 1e4 replicates written into the arena, integrated in
 *   one call, and read back out -- and every row is checked against the
 *   single-state path P7.07 already proved bit-identical to the TypeScript
 *   stepper. `Object.is` on raw doubles, not a tolerance. P7.07's own finding
 *   was that a 1e-15 tolerance would have passed a kernel whose final increment
 *   had been reassociated; a batch loop that reorders operations is the same
 *   failure wearing a different hat, and only bit-identity catches it.
 *
 * - **The allocation half** is watched at the only place a WASM module without
 *   an allocator can obtain memory: `memory.grow`, observable as
 *   `kernel.memoryBytes`. Counting JavaScript-side allocations instead would be
 *   P7.06's dead instrument -- it would measure the binding, not the kernel.
 *
 * The growth path is exercised rather than documented. P7.07 built its two
 * views once and noted that growth would detach them; 1e4 replicates need
 * ~1.36 MB and force exactly that, so the first test here is the one P7.07
 * could not write.
 */

/** The one configuration the kernel targets, matching `wasm-ts-equivalence.test.ts`. */
const CD = 0.47;
const MASS = 0.145;
const RADIUS = 0.0366;
const WX = 3.5;
const WY = -1.25;

const REPLICATES = 10_000;

function makeTsSide(): {
  step: (t: number, y: Float64Array, h: number) => Float64Array;
  area: number;
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
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const ctx = createEvalContext(environment, params);
  const stepper = new ClassicalRK4Stepper();
  stepper.init(model, ctx);
  const out = createStepResult(model.dim);
  environment.sample(0, 0, 0, ctx.env);

  return {
    step(t, y, h) {
      stepper.step(t, y, h, out);
      return Float64Array.from(out.yNext);
    },
    area: params.area,
    rho: ctx.env.rho,
    g: ctx.env.g,
  };
}

/**
 * A deterministic spread of replicates. Not random: a failing run has to be
 * reproducible from the test alone, and a seeded PRNG here would be a second
 * thing to get right for no gain.
 */
function replicateParams(r: number, area: number, rho: number, g: number): readonly number[] {
  // Mass and Cd vary too, so the batch is exercised as a genuinely
  // heterogeneous ensemble rather than one problem run 1e4 times.
  return [MASS * (1 + (r % 97) / 500), area, CD * (1 + (r % 31) / 200), rho, g, WX, WY];
}

/**
 * `vy` deliberately spans descending, quickly-peaking and still-rising
 * replicates.
 *
 * An earlier draft launched every replicate steeply upward, and over the
 * window below not one of them reached its apex -- so the running-max
 * assertion in the round-trip test compared the final `y` against the final
 * `y` and would have passed a kernel that never tracked a maximum at all. It
 * did: a control build that wrote `y[Y]` into slot 5 instead of the running
 * max left that test green. The spread here is what makes the assertion bite.
 */
function replicateState(r: number): readonly number[] {
  return [0, 1.5 + (r % 13) * 0.25, 40 + (r % 71) * 0.5, -5 + (r % 53) * 0.4];
}

describe("the WASM batch API round-trips 1e4 replicates", () => {
  let ts: ReturnType<typeof makeTsSide>;
  let kernel: WasmRk4Kernel;
  let bytesBeforeInit: number;
  let staleStateView: Float64Array;

  beforeAll(async () => {
    ts = makeTsSide();
    kernel = await WasmRk4Kernel.instantiate();
    bytesBeforeInit = kernel.memoryBytes;
    staleStateView = kernel.state;
    kernel.batchInit(REPLICATES);
  });

  it("grows linear memory to reserve the arena, which is the case P7.07 could not reach", () => {
    // 1e4 * (7 params + 4 state + 6 observables) * 8 bytes = 1.36 MB, against
    // an initial memory well under that. If this ever stops growing, the
    // detach-and-rebuild path below is no longer being exercised and the
    // "no per-call allocation" test loses its control.
    expect(kernel.memoryBytes).toBeGreaterThan(bytesBeforeInit);
    expect(kernel.batchCapacity).toBe(REPLICATES);
    expect(kernel.obsCount).toBe(6);
  });

  it("detaches the views held across that growth, and hands back live ones", () => {
    // The failure this guards is silent: a caller holding `kernel.state` from
    // before the grow sees a zero-length view and writes that go nowhere.
    expect(staleStateView.byteLength).toBe(0);
    // Identity via `Object.is` rather than `expect(...).not.toBe(...)`: the
    // matcher iterates both sides to build a diff, and iterating a detached
    // typed array throws before the assertion can be made.
    expect(Object.is(kernel.state, staleStateView)).toBe(false);
    expect(kernel.state.length).toBe(4);
    expect(kernel.params.length).toBe(7);

    // And the rebuilt single-state view is genuinely live in the grown memory.
    kernel.setState([1, 2, 3, 4]);
    expect(Array.from(kernel.state)).toEqual([1, 2, 3, 4]);
  });

  it("sizes the three batch views to the reserved capacity", () => {
    expect(kernel.batchParams.length).toBe(REPLICATES * 7);
    expect(kernel.batchStates.length).toBe(REPLICATES * 4);
    expect(kernel.batchObservables.length).toBe(REPLICATES * kernel.obsCount);
  });

  it("returns one row per replicate, each bit-identical to the single-state path", () => {
    const h = 1 / 128;
    // 0.5 s of flight, long enough that the low-`vy` half of the ensemble
    // passes its apex inside the window. See `replicateState`.
    const steps = 64;
    const { batchParams, batchStates } = kernel;

    for (let r = 0; r < REPLICATES; r++) {
      batchParams.set(replicateParams(r, ts.area, ts.rho, ts.g), r * 7);
      batchStates.set(replicateState(r), r * 4);
    }

    kernel.batchRun(0, h, steps, REPLICATES);
    // Copied out before the comparison loop touches `params`/`state`, which
    // live in the same memory. Comparing against a view the reference run is
    // about to overwrite would compare a number with itself.
    const obs = Float64Array.from(kernel.batchObservables);

    // Every replicate, not a sample: the criterion says 1e4 and a sampled check
    // would leave 1e4 unverified. Only the first divergence is reported --
    // 1e4 * 6 `expect` calls is slow enough to matter and says nothing more.
    let firstDivergence:
      { replicate: number; slot: number; batch: number; reference: number } | undefined;
    let maxSampledMismatch: number | undefined;
    // Coverage of the fixture itself, asserted below. Without it the
    // running-max check silently degrades to "final y equals final y" the
    // moment someone retunes the ensemble, which is how the vacuous version of
    // this test survived its first control run.
    let peakedInsideWindow = 0;

    const oc = kernel.obsCount;
    for (let r = 0; r < REPLICATES && firstDivergence === undefined; r++) {
      const p = replicateParams(r, ts.area, ts.rho, ts.g);
      kernel.setParams({
        mass: p[PARAM.mass]!,
        area: p[PARAM.area]!,
        cd: p[PARAM.cd]!,
        rho: p[PARAM.rho]!,
        g: p[PARAM.g]!,
        wx: p[PARAM.wx]!,
        wy: p[PARAM.wy]!,
      });
      kernel.setState(replicateState(r));

      // The reference for slot 5 is built here rather than trusted: a running
      // max over exactly the rows the single-state path visits, initial state
      // included. That is the definition, and pinning it against an
      // independently-written max is what stops it drifting into something
      // apex-shaped later.
      let expectedMax = kernel.state[1]!;
      for (let i = 0; i < steps; i++) {
        kernel.step(i * h, h);
        if (kernel.state[1]! > expectedMax) expectedMax = kernel.state[1]!;
      }

      if (expectedMax > kernel.state[1]!) peakedInsideWindow++;

      const expected = [
        kernel.state[0]!,
        kernel.state[1]!,
        kernel.state[2]!,
        kernel.state[3]!,
        0 + steps * h,
        expectedMax,
      ];
      for (let slot = 0; slot < oc; slot++) {
        const got = obs[r * oc + slot]!;
        if (!Object.is(got, expected[slot]!)) {
          firstDivergence = { replicate: r, slot, batch: got, reference: expected[slot]! };
          break;
        }
      }
      if (
        maxSampledMismatch === undefined &&
        !Object.is(obs[r * oc + OBS.maxSampledHeight], expectedMax)
      ) {
        maxSampledMismatch = r;
      }
    }

    expect(firstDivergence).toBeUndefined();
    expect(maxSampledMismatch).toBeUndefined();
    // A meaningful fraction of the ensemble must actually peak inside the
    // window, or slot 5 is being compared against the final state and proves
    // nothing about the running max.
    expect(peakedInsideWindow).toBeGreaterThan(REPLICATES / 10);
  }, 60_000);

  it("allocates nothing per call: memory does not move across runs, or a re-init at or below capacity", () => {
    const bytes = kernel.memoryBytes;
    const paramsView = kernel.batchParams;
    const statesView = kernel.batchStates;
    const obsView = kernel.batchObservables;
    const stateView = kernel.state;

    for (let i = 0; i < 25; i++) {
      kernel.batchRun(i * 0.1, 1 / 256, 4, REPLICATES);
      expect(kernel.memoryBytes).toBe(bytes);
    }

    // Re-init at capacity and below it. Both must be no-ops in the kernel, and
    // the identity checks are the sharper assertion: if a view object had been
    // rebuilt, something moved even if the byte count happened to match.
    kernel.batchInit(REPLICATES);
    kernel.batchInit(1);
    kernel.batchInit(0);
    expect(kernel.memoryBytes).toBe(bytes);
    expect(kernel.batchCapacity).toBe(REPLICATES);
    expect(kernel.batchParams).toBe(paramsView);
    expect(kernel.batchStates).toBe(statesView);
    expect(kernel.batchObservables).toBe(obsView);
    expect(kernel.state).toBe(stateView);

    // ...and the single-state entry points allocate nothing either, so a mixed
    // workload cannot smuggle a grow past the loop above.
    kernel.setState([0, 10, 30, 20]);
    kernel.step(0, 1 / 64);
    kernel.stepN(0, 1 / 64, 100);
    expect(kernel.memoryBytes).toBe(bytes);
  });

  it("writes through to the host's view without a copy, and the arena is what the kernel reads", () => {
    // The zero-copy claim, stated as a behaviour rather than an implementation
    // note: a value written into the host's view changes the answer.
    kernel.batchStates.set([0, 0, 10, 0], 0);
    kernel.batchParams.set(replicateParams(0, ts.area, ts.rho, ts.g), 0);
    kernel.batchRun(0, 1 / 64, 8, 1);
    const slow = kernel.batchObservables[OBS.x]!;

    kernel.batchStates.set([0, 0, 200, 0], 0);
    kernel.batchRun(0, 1 / 64, 8, 1);
    const fast = kernel.batchObservables[OBS.x]!;

    expect(fast).toBeGreaterThan(slow);
  });
});

describe("the WASM batch API agrees with the TypeScript stepper", () => {
  it("is bit-identical to ClassicalRK4Stepper for every replicate in a small heterogeneous batch", async () => {
    // Params are held at the TS side's own values here, because varying mass or
    // Cd would need a rebuilt TS model per replicate; the initial state is the
    // axis a Monte Carlo actually varies, and it is what this varies. The
    // heterogeneous-parameter case is covered against the single-state path
    // above, which P7.07 proved equal to this same stepper.
    const ts = makeTsSide();
    const kernel = await WasmRk4Kernel.instantiate();
    const n = 8;
    const steps = 200;
    const h = 1 / 100;

    kernel.batchInit(n);
    for (let r = 0; r < n; r++) {
      kernel.batchParams.set([MASS, ts.area, CD, ts.rho, ts.g, WX, WY], r * 7);
      kernel.batchStates.set([0, 1 + r, 45 + r * 3, 30 - r * 2], r * 4);
    }
    kernel.batchRun(0, h, steps, n);
    const obs = Float64Array.from(kernel.batchObservables);
    const oc = kernel.obsCount;

    for (let r = 0; r < n; r++) {
      const y = Float64Array.from([0, 1 + r, 45 + r * 3, 30 - r * 2]);
      let expectedMax = y[1]!;
      for (let i = 0; i < steps; i++) {
        y.set(ts.step(i * h, y, h));
        if (y[1]! > expectedMax) expectedMax = y[1]!;
      }
      for (let c = 0; c < 4; c++) {
        expect(Object.is(obs[r * oc + c], y[c]!)).toBe(true);
      }
      expect(Object.is(obs[r * oc + OBS.tFinal], steps * h)).toBe(true);
      expect(Object.is(obs[r * oc + OBS.maxSampledHeight], expectedMax)).toBe(true);
    }
  }, 30_000);
});

describe("the WASM batch API's edges", () => {
  let kernel: WasmRk4Kernel;

  beforeAll(async () => {
    kernel = await WasmRk4Kernel.instantiate();
  });

  it("starts with empty batch views and zero capacity", () => {
    expect(kernel.batchCapacity).toBe(0);
    expect(kernel.batchParams.length).toBe(0);
    expect(kernel.batchStates.length).toBe(0);
    expect(kernel.batchObservables.length).toBe(0);
  });

  it("rejects a run before any reservation rather than writing to address zero", () => {
    expect(() => kernel.batchRun(0, 1 / 64, 1, 1)).toThrow(RangeError);
  });

  it("rejects a capacity that is not a non-negative integer", () => {
    expect(() => kernel.batchInit(-1)).toThrow(RangeError);
    expect(() => kernel.batchInit(1.5)).toThrow(RangeError);
    expect(() => kernel.batchInit(Number.NaN)).toThrow(RangeError);
  });

  it("rejects n beyond the reserved capacity", () => {
    kernel.batchInit(4);
    expect(() => kernel.batchRun(0, 1 / 64, 1, 5)).toThrow(RangeError);
  });

  it("accepts n = 0 and writes nothing", () => {
    kernel.batchInit(4);
    kernel.batchObservables.fill(-7);
    kernel.batchRun(0, 1 / 64, 10, 0);
    expect(Array.from(kernel.batchObservables).every((v) => v === -7)).toBe(true);
  });

  it("reports the initial state unchanged when steps is zero", () => {
    // The degenerate case that pins two definitions at once: t_final is t0 when
    // no step is taken, and the initial state counts as a sample for the
    // running max, so a replicate that never rises still reports its launch
    // height rather than zero.
    kernel.batchInit(1);
    kernel.batchParams.set([0.145, 0.004, 0.47, 1.225, 9.81, 0, 0], 0);
    kernel.batchStates.set([3, 17, 5, -2], 0);
    kernel.batchRun(1.25, 1 / 64, 0, 1);
    expect(Array.from(kernel.batchObservables.subarray(0, kernel.obsCount))).toEqual([
      3, 17, 5, -2, 1.25, 17,
    ]);
  });

  it("reports the launch height for a purely descending replicate", () => {
    kernel.batchInit(1);
    kernel.batchParams.set([0.145, 0.004, 0.47, 1.225, 9.81, 0, 0], 0);
    kernel.batchStates.set([0, 100, 10, -5], 0);
    kernel.batchRun(0, 1 / 64, 50, 1);
    expect(kernel.batchObservables[OBS.maxSampledHeight]).toBe(100);
    expect(kernel.batchObservables[OBS.y]).toBeLessThan(100);
  });
});
