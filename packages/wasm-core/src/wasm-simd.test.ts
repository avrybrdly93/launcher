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
import {
  OBS,
  WASM_ARTIFACT_PATH,
  WasmRk4Kernel,
  readWasmArtifact,
  readWasmSimdArtifact,
  wasmSimdSupported,
} from "./wasm-rk4-backend.js";

/**
 * P7.09's correctness half: the f64x2 batch path against the scalar one.
 *
 * The task's validation line is a speed criterion (">=1.8x vs scalar WASM on
 * batch benchmark") and `scripts/measure-simd-speedup.mjs` is what measures it.
 * This file is the other half, and it is the half that decides whether the
 * speed number means anything at all: **a faster kernel that computes something
 * else is not a faster kernel.**
 *
 * # Why these assertions are bit-identity and not a tolerance
 *
 * The claim, committed in ROADMAP.json before any of it was measured: the SIMD
 * path must agree with the scalar path to 0 ULP, for every replicate, under
 * `Object.is` on raw doubles. That is available rather than aspirational
 * because of how the lanes are assigned. Lane 0 is one replicate and lane 1 is
 * another; they never interact, so every scalar operation becomes exactly one
 * lane-wise instruction applied in exactly the same order. WebAssembly's
 * simd128 proposal has no fused multiply-add, so `a * b + c` rounds twice on
 * both paths, and `f64x2.sqrt` is correctly rounded per lane exactly as
 * `f64.sqrt` is. There is nothing left for the two to disagree about.
 *
 * A tolerance here would forfeit the whole point. P7.07 measured that
 * reassociating the final RK4 increment -- the single most plausible way to get
 * a vector kernel subtly wrong -- costs 1 ULP, which is ~1e-16 relative at
 * these magnitudes and would sail through any tolerance loose enough to be
 * worth writing.
 *
 * # The failure mode this file exists for
 *
 * Reassociation is P7.07's failure mode. **P7.09's own is a lane swap**: lane 0
 * written to replicate 1's row and lane 1 to replicate 0's. It produces
 * perfectly correct numbers in the wrong places, and against a homogeneous
 * ensemble it is completely invisible -- every row is right because every row
 * is the same. So the fixture below is heterogeneous in mass, `Cd`, initial
 * height and initial velocity, and one test asserts that adjacent replicates
 * genuinely differ before any comparison is trusted. That assertion is not
 * decoration; without it the whole file could pass while testing nothing, which
 * is precisely the trap P7.08 fell into with its running-max fixture.
 */

/** The one configuration the kernel targets, matching the other two suites. */
const CD = 0.47;
const MASS = 0.145;
const RADIUS = 0.0366;
const WX = 3.5;
const WY = -1.25;

/**
 * Odd on purpose. An even count would never exercise the tail replicate, and
 * the tail is where a pairing bug hides: `n / 2` pairs plus a scalar remainder
 * is exactly the arithmetic that goes wrong by one.
 */
const REPLICATES = 1001;

const H = 1 / 128;
/** 0.5 s of flight -- long enough that the low-`vy` half of the ensemble peaks inside it. */
const STEPS = 64;

/**
 * A TypeScript stepper for one replicate's mass and `Cd`.
 *
 * Parameterised rather than fixed so the chain back to `ClassicalRK4Stepper`
 * can be closed on replicates that actually differ from each other. A helper
 * pinned to one `(mass, Cd)` pair would only ever match the handful of
 * replicates whose modular arithmetic landed back on it -- one, here -- and a
 * chain closed at a single point is barely closed at all.
 */
