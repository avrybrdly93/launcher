import type { EvalContext, Model } from "@ballista/engine";
import { describe, expect, it } from "vitest";
import {
  createEnsembleBlock,
  createEnsembleLayout,
  createEnsembleStepBuffers,
  gatherParams,
  gatherState,
  paramBlock,
  paramIndex,
  scatterParams,
  scatterState,
  stateBlock,
  stateIndex,
  stepEnsembleReference,
  type EnsembleBlock,
} from "./ensemble-state.js";
import { createExplicitRKBuffers, stepExplicitRK, RK4_TABLEAU } from "./explicit-rk-kernel.js";
import { createStepResult } from "./types.js";

/**
 * A model whose rhs depends on a per-replicate parameter, so a batch step
 * that installed the wrong replicate's parameters would produce a different
 * answer rather than the same one. `dim` 2: `[y, v]` under
 * `dy/dt = v`, `dv/dt = -k*y - c*v`, with `k` and `c` read off a mutable cell
 * the test's `applyParams` writes.
 *
 * Damped rather than purely oscillatory on purpose. A conservative spring
 * would be exactly the case where a symplectic method belongs, and the
 * repository's standing constraint is that symplectic integration applies to
 * conservative dynamics only -- so the fixture for an RK4 batch is chosen
 * dissipative, which is the regime RK4 is the right tool for.
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

/** The rhs above never touches the context, so an empty stand-in is enough. */
const CTX = {} as unknown as EvalContext;

/** Deterministic, spread-out parameter and state draws -- no RNG, so a failure reproduces exactly. */
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

describe("ensemble layout geometry (P7.02)", () => {
  it("places the parameter block first and the state block after it", () => {
    const layout = createEnsembleLayout(4, 3, 2);
    expect(layout.paramOffset).toBe(0);
    expect(layout.stateOffset).toBe(12);
    expect(layout.length).toBe(20);
  });

  it("stores each row contiguously across replicates, which is the point of the transpose", () => {
    const layout = createEnsembleLayout(5, 1, 3);
    // Consecutive replicates of one channel are adjacent...
    expect(stateIndex(layout, 1, 3) - stateIndex(layout, 1, 2)).toBe(1);
    // ...while consecutive channels of one replicate are a whole row apart.
    expect(stateIndex(layout, 2, 0) - stateIndex(layout, 1, 0)).toBe(5);
  });

  it("gives every (row, replicate) pair a distinct slot across both blocks", () => {
    const layout = createEnsembleLayout(6, 2, 3);
    const seen = new Set<number>();
    for (let r = 0; r < layout.replicates; r++) {
      for (let p = 0; p < layout.paramDim; p++) seen.add(paramIndex(layout, p, r));
      for (let c = 0; c < layout.stateDim; c++) seen.add(stateIndex(layout, c, r));
    }
    expect(seen.size).toBe(layout.length);
    expect(Math.min(...seen)).toBe(0);
    expect(Math.max(...seen)).toBe(layout.length - 1);
  });

  it("supports a batch that varies only initial conditions", () => {
    const layout = createEnsembleLayout(3, 0, 4);
    expect(layout.stateOffset).toBe(0);
    expect(layout.length).toBe(12);
    expect(paramBlock(createEnsembleBlock(layout))).toHaveLength(0);
  });

  it("rejects a zero-replicate or zero-channel batch rather than allocating an empty one", () => {
    expect(() => createEnsembleLayout(0, 1, 2)).toThrow(/replicates/);
    expect(() => createEnsembleLayout(4, 1, 0)).toThrow(/stateDim/);
  });

  it("rejects non-integer and negative shapes", () => {
    expect(() => createEnsembleLayout(2.5, 0, 2)).toThrow(RangeError);
    expect(() => createEnsembleLayout(4, -1, 2)).toThrow(RangeError);
  });

  it("hands out views onto the one buffer, not copies", () => {
    const block = createEnsembleBlock(createEnsembleLayout(3, 1, 2));
    stateBlock(block)[0] = 7;
    paramBlock(block)[0] = 9;
    expect(block.data[block.layout.stateOffset]).toBe(7);
    expect(block.data[0]).toBe(9);
  });
});

