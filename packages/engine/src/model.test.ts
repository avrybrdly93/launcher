import { describe, expect, it } from "vitest";
import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/** Trivial dy/dt = -y decay model, standing in for a real physics Model. */
function createMockDecayModel(): Model {
  return {
    dim: 1,
    channels: [{ name: "y", unit: "1" }],
    rhs(_t, y, out, _ctx) {
      out[0] = -y[0]!;
    },
    invariants: [{ name: "sign", evaluate: (_t, y) => Math.sign(y[0]!) }],
    events: [{ name: "zero-crossing", g: (_t, y) => y[0]! }],
    partitions: { q: [0], p: [] },
  };
}

/** Minimal explicit-Euler stub: enough to prove a Model is integrable by generic code. */
function stubEulerIntegrate(
  model: Model,
  y0: Float64Array,
  dt: number,
  steps: number,
): Float64Array {
  const y = Float64Array.from(y0);
  const out = new Float64Array(model.dim);
  const ctx = {} as EvalContext; // the mock rhs never touches ctx
  for (let i = 0; i < steps; i++) {
    model.rhs(i * dt, y, out, ctx);
    for (let k = 0; k < model.dim; k++) y[k] = y[k]! + dt * out[k]!;
  }
  return y;
}

describe("Model interface", () => {
  it("typechecks a mock model declaring channels, invariants, events, partitions", () => {
    const model = createMockDecayModel();
    expect(model.dim).toBe(1);
    expect(model.channels[0]?.name).toBe("y");
    expect(model.invariants?.[0]?.name).toBe("sign");
    expect(model.events?.[0]?.name).toBe("zero-crossing");
    expect(model.partitions).toEqual({ q: [0], p: [] });
  });

  it("a stub integrator can drive the mock model through rhs alone", () => {
    const model = createMockDecayModel();
    const result = stubEulerIntegrate(model, Float64Array.from([1]), 1e-4, 10000);
    // Euler approximation of y' = -y over t=1 should approach e^-1.
    expect(result[0]).toBeCloseTo(Math.exp(-1), 3);
  });
});