function makeTsSide(
  mass: number = MASS,
  cd: number = CD,
): {
  step: (t: number, y: Float64Array, h: number) => Float64Array;
  area: number;
  rho: number;
  g: number;
} {
  const params = createSphericalProjectileParams({
    mass,
    radius: RADIUS,
    dragCoefficient: new ConstantCd(cd),
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

/** Deterministic, and heterogeneous in mass and `Cd` as well as in the state. */
function replicateParams(r: number, area: number, rho: number, g: number): readonly number[] {
  return [MASS * (1 + (r % 97) / 500), area, CD * (1 + (r % 31) / 200), rho, g, WX, WY];
}

/** Spans descending, quickly-peaking and still-rising replicates. See P7.08. */
function replicateState(r: number): readonly number[] {
  return [0, 1.5 + (r % 13) * 0.25, 40 + (r % 71) * 0.5, -5 + (r % 53) * 0.4];
}

function fillArena(kernel: WasmRk4Kernel, n: number, area: number, rho: number, g: number): void {
  const params = kernel.batchParams;
  const states = kernel.batchStates;
  for (let r = 0; r < n; r += 1) {
    params.set(replicateParams(r, area, rho, g), r * 7);
    states.set(replicateState(r), r * 4);
  }
}

/**
 * The next representable double above `v`, for `v` finite and positive.
 *
 * One ULP is the perturbation size that matters here: it is what P7.07 measured
 * a reassociated RK4 increment to cost, so a control that moved the value by
 * more than that would prove less than the tests it is checking.
 */
function nextUp(v: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, v);
  view.setBigUint64(0, view.getBigUint64(0) + 1n);
  return view.getFloat64(0);
}

/**
 * Index of the first slot on which the two rows differ, or -1.
 *
 * Returns an index rather than asserting, for two reasons: `expect` inside a
 * 6006-iteration loop is slow enough to trip vitest's default timeout under a
 * loaded run (P7.07 hit exactly that), and an index names *which* replicate
 * diverged, which is the difference between a bug report and "not equal".
 */
function firstDifference(a: Float64Array, b: Float64Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (!Object.is(a[i], b[i])) {
      return i;
    }
  }
  return a.length === b.length ? -1 : n;
}

describe("the simd128 feature detect", () => {
  it("agrees with this engine actually running a simd128 module", async () => {
    // The detect is a claim about the engine, so it is checked against the
    // engine rather than against itself: the real artifact is compiled, and
    // whether that succeeds is the ground truth the probe has to match.
    let engineRunsSimd: boolean;
    try {
      await WebAssembly.compile(await readWasmSimdArtifact());
      engineRunsSimd = true;
    } catch {
      engineRunsSimd = false;
    }
    expect(wasmSimdSupported()).toBe(engineRunsSimd);
  });

  it("is not a probe that returns true for anything", () => {
    // Without this, `wasmSimdSupported()` returning true would be equally
    // consistent with a correct detect and with a `validate` that never says
    // no -- and a detect that cannot fail is not a detect. Truncating the
    // module mid-instruction must be rejected.
    const truncated = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x0a]);
    expect(WebAssembly.validate(truncated)).toBe(false);
  });

  it("is memoised without changing its answer", () => {
    expect(wasmSimdSupported()).toBe(wasmSimdSupported());
  });
});

describe("artifact selection", () => {
  it("gives instantiateBest a kernel whose own report matches the detect", async () => {
    const kernel = await WasmRk4Kernel.instantiateBest();
    // `hasSimd` reads the module's `simd_enabled` export, not the detect, so
    // this compares two independent sources: what the engine can run, and what
    // was actually loaded. A selection bug makes them disagree.
    expect(kernel.hasSimd).toBe(wasmSimdSupported());
    expect(kernel.simdLanes).toBe(kernel.hasSimd ? 2 : 1);
  });

  it("gives the scalar artifact no SIMD path, and says so rather than falling back", async () => {
    // The fallback is exercised by loading it, not by trusting that the branch
    // exists: on an engine that supports simd128 -- which is every engine this
    // suite realistically runs on -- `instantiateBest` never takes that branch,
    // so nothing else here would ever compile the scalar artifact.
    const scalar = await WasmRk4Kernel.instantiate(await readWasmArtifact());
    expect(scalar.hasSimd).toBe(false);
    expect(scalar.simdLanes).toBe(1);
    scalar.batchInit(4);
    expect(() => scalar.batchRunSimd(0, H, 4, 4)).toThrow(TypeError);
    // Silently running the scalar path instead would be the worst outcome: the
    // benchmark would report 1.0x and nobody would know why.
    expect(() => scalar.batchRunSimd(0, H, 4, 4)).toThrow(/scalar artifact/);
  });

  it("still exposes the scalar batch path on the SIMD artifact", async () => {
    // Both paths live in the SIMD build, which is what lets the benchmark
    // compare them inside one module rather than across two builds whose
    // codegen could differ for reasons unrelated to SIMD.
    const kernel = await WasmRk4Kernel.instantiate(await readWasmSimdArtifact());
    kernel.batchInit(4);
    expect(() => kernel.batchRun(0, H, 4, 4)).not.toThrow();
  });

  it("reads the scalar artifact from the path the freshness suite checks", () => {
    expect(WASM_ARTIFACT_PATH).toMatch(/ballista-core\.wasm$/);
  });
});