describe("ensemble gather/scatter (P7.02)", () => {
  it("round-trips a replicate's state exactly", () => {
    const block = createEnsembleBlock(createEnsembleLayout(4, 2, 3));
    seedBlock(block);
    const before = Float64Array.from(block.data);

    const scratch = new Float64Array(3);
    for (let r = 0; r < 4; r++) {
      gatherState(block, r, scratch);
      scatterState(block, r, scratch);
    }
    expect(block.data).toEqual(before);
  });

  it("round-trips parameters exactly", () => {
    const block = createEnsembleBlock(createEnsembleLayout(4, 2, 3));
    seedBlock(block);
    const before = Float64Array.from(block.data);

    const scratch = new Float64Array(2);
    for (let r = 0; r < 4; r++) {
      gatherParams(block, r, scratch);
      scatterParams(block, r, scratch);
    }
    expect(block.data).toEqual(before);
  });

  it("touches only the replicate it is asked for", () => {
    const block = createEnsembleBlock(createEnsembleLayout(4, 1, 2));
    seedBlock(block);
    const before = Float64Array.from(block.data);

    scatterState(block, 2, Float64Array.from([-1, -2]));

    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 2; c++) {
        const i = stateIndex(block.layout, c, r);
        if (r === 2) continue;
        expect(block.data[i]).toBe(before[i]);
      }
      const p = paramIndex(block.layout, 0, r);
      expect(block.data[p]).toBe(before[p]);
    }
    expect(block.data[stateIndex(block.layout, 0, 2)]).toBe(-1);
    expect(block.data[stateIndex(block.layout, 1, 2)]).toBe(-2);
  });

  it("rejects an out-of-range replicate and a wrongly-sized buffer", () => {
    const block = createEnsembleBlock(createEnsembleLayout(3, 1, 2));
    expect(() => gatherState(block, 3, new Float64Array(2))).toThrow(/replicate 3/);
    expect(() => gatherState(block, -1, new Float64Array(2))).toThrow(RangeError);
    expect(() => gatherState(block, 0, new Float64Array(3))).toThrow(/length 2/);
    expect(() => scatterParams(block, 0, new Float64Array(2))).toThrow(/length 1/);
  });
});

