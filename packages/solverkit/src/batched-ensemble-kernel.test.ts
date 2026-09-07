import type { EvalContext, Model } from "@ballista/engine";
import { describe, expect, it } from "vitest";
import { createBatchedEnsembleBuffers, stepEnsembleBatched } from "./batched-ensemble-kernel.js";
import {
  createEnsembleBlock,
  createEnsembleLayout,
  createEnsembleStepBuffers,
  paramIndex,
  stateIndex,
  stepEnsembleReference,
  type EnsembleBlock,
  type EnsembleLayout,
  type EnsembleStepOptions,
} from "./ensemble-state.js";
import {
  EULER_TABLEAU,
  HEUN_TABLEAU,
  MIDPOINT_TABLEAU,
  RK4_TABLEAU,
  type ButcherTableau,
} from "./explicit-rk-kernel.js";

/**
 * The same damped-spring fixture `ensemble-state.test.ts` uses, and
 * deliberately the same: this file's whole subject is that the batched kernel
 * and the reference agree, so a fixture they do not share would weaken the
 * comparison rather than broaden it.
 *
 * Dissipative rather than conservative on purpose. The repository's standing
 * constraint is that symplectic integration is for conservative dynamics only;
 * a damped spring is the regime an explicit RK method is the right tool for.
 */
interface Coeffs {
  k: number;
  c: number;
}

function makeSpringModel(coeffs: Coeffs): Model {
  return {
    dim: 2,
    channels: [
      { name: "y", unit: "m" },
      { name: "v", unit: "m/s" },
    ],
    rhs(_t: number, y: Float64Array, out: Float64Array): void {
      out[0] = y[1]!;
      out[1] = -coeffs.k * y[0]! - coeffs.c * y[1]!;
    },
  } as unknown as Model;
}

/**
 * A model whose rhs reads `t`, so a kernel that formed the stage time
 * differently -- or evaluated a stage at the wrong `c_i` -- would disagree.
 * The spring model above ignores `t` entirely and cannot catch that.
 */
function makeTimeDependentModel(): Model {
  return {
    dim: 2,
    channels: [
      { name: "a", unit: "m" },
      { name: "b", unit: "m" },
    ],
    rhs(t: number, y: Float64Array, out: Float64Array): void {
      out[0] = Math.sin(t) * y[1]! - 0.3 * y[0]!;
      out[1] = Math.cos(t * 1.7) - 0.2 * y[1]! * y[1]!;
    },
  } as unknown as Model;
}

const CTX = {} as unknown as EvalContext;

/** Ralston's RK2 and Heun's third-order method. Neither is a stepper this repository
 * ships; both are here because their `a` entries (2/3, 1/3) are not dyadic. See
 * `THE STAGE-TERM ASSOCIATION` below for why that matters. */
const RALSTON_RK2: ButcherTableau = { c: [0, 2 / 3], a: [[], [2 / 3]], b: [0.25, 0.75] };
const HEUN_RK3: ButcherTableau = {
  c: [0, 1 / 3, 2 / 3],
  a: [[], [1 / 3], [0, 2 / 3]],
  b: [0.25, 0, 0.75],
};

/** Deterministic, spread-out draws -- no RNG, so any failure reproduces exactly. */
function seedBlock(block: EnsembleBlock): void {
  const { layout } = block;
  for (let r = 0; r < layout.replicates; r++) {
    for (let p = 0; p < layout.paramDim; p++) {
      block.data[paramIndex(layout, p, r)] = 1 + 0.37 * r + 0.11 * p;
    }
    for (let c = 0; c < layout.stateDim; c++) {
      block.data[stateIndex(layout, c, r)] = 0.5 - 0.23 * r + 1.7 * c;
    }
  }
}

function makePair(layout: EnsembleLayout): [EnsembleBlock, EnsembleBlock] {
  const a = createEnsembleBlock(layout);
  const b = createEnsembleBlock(layout);
  seedBlock(a);
  seedBlock(b);
  return [a, b];
}

/**
 * Runs `steps` steps of both kernels on identical blocks and returns them.
 *
 * Uses `toEqual` on the raw `Float64Array`s at the call sites rather than a
 * per-element tolerance: the criterion is bit-identity, so the comparison has
 * to be exact. `toBeCloseTo` here would pass for a kernel that reassociated
 * the arithmetic, which is precisely the defect this file exists to catch.
 */
