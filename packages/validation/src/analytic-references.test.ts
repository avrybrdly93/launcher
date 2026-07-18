import { describe, expect, it } from "vitest";
import {
  createDragFreeParabolaReference,
  createLinearDragReference,
  createTerminalVelocityDropReference,
  type AnalyticReference,
} from "./analytic-references.js";

const SAMPLE_TIMES = [0, 0.01, 0.05, 0.1, 0.2, 0.5];

const REFERENCES: readonly [string, () => AnalyticReference][] = [
  ["drag-free-parabola", createDragFreeParabolaReference],
  ["linear-drag", createLinearDragReference],
  ["terminal-velocity-drop", createTerminalVelocityDropReference],
];

describe("golden analytic references (P2.08)", () => {
  it.each(REFERENCES)("%s: state(0) equals y0", (_name, create) => {
    const ref = create();
    expect(Array.from(ref.state(0))).toEqual(Array.from(ref.y0));
  });

  it.each(REFERENCES)(
    "%s: the closed-form derivative satisfies the model's actual rhs at several sampled t to 1e-12",
    (_name, create) => {
      const ref = create();
      const out = new Float64Array(ref.model.dim);

      for (const t of SAMPLE_TIMES) {
        const state = ref.state(t);
        const expectedDerivative = ref.derivative(t);
        ref.model.rhs(t, state, out, ref.ctx);

        for (let i = 0; i < ref.model.dim; i++) {
          expect(Math.abs(out[i]! - expectedDerivative[i]!)).toBeLessThan(1e-12);
        }
      }
    },
  );
});