describe("batch RK4 over the SoA layout (P7.02 validation criterion)", () => {
  /**
   * The criterion in full: "batch RK4 produces bit-identical results to
   * per-replicate loop". Bit-identical, not close -- so these compare the
   * raw 64-bit patterns rather than the numbers, because `toEqual` on two
   * `Float64Array`s would accept `-0` where `+0` was expected and would
   * accept nothing at all where a `NaN` legitimately appears in both.
   */
  function bits(a: Float64Array): BigUint64Array {
    return new BigUint64Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));
  }

  /** The per-replicate loop the criterion names: independent buffers, one solve each. */
  function perReplicateLoop(
    coeffs: Coeffs,
    params: readonly (readonly [number, number])[],
    initial: readonly (readonly [number, number])[],
    t: number,
    h: number,
    steps: number,
  ): Float64Array[] {
    const out: Float64Array[] = [];
    for (let r = 0; r < params.length; r++) {
      const model = makeSpringModel(coeffs);
      const rk = createExplicitRKBuffers(2, RK4_TABLEAU.c.length);
      const result = createStepResult(2);
      const y = Float64Array.from(initial[r]!);
      for (let s = 0; s < steps; s++) {
        coeffs.k = params[r]![0];
        coeffs.c = params[r]![1];
        stepExplicitRK(model, CTX, RK4_TABLEAU, rk, t + s * h, y, h, result);
        y.set(result.yNext);
      }
      out.push(y);
    }
    return out;
  }

  const PARAMS: readonly (readonly [number, number])[] = [
    [4.0, 0.3],
    [9.5, 0.05],
    [1.25, 1.1],
    [17.0, 0.7],
    [0.5, 0.0],
  ];
  const INITIAL: readonly (readonly [number, number])[] = [
    [1.0, 0.0],
    [0.25, -3.0],
    [-2.0, 0.5],
    [0.0, 7.25],
    [1e-8, 1e8],
  ];

  it("matches the per-replicate loop bit for bit over many steps", () => {
    const t0 = 0.125;
    const h = 0.017;
    const steps = 40;

    const reference = perReplicateLoop({ k: 0, c: 0 }, PARAMS, INITIAL, t0, h, steps);

    const coeffs: Coeffs = { k: 0, c: 0 };
    const model = makeSpringModel(coeffs);
    const layout = createEnsembleLayout(PARAMS.length, 2, 2);
    const block = createEnsembleBlock(layout);
    for (let r = 0; r < PARAMS.length; r++) {
      scatterParams(block, r, Float64Array.from(PARAMS[r]!));
      scatterState(block, r, Float64Array.from(INITIAL[r]!));
    }
    const buffers = createEnsembleStepBuffers(layout, RK4_TABLEAU.c.length);
    for (let s = 0; s < steps; s++) {
      stepEnsembleReference(model, CTX, block, buffers, t0 + s * h, h, {
        applyParams(_r, p) {
          coeffs.k = p[0]!;
          coeffs.c = p[1]!;
        },
      });
    }

    const batched = new Float64Array(2);
    for (let r = 0; r < PARAMS.length; r++) {
      gatherState(block, r, batched);
      expect(bits(batched)).toEqual(bits(reference[r]!));
    }
  });

  it("still matches bit for bit on a single-replicate batch", () => {
    const reference = perReplicateLoop({ k: 0, c: 0 }, [PARAMS[1]!], [INITIAL[1]!], 0, 0.03, 12);

    const coeffs: Coeffs = { k: 0, c: 0 };
    const model = makeSpringModel(coeffs);
    const layout = createEnsembleLayout(1, 2, 2);
    const block = createEnsembleBlock(layout);
    scatterParams(block, 0, Float64Array.from(PARAMS[1]!));
    scatterState(block, 0, Float64Array.from(INITIAL[1]!));
    const buffers = createEnsembleStepBuffers(layout, RK4_TABLEAU.c.length);
    for (let s = 0; s < 12; s++) {
      stepEnsembleReference(model, CTX, block, buffers, s * 0.03, 0.03, {
        applyParams(_r, p) {
          coeffs.k = p[0]!;
          coeffs.c = p[1]!;
        },
      });
    }

    const batched = new Float64Array(2);
    gatherState(block, 0, batched);
    expect(bits(batched)).toEqual(bits(reference[0]!));
  });

  it("keeps replicates independent: reordering the batch permutes the answers and nothing else", () => {
    // If a kernel ever leaked one replicate's stage buffer into the next, the
    // answer for replicate r would depend on who its neighbours were. It must
    // not, and a permutation is the cheapest way to say so.
    const order = [3, 0, 4, 1, 2];
    const coeffs: Coeffs = { k: 0, c: 0 };
    const model = makeSpringModel(coeffs);

    const run = (indices: readonly number[]): Float64Array[] => {
      const layout = createEnsembleLayout(indices.length, 2, 2);
      const block = createEnsembleBlock(layout);
      indices.forEach((src, r) => {
        scatterParams(block, r, Float64Array.from(PARAMS[src]!));
        scatterState(block, r, Float64Array.from(INITIAL[src]!));
      });
      const buffers = createEnsembleStepBuffers(layout, RK4_TABLEAU.c.length);
      for (let s = 0; s < 20; s++) {
        stepEnsembleReference(model, CTX, block, buffers, s * 0.02, 0.02, {
          applyParams(_r, p) {
            coeffs.k = p[0]!;
            coeffs.c = p[1]!;
          },
        });
      }
      return indices.map((_, r) => {
        const y = new Float64Array(2);
        gatherState(block, r, y);
        return y;
      });
    };

    const natural = run([0, 1, 2, 3, 4]);
    const permuted = run(order);
    order.forEach((src, r) => {
      expect(bits(permuted[r]!)).toEqual(bits(natural[src]!));
    });
  });

  it("leaves the parameter block untouched while stepping", () => {
    const coeffs: Coeffs = { k: 0, c: 0 };
    const model = makeSpringModel(coeffs);
    const layout = createEnsembleLayout(PARAMS.length, 2, 2);
    const block = createEnsembleBlock(layout);
    for (let r = 0; r < PARAMS.length; r++) {
      scatterParams(block, r, Float64Array.from(PARAMS[r]!));
      scatterState(block, r, Float64Array.from(INITIAL[r]!));
    }
    const before = Float64Array.from(paramBlock(block));
    const buffers = createEnsembleStepBuffers(layout, RK4_TABLEAU.c.length);
    for (let s = 0; s < 5; s++) {
      stepEnsembleReference(model, CTX, block, buffers, s * 0.05, 0.05, {
        applyParams(_r, p) {
          coeffs.k = p[0]!;
          coeffs.c = p[1]!;
        },
      });
    }
    expect(paramBlock(block)).toEqual(before);
  });

  it("rejects buffers built for a different shape rather than reading past them", () => {
    const model = makeSpringModel({ k: 1, c: 0 });
    const layout = createEnsembleLayout(2, 1, 2);
    const block = createEnsembleBlock(layout);

    expect(() =>
      stepEnsembleReference(
        model,
        CTX,
        block,
        createEnsembleStepBuffers(createEnsembleLayout(2, 1, 3), 4),
        0,
        0.1,
      ),
    ).toThrow(/stateDim/);

    expect(() =>
      stepEnsembleReference(model, CTX, block, createEnsembleStepBuffers(layout, 2), 0, 0.1),
    ).toThrow(/stages/);

    expect(() =>
      stepEnsembleReference(
        model,
        CTX,
        block,
        createEnsembleStepBuffers(createEnsembleLayout(2, 2, 2), 4),
        0,
        0.1,
      ),
    ).toThrow(/paramDim/);
  });

  it("rejects a model whose dim does not match the batch", () => {
    const layout = createEnsembleLayout(2, 0, 3);
    const block = createEnsembleBlock(layout);
    expect(() =>
      stepEnsembleReference(
        makeSpringModel({ k: 1, c: 0 }),
        CTX,
        block,
        createEnsembleStepBuffers(layout, 4),
        0,
        0.1,
      ),
    ).toThrow(/model.dim 2/);
  });
});