describe.skipIf(!wasmSimdSupported())("the f64x2 batch path", () => {
  let ts: ReturnType<typeof makeTsSide>;
  let scalarRows: Float64Array;
  let simdRows: Float64Array;
  let kernel: WasmRk4Kernel;

  beforeAll(async () => {
    ts = makeTsSide();
    kernel = await WasmRk4Kernel.instantiate(await readWasmSimdArtifact());
    kernel.batchInit(REPLICATES);
    fillArena(kernel, REPLICATES, ts.area, ts.rho, ts.g);

    kernel.batchRun(0, H, STEPS, REPLICATES);
    scalarRows = Float64Array.from(kernel.batchObservables);

    // Deliberately zeroed between the two runs. Sharing the buffer means a
    // SIMD path that wrote nothing at all would otherwise "match" the scalar
    // rows left behind by the previous call -- the same shape of dead
    // instrument P7.06 found and P7.08 found again.
    kernel.batchObservables.fill(0);
    kernel.batchRunSimd(0, H, STEPS, REPLICATES);
    simdRows = Float64Array.from(kernel.batchObservables);
  });

  it("has a fixture heterogeneous enough for a lane swap to be visible", () => {
    // THE PRECONDITION FOR EVERY OTHER TEST HERE. Against an ensemble of
    // identical replicates, swapping the two lanes' output rows produces a
    // bit-identical result and the equality assertions below would pass a
    // kernel with its lanes crossed.
    let distinctAdjacentPairs = 0;
    for (let r = 0; r + 1 < REPLICATES; r += 1) {
      const a = scalarRows.subarray(r * 6, r * 6 + 6);
      const b = scalarRows.subarray((r + 1) * 6, (r + 1) * 6 + 6);
      if (firstDifference(Float64Array.from(a), Float64Array.from(b)) !== -1) {
        distinctAdjacentPairs += 1;
      }
    }
    expect(distinctAdjacentPairs).toBe(REPLICATES - 1);
  });

  it("has a fixture in which the running max is not just the final height", () => {
    // P7.08's control B, restated: if every replicate is still rising at the
    // end of the window, slot 5 equals slot 1 and the max-tracking comparison
    // is vacuous -- it would pass a lane-wise `max` that never tracked anything.
    let peakedInsideWindow = 0;
    for (let r = 0; r < REPLICATES; r += 1) {
      const row = r * 6;
      if (scalarRows[row + OBS.maxSampledHeight] > scalarRows[row + OBS.y]) {
        peakedInsideWindow += 1;
      }
    }
    expect(peakedInsideWindow).toBeGreaterThan(REPLICATES / 10);
  });

  it("is bit-identical to the scalar path on every slot of every replicate", () => {
    // 0 ULP, not "within tolerance". See this file's header for why that is the
    // right claim rather than an ambitious one.
    expect(simdRows.length).toBe(REPLICATES * 6);
    expect(firstDifference(scalarRows, simdRows)).toBe(-1);
  });

  it("compares to the end of the ensemble, including the odd tail replicate", () => {
    // The instrument, checked. A comparison loop that stopped early -- or a
    // `firstDifference` that returned -1 on a length mismatch -- would report a
    // clean run over a kernel that wrote half the rows. Perturbing the LAST
    // slot of the LAST replicate is what proves the loop reaches it, and that
    // last replicate is the scalar tail (REPLICATES is odd).
    const perturbed = Float64Array.from(simdRows);
    const last = REPLICATES * 6 - 1;
    perturbed[last] = nextUp(perturbed[last]);
    expect(perturbed[last]).not.toBe(simdRows[last]);
    expect(firstDifference(scalarRows, perturbed)).toBe(last);
  });

  it("closes the chain to the TypeScript stepper directly, not by inheritance", () => {
    // P7.07 proved scalar-WASM == TS and P7.08 proved batch == single-state, so
    // "SIMD == TS" follows by chaining. It is asserted directly anyway: a later
    // change to either link would silently weaken the inherited claim, and this
    // is the only place in the suite where the SIMD rows meet the TypeScript
    // reference rather than another WASM path.
    //
    // Five replicates spanning both lanes of a pair (even and odd r) and the
    // odd tail at REPLICATES - 1, each with its own mass and Cd.
    for (const r of [0, 1, 2, REPLICATES - 2, REPLICATES - 1]) {
      const p = replicateParams(r, 0, 0, 0);
      const side = makeTsSide(p[0], p[2]);
      let y = Float64Array.from(replicateState(r));
      let maxY = y[1];
      for (let i = 0; i < STEPS; i += 1) {
        y = side.step(i * H, y, H);
        if (y[1] > maxY) {
          maxY = y[1];
        }
      }
      const row = r * 6;
      expect(Object.is(simdRows[row + OBS.x], y[0])).toBe(true);
      expect(Object.is(simdRows[row + OBS.y], y[1])).toBe(true);
      expect(Object.is(simdRows[row + OBS.vx], y[2])).toBe(true);
      expect(Object.is(simdRows[row + OBS.vy], y[3])).toBe(true);
      expect(Object.is(simdRows[row + OBS.maxSampledHeight], maxY)).toBe(true);
      expect(simdRows[row + OBS.tFinal]).toBe(STEPS * H);
    }
  });

  it("allocates nothing per call", () => {
    // Same instrument P7.08 used, for the same reason: a module with no
    // allocator can only obtain memory through `memory.grow`, so linear memory
    // size is the reading. The SIMD path's scratch is on the shadow stack,
    // which never grows into new pages.
    const before = kernel.memoryBytes;
    const viewBefore = kernel.batchObservables;
    for (let i = 0; i < 20; i += 1) {
      kernel.batchRunSimd(0, H, STEPS, REPLICATES);
    }
    expect(kernel.memoryBytes).toBe(before);
    // Identity as well as size: a view rebuilt at the same byte count would
    // mean something moved even where the number did not change.
    expect(kernel.batchObservables).toBe(viewBefore);
  });

  it("refuses an n beyond the reserved capacity without writing anything", () => {
    const before = Float64Array.from(kernel.batchObservables);
    expect(() => kernel.batchRunSimd(0, H, STEPS, REPLICATES + 1)).toThrow(RangeError);
    expect(firstDifference(before, kernel.batchObservables)).toBe(-1);
  });
});