function runBoth(
  model: Model,
  layout: EnsembleLayout,
  steps: number,
  h: number,
  options: EnsembleStepOptions = {},
  optionsBatched: EnsembleStepOptions = options,
): [Float64Array, Float64Array] {
  const stages = (options.tableau ?? RK4_TABLEAU).c.length;
  const [a, b] = makePair(layout);
  const refBuffers = createEnsembleStepBuffers(layout, stages);
  const batBuffers = createBatchedEnsembleBuffers(layout, stages);
  for (let n = 0; n < steps; n++) {
    stepEnsembleReference(model, CTX, a, refBuffers, n * h, h, options);
    stepEnsembleBatched(model, CTX, b, batBuffers, n * h, h, optionsBatched);
  }
  return [a.data, b.data];
}

describe("batched ensemble kernel: bit-identity to the reference (P7.03)", () => {
  it("agrees to the bit after a single RK4 step", () => {
    const model = makeSpringModel({ k: 4, c: 0.3 });
    const [ref, bat] = runBoth(model, createEnsembleLayout(7, 0, 2), 1, 0.01);
    expect(bat).toEqual(ref);
  });

  it("agrees to the bit after 50 steps, so no error can accumulate unnoticed", () => {
    const model = makeSpringModel({ k: 9, c: 0.45 });
    const [ref, bat] = runBoth(model, createEnsembleLayout(13, 0, 2), 50, 0.005);
    expect(bat).toEqual(ref);
  });

  it("agrees to the bit on a model that reads t, which pins the stage times", () => {
    const [ref, bat] = runBoth(makeTimeDependentModel(), createEnsembleLayout(9, 0, 2), 30, 0.02);
    expect(bat).toEqual(ref);
  });

  it.each<[string, ButcherTableau]>([
    ["Euler (1 stage, empty a-rows)", EULER_TABLEAU],
    ["midpoint (2 stages, a zero b-weight)", MIDPOINT_TABLEAU],
    ["Heun (2 stages, equal b-weights)", HEUN_TABLEAU],
    ["RK4 (4 stages, interior zeros in a)", RK4_TABLEAU],
    ["Ralston RK2 (non-dyadic a)", RALSTON_RK2],
    ["Heun RK3 (non-dyadic a across two stages)", HEUN_RK3],
  ])("agrees to the bit for %s", (_name, tableau) => {
    const model = makeSpringModel({ k: 6, c: 0.25 });
    const [ref, bat] = runBoth(model, createEnsembleLayout(11, 0, 2), 20, 0.01, { tableau });
    expect(bat).toEqual(ref);
  });

  it("agrees to the bit for a single replicate, where the SoA rows degenerate", () => {
    const model = makeSpringModel({ k: 3, c: 0.1 });
    const [ref, bat] = runBoth(model, createEnsembleLayout(1, 0, 2), 10, 0.01);
    expect(bat).toEqual(ref);
  });

  it("agrees to the bit at a batch size large enough to leave cache", () => {
    const model = makeSpringModel({ k: 5, c: 0.2 });
    const [ref, bat] = runBoth(model, createEnsembleLayout(1024, 0, 2), 4, 0.002);
    expect(bat).toEqual(ref);
  });

  it("leaves the parameter block untouched", () => {
    const layout = createEnsembleLayout(6, 3, 2);
    const model = makeSpringModel({ k: 4, c: 0.3 });
    const block = createEnsembleBlock(layout);
    seedBlock(block);
    const paramsBefore = block.data.slice(0, layout.stateOffset);
    stepEnsembleBatched(model, CTX, block, createBatchedEnsembleBuffers(layout, 4), 0, 0.01);
    expect(block.data.slice(0, layout.stateOffset)).toEqual(paramsBefore);
  });
});

/**
 * THE STAGE-TERM ASSOCIATION.
 *
 * `explicit-rk-kernel.ts` documents that a stage term must be formed as
 * `h * a_ij * k_j[i]` left-to-right and not as `h * (a_ij * k_j[i])`, because
 * the two round differently. Every other test in this file was green under a
 * kernel regrouped the wrong way -- established by mutation, not assumed --
 * so on its own that suite does not pin the rule the kernel claims to follow.
 *
 * Three conditions all have to hold before the regrouping is observable at
 * all, which is why it takes a purpose-built fixture rather than a bigger one:
 *
 *  1. `a_ij` must not be dyadic. Every tableau shipped here draws its `a`
 *     entries from {0, 1/2, 1}, and scaling by a power of two is exact, so the
 *     two groupings agree bit-for-bit. Hence Ralston's 2/3.
 *  2. `h` must not be dyadic either, for the same reason -- at h = 1, 0.5,
 *     0.25 or 2 the regrouping is invisible even with a non-dyadic `a`.
 *     Measured: 0 of 32 replicates differ at each of those. Hence h = 0.3.
 *  3. The stage term must not be dwarfed by the state it is added to. At
 *     h = 0.01 the term is ~1% of `y[i]`, so a last-bit difference in the term
 *     is absorbed by the addition: 0 of 32 replicates differ after 5 steps.
 *
 * With all three satisfied (h = 0.3, a = 2/3, gains that make the derivative
 * comparable to the state), 31 of 32 replicates diverge after 20 steps. The
 * dynamics are damped, matching this file's other fixtures and the standing
 * constraint that symplectic methods are for conservative systems only.
 */
