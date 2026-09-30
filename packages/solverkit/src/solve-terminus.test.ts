import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  G_STD,
  GravityForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
  type Model,
} from "@ballista/engine";
import { createCancellationSource } from "./cancellation-token.js";
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { beginIntegration, integrate } from "./integrate.js";
import type { SolveReport, SolveTerminus } from "./types.js";

/**
 * `SolveReport.terminus` — where a solve stopped, as distinct from whether it
 * succeeded (P0.143).
 *
 * **The complaint this file answers.** ADR-021 ends a bouncing trajectory at
 * its resting contact: `v_y` is zeroed, `v_x` keeps its `muF` factor, and the
 * solve stops. With `muF = 1` the ball therefore finishes *sitting on the
 * ground moving sideways*, and no force in the model accounts for that motion —
 * rolling, sliding and the normal contact force are unmodelled, which ADR-021
 * states outright and filed as P0.143. Nothing `integrate` reports is wrong; it
 * reports exactly what it integrated. The defect was that the report gave a
 * caller **no way to tell that ending apart from a trajectory that simply ran
 * out of time**, and those two final states mean entirely different things.
 *
 * P0.143 offered three fixes and its own criterion admits two of them. This is
 * the reporting one: nothing physical is added, and the assertions below are
 * about what the report *says*, never about a new number. The physics option —
 * a contact phase with a named force — stays open, because blueprint §4.9
 * covers "stop or reflect" and nothing past it.
 *
 * So the load-bearing test in this file is not any single terminus value. It is
 * that **all five endings are distinguishable, and that the resting contact is
 * distinguishable from the span running out**, which is the confusion the row
 * was filed about.
 */

const H0 = 5;
/** Horizontal velocity of the drop below. Deliberately non-zero: it is the whole point. */
const VX0 = 3;

/** A drag-free ball dropped from `H0` with `muF = 1`, so `v_x` survives every impact intact. */
function dropWithRestitution(vRest: number, tspan: readonly [number, number] = [0, 12]) {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 1,
    radius: 0.05,
    dragCoefficient: new ConstantCd(0),
  });
  const model = createPlanarProjectileModel([new GravityForce()], undefined, {
    e: 0.2,
    muF: 1,
    vRest,
  });
  return integrate(
    model,
    createEvalContext(env, params),
    new Float64Array([0, H0, VX0, 0]),
    tspan,
    { stepper: "dopri5", h: 0.12, maxSteps: 2_000_000 },
    createDormandPrince54Stepper(),
  );
}

/**
 * `y = [s, n]`, `dy/dt = [1, 0]`: `s` is the clock, so a crossing time is a
 * position and there is no discretisation error to argue with. `action`
 * omitted, so the event is a plain terminal one.
 */
function createPlainTerminalEventModel(at: number): Model {
  return {
    dim: 2,
    channels: [
      { name: "s", unit: "m" },
      { name: "n", unit: "1" },
    ],
    rhs: (_t: number, _y: Float64Array, out: Float64Array): void => {
      out[0] = 1;
      out[1] = 0;
    },
    events: [
      { name: "mark", g: (_t: number, y: Float64Array): number => y[0]! - at, terminal: true },
    ],
  };
}

/** The same model with no events at all, so the only way out is the span. */
function createNoEventModel(): Model {
  return {
    dim: 2,
    channels: [
      { name: "s", unit: "m" },
      { name: "n", unit: "1" },
    ],
    rhs: (_t: number, _y: Float64Array, out: Float64Array): void => {
      out[0] = 1;
      out[1] = 0;
    },
  };
}

const TICK_CTX = createEvalContext(
  new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind()),
  createSphericalProjectileParams({ mass: 1, radius: 0.05, dragCoefficient: new ConstantCd(0) }),
);

function runTick(model: Model, tspan: readonly [number, number], maxSteps = 10_000): SolveReport {
  return integrate(
    model,
    TICK_CTX,
    new Float64Array([0, 0]),
    tspan,
    { stepper: "dopri5", h: 0.25, maxSteps },
    createDormandPrince54Stepper(),
  );
}