/** Arena size for the pair/tail shapes. Rows past `n` must stay at {@link SENTINEL}. */
const CAPACITY = 8;
/** A value the kernel can never write, so "untouched" is distinguishable from "written 0". */
const SENTINEL = -1;

describe.skipIf(!wasmSimdSupported())("the pair/tail split", () => {
  let ts: ReturnType<typeof makeTsSide>;
  let kernel: WasmRk4Kernel;

  beforeAll(async () => {
    ts = makeTsSide();
    kernel = await WasmRk4Kernel.instantiate(await readWasmSimdArtifact());
    kernel.batchInit(CAPACITY);
    fillArena(kernel, CAPACITY, ts.area, ts.rho, ts.g);
  });

  // n = 0 writes nothing; 1 is the tail alone with no pair; 2 is one pair with
  // no tail; 3, 5 and 7 are pairs plus a tail; 8 is pairs alone. Every shape
  // the `n / 2` + `n % 2` split can take, because off-by-one in a pairing loop
  // is the defect this whole structure invites.
  it.each([0, 1, 2, 3, 4, 5, 7, 8])("matches the scalar path for n = %i", (n) => {
    kernel.batchObservables.fill(0);
    kernel.batchRun(0, H, STEPS, n);
    const scalar = Float64Array.from(kernel.batchObservables.subarray(0, n * 6));

    kernel.batchObservables.fill(SENTINEL);
    kernel.batchRunSimd(0, H, STEPS, n);
    const simd = Float64Array.from(kernel.batchObservables.subarray(0, n * 6));

    expect(firstDifference(scalar, simd)).toBe(-1);

    // And nothing beyond row n was touched. This half is not decoration: a
    // control build whose pair loop ran `n.div_ceil(2)` times instead of
    // `n / 2` passed the equality check above for every one of these shapes,
    // because the row it corrupted was the one past the end that nothing
    // compared. Only the untouched-region assertion sees it.
    for (let i = n * 6; i < CAPACITY * 6; i += 1) {
      expect(kernel.batchObservables[i]).toBe(SENTINEL);
    }
  });
});