describe("batched ensemble kernel: the documented operation order (P7.03)", () => {
  /** `dy/dt = 7.3 v`, `dv/dt = -5.1 y - 0.4 v`. Gains chosen so the stage term
   * is the same order as the state; damping so an explicit RK method is the
   * right tool. */
  function makeStiffishModel(): Model {
    return {
      dim: 2,
      channels: [
        { name: "y", unit: "m" },
        { name: "v", unit: "m/s" },
      ],
      rhs(_t: number, y: Float64Array, out: Float64Array): void {
        out[0] = 7.3 * y[1]!;
        out[1] = -5.1 * y[0]! - 0.4 * y[1]!;
      },
    } as unknown as Model;
  }

  it("matches the reference on the fixture where regrouping the stage term is visible", () => {
    const [ref, bat] = runBoth(makeStiffishModel(), createEnsembleLayout(32, 0, 2), 20, 0.3, {
      tableau: RALSTON_RK2,
    });
    expect(bat).toEqual(ref);
  });

  it("the fixture is genuinely discriminating: the regrouped stage term gives a different answer", () => {
    // Not a test of the kernel -- a test of the test above. It recomputes the
    // same 20 steps both ways in the open, so the claim that the fixture can
    // see the difference is checked here rather than asserted in a comment.
    const a = 2 / 3;
    const b = [0.25, 0.75];
    const h = 0.3;
    const rhs = (p: number, q: number): [number, number] => [7.3 * q, -5.1 * p - 0.4 * q];
    let differing = 0;
    for (let r = 0; r < 32; r++) {
      let p = 0.5 - 0.23 * r;
      let q = 0.5 - 0.23 * r + 1.7;
      let pR = p;
      let qR = q;
      for (let n = 0; n < 20; n++) {
        const [k00, k01] = rhs(p, q);
        const [j00, j01] = rhs(pR, qR);
        // left-to-right, as the kernel does
        const [k10, k11] = rhs(p + h * a * k00, q + h * a * k01);
        // regrouped, as the mutation does
        const [j10, j11] = rhs(pR + h * (a * j00), qR + h * (a * j01));
        p = p + h * (b[0]! * k00 + b[1]! * k10);
        q = q + h * (b[0]! * k01 + b[1]! * k11);
        pR = pR + h * (b[0]! * j00 + b[1]! * j10);
        qR = qR + h * (b[0]! * j01 + b[1]! * j11);
      }
      if (p !== pR || q !== qR) differing++;
    }
    expect(differing).toBeGreaterThan(16);
  });
});