describe("SolveReport.terminus: the resting contact is distinguishable from the span running out (P0.143)", () => {
  it("reports `event-stop` when a resting contact ends the flight, and the final state still carries v_x", () => {
    // This is the row, in one case. vRest is above the detection floor, so
    // ADR-021's threshold is what stops the sequence.
    const report = dropWithRestitution(1e-3);

    expect(report.status).toBe("ok");
    expect(report.terminus).toBe("event-stop");

    // On the ground with the normal channel exactly dead — the resting half of
    // the contact, asserted exactly rather than to a tolerance.
    expect(report.yFinal[1]).toBe(0);
    expect(report.yFinal[3]).toBe(0);

    // AND STILL MOVING SIDEWAYS AT THE FULL LAUNCH SPEED. muF = 1 passes v_x
    // through every impact untouched, so the ball "at rest" is travelling at 3
    // m/s with nothing in the model holding it back. This is what P0.143 was
    // filed about, and the assertion is exact for the same reason: it is not an
    // approximation of a physical result, it is the untouched initial value.
    expect(report.yFinal[2]).toBe(VX0);

    // The point of the whole task: a caller holding this report can now tell
    // that `yFinal` sits at a contact the model does not continue past, instead
    // of having to infer it from `tFinal < tspan[1]` — which is also true of a
    // plain terminal event, and of nothing at all if the span happens to end
    // near the contact.
    expect(report.terminus).not.toBe("time-span");
    expect(report.tFinal).toBeLessThan(12);
  });

  it("reports `time-span` when the requested span simply runs out", () => {
    const report = runTick(createNoEventModel(), [0, 2]);

    expect(report.status).toBe("ok");
    expect(report.terminus).toBe("time-span");
    expect(report.tFinal).toBe(2);
  });

  it("reports `terminal-event` for a terminal event with no action, which is neither of the other two", () => {
    // Distinct from `event-stop`: no `action` ran, so `yFinal` is the localized
    // crossing state and not a post-impulse state. A caller that treats the two
    // alike would read a bounce's post-impulse velocity as a crossing velocity.
    const report = runTick(createPlainTerminalEventModel(1.5), [0, 10]);

    expect(report.status).toBe("ok");
    expect(report.terminus).toBe("terminal-event");
    expect(report.tFinal).toBeCloseTo(1.5, 12);
    expect(report.tFinal).toBeLessThan(10);
  });

  it("distinguishes all three `ok` endings from one another — the confusion the row was filed about", () => {
    // Stated as one case as well as three, because the defect was never any
    // single value being wrong: it was three endings sharing one report shape.
    const termini = [
      dropWithRestitution(1e-3).terminus,
      runTick(createNoEventModel(), [0, 2]).terminus,
      runTick(createPlainTerminalEventModel(1.5), [0, 10]).terminus,
    ];

    expect(new Set(termini).size).toBe(3);
    expect(termini).toEqual(["event-stop", "time-span", "terminal-event"]);
  });

  it("reports `failure` for a typed failure, where tFinal is a last-good state and not a terminus", () => {
    const report = runTick(createNoEventModel(), [0, 1000], 3);

    expect(report.status).toBe("failed");
    expect(report.terminus).toBe("failure");
    expect(report.failure?.reason).toBe("max-steps-exceeded");
    // It did not reach t_f, and `terminus` is what says so without the caller
    // having to compare tFinal against a span it may no longer hold.
    expect(report.tFinal).toBeLessThan(1000);
  });

  it("reports `cancellation` when a chunked solve is canceled between steps", () => {
    const { token, cancel } = createCancellationSource();
    const continuation = beginIntegration(
      createNoEventModel(),
      TICK_CTX,
      new Float64Array([0, 0]),
      [0, 1000],
      { stepper: "dopri5", h: 0.25, maxSteps: 10_000 },
      createDormandPrince54Stepper(),
      [],
      token,
    );

    continuation.runSlice(4);
    cancel();
    const result = continuation.runSlice(4);

    expect(result.done).toBe(true);
    expect(result.report?.status).toBe("canceled");
    expect(result.report?.terminus).toBe("cancellation");
  });

  it("never disagrees with `status`", () => {
    // `terminus` is a finer statement than `status`, not a competing one. If
    // these two can ever contradict each other, a caller has to decide which to
    // believe, and the field has made things worse rather than better.
    const okTermini: readonly SolveTerminus[] = ["time-span", "terminal-event", "event-stop"];
    const reports: readonly SolveReport[] = [
      dropWithRestitution(1e-3),
      runTick(createNoEventModel(), [0, 2]),
      runTick(createPlainTerminalEventModel(1.5), [0, 10]),
      runTick(createNoEventModel(), [0, 1000], 3),
    ];

    for (const report of reports) {
      if (report.status === "ok") {
        expect(okTermini).toContain(report.terminus);
      } else if (report.status === "failed") {
        expect(report.terminus).toBe("failure");
      } else {
        expect(report.terminus).toBe("cancellation");
      }
    }
  });

  it("does not change the trajectory it labels — the vRest = 0 underflow case is untouched", () => {
    // P0.143 option (b) adds no physics, so the numbers ADR-021 and
    // restitution-rest-contact.test.ts pinned must be bit-identical. This
    // re-pins the sharpest of them here, so a future change that quietly turns
    // `terminus` into a behavioural switch fails in the file that introduced it
    // rather than only in the golden store.
    const report = dropWithRestitution(0);
    const t0 = Math.sqrt((2 * H0) / G_STD);
    const tInf = t0 * (1 + (2 * 0.2) / (1 - 0.2));

    expect(report.terminus).toBe("event-stop");
    expect(report.yFinal[1]).toBe(0);
    expect(report.yFinal[3]).toBe(0);
    expect(report.yFinal[2]).toBe(VX0);
    expect(tInf - report.tFinal).toBeCloseTo(6.4628e-6, 9);
  });
});