describe("batched ensemble kernel: per-replicate parameters (P7.03)", () => {
  /**
   * Installs replicate `r`'s two parameters as the spring's stiffness and
   * damping, so a kernel that used the wrong replicate's row -- or none --
   * produces different numbers rather than the same ones.
   */
  function paramsFixture(): { model: Model; options: EnsembleStepOptions; calls: number[] } {
    const coeffs: Coeffs = { k: 0, c: 0 };
    const calls: number[] = [];
    return {
      model: makeSpringModel(coeffs),
      calls,
      options: {
        applyParams(replicate: number, params: Float64Array): void {
          calls.push(replicate);
          coeffs.k = params[0]!;
          coeffs.c = params[1]!;
        },
      },
    };
  }

  it("agrees to the bit when each replicate integrates with its own parameters", () => {
    const layout = createEnsembleLayout(8, 2, 2);
    const ref = paramsFixture();
    const bat = paramsFixture();
    const [a, b] = makePair(layout);
    const refBuffers = createEnsembleStepBuffers(layout, 4);
    const batBuffers = createBatchedEnsembleBuffers(layout, 4);
    for (let n = 0; n < 12; n++) {
      stepEnsembleReference(ref.model, CTX, a, refBuffers, n * 0.01, 0.01, ref.options);
      stepEnsembleBatched(bat.model, CTX, b, batBuffers, n * 0.01, 0.01, bat.options);
    }
    expect(b.data).toEqual(a.data);
  });

  it("really is parameter-sensitive: perturbing one replicate's row changes only that replicate", () => {
    const layout = createEnsembleLayout(4, 2, 2);
    const { model, options } = paramsFixture();
    const [a, b] = makePair(layout);
    b.data[paramIndex(layout, 0, 2)] = b.data[paramIndex(layout, 0, 2)]! + 1;
    const bufA = createBatchedEnsembleBuffers(layout, 4);
    const bufB = createBatchedEnsembleBuffers(layout, 4);
    stepEnsembleBatched(model, CTX, a, bufA, 0, 0.01, options);
    stepEnsembleBatched(model, CTX, b, bufB, 0, 0.01, options);

    for (let r = 0; r < layout.replicates; r++) {
      const changed = a.data[stateIndex(layout, 0, r)] !== b.data[stateIndex(layout, 0, r)];
      expect(changed).toBe(r === 2);
    }
  });

  it("calls applyParams once per replicate per stage, which the reference does not", () => {
    // The documented cost of inverting the loop nest. Asserted rather than
    // described so that a later change to the nest cannot quietly alter it.
    const layout = createEnsembleLayout(5, 2, 2);
    const ref = paramsFixture();
    const bat = paramsFixture();
    const [a, b] = makePair(layout);
    stepEnsembleReference(
      ref.model,
      CTX,
      a,
      createEnsembleStepBuffers(layout, 4),
      0,
      0.01,
      ref.options,
    );
    stepEnsembleBatched(
      bat.model,
      CTX,
      b,
      createBatchedEnsembleBuffers(layout, 4),
      0,
      0.01,
      bat.options,
    );

    expect(ref.calls).toEqual([0, 1, 2, 3, 4]);
    expect(bat.calls).toHaveLength(20);
    expect(bat.calls.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(bat.calls.slice(5, 10)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("batched ensemble kernel: buffer and shape validation (P7.03)", () => {
  const layout = createEnsembleLayout(4, 1, 2);
  const model = makeSpringModel({ k: 4, c: 0.3 });

  it("rejects a model whose dim disagrees with the block", () => {
    const wrongDim = { ...makeSpringModel({ k: 1, c: 0 }), dim: 3 } as unknown as Model;
    expect(() =>
      stepEnsembleBatched(
        wrongDim,
        CTX,
        createEnsembleBlock(layout),
        createBatchedEnsembleBuffers(layout, 4),
        0,
        0.01,
      ),
    ).toThrow(/model.dim 3/);
  });

  it("rejects buffers built for a different stage count", () => {
    expect(() =>
      stepEnsembleBatched(
        model,
        CTX,
        createEnsembleBlock(layout),
        createBatchedEnsembleBuffers(layout, 2),
        0,
        0.01,
      ),
    ).toThrow(/2 stages, tableau has 4/);
  });

  it("rejects buffers built for a different stateDim", () => {
    const other = createEnsembleLayout(4, 1, 3);
    expect(() =>
      stepEnsembleBatched(
        model,
        CTX,
        createEnsembleBlock(layout),
        createBatchedEnsembleBuffers(other, 4),
        0,
        0.01,
      ),
    ).toThrow(/stateDim 3/);
  });

  it("rejects buffers built for a different replicate count", () => {
    const other = createEnsembleLayout(9, 1, 2);
    expect(() =>
      stepEnsembleBatched(
        model,
        CTX,
        createEnsembleBlock(layout),
        createBatchedEnsembleBuffers(other, 4),
        0,
        0.01,
      ),
    ).toThrow(/stage buffer 0 has length 18, block needs 8/);
  });

  it("rejects buffers built for a different paramDim", () => {
    const other = createEnsembleLayout(4, 3, 2);
    const buffers = createBatchedEnsembleBuffers(other, 4);
    expect(() =>
      stepEnsembleBatched(
        model,
        CTX,
        createEnsembleBlock(layout),
        { ...buffers, k: createBatchedEnsembleBuffers(layout, 4).k },
        0,
        0.01,
      ),
    ).toThrow(/paramDim 3/);
  });

  it("rejects a non-positive stage count at allocation", () => {
    expect(() => createBatchedEnsembleBuffers(layout, 0)).toThrow(RangeError);
    expect(() => createBatchedEnsembleBuffers(layout, 1.5)).toThrow(RangeError);
  });
});
