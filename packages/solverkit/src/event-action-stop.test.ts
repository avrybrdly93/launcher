import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createSphericalProjectileParams,
  type EventActionOutcome,
  type Model,
} from "@ballista/engine";
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { EventCollector } from "./event-collector.js";
import { integrate } from "./integrate.js";

/**
 * The `EventSpec.action` outcome contract on its own (ADR-021), away from
 * restitution.
 *
 * Before ADR-021 a terminal event had exactly two shapes: an `action`, which
 * always reflected and continued, or no `action`, which always stopped
 * without transforming the state. **"Stop, and here is the state to stop
 * at" was inexpressible**, and a restitution sequence's last impact is
 * exactly that. This file pins the third shape against a model contrived to
 * make each outcome visible, so a regression in the driver's branch is
 * reported here rather than three layers up as a bouncing ball that stopped
 * one bounce early.
 *
 * The model is deliberately not a projectile: `y = [position, counter]`,
 * `dy/dt = [1, 0]`, with an event at every unit of position. Integer
 * crossing times and an exactly-integrable rhs mean any drift in the
 * assertions below is the driver's, not the stepper's.
 */
function createUnitTickModel(onTick: (n: number) => EventActionOutcome | void): Model {
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
      {
        name: "tick",
        // Distance to the *next* tick: the action increments the counter, so
        // this resets to -1 after every firing. That is deliberate -- an
        // indicator that re-arms through the action's own transform makes a
        // dropped or duplicated firing visible as a shifted crossing time
        // rather than as a count that happens to match.
        g: (_t: number, y: Float64Array): number => y[0]! - (y[1]! + 1),
        direction: "rising",
        terminal: true,
        action: (_t: number, y: Float64Array, out: Float64Array): EventActionOutcome | void => {
          out.set(y);
          out[1] = y[1]! + 1;
          return onTick(out[1]!);
        },
      },
    ],
  };
}

function solve(model: Model, tEnd: number) {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const ctx = createEvalContext(
    env,
    createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    }),
  );
  const stepper = createDormandPrince54Stepper();
  const collector = new EventCollector();
  const report = integrate(
    model,
    ctx,
    new Float64Array([0, 0]),
    [0, tEnd],
    { stepper: stepper.info.id, h: 0.25, maxSteps: 10000 },
    stepper,
    [collector],
  );
  return { report, collector };
}

describe("integrate: an action's outcome decides continue-or-stop (ADR-021)", () => {
  it("returning nothing reflects and continues, which is exactly the pre-ADR behaviour", () => {
    const { report, collector } = solve(
      createUnitTickModel(() => undefined),
      4.5,
    );

    expect(report.status).toBe("ok");
    // Ran to the requested t_f: no firing ended the solve.
    expect(report.tFinal).toBe(4.5);
    // Four integer crossings in (0, 4.5]: s = 1, 2, 3, 4.
    expect(collector.events.filter((r) => r.event.name === "tick")).toHaveLength(4);
    expect(report.yFinal[1]).toBe(4);
  });

  it('returning "continue" is the same thing said out loud', () => {
    const { report, collector } = solve(
      createUnitTickModel(() => "continue"),
      4.5,
    );

    expect(report.status).toBe("ok");
    expect(report.tFinal).toBe(4.5);
    expect(collector.events.filter((r) => r.event.name === "tick")).toHaveLength(4);
    expect(report.yFinal[1]).toBe(4);
  });

  it('returning "stop" on the third firing ends the solve there, with the POST-action state', () => {
    const { report, collector } = solve(
      createUnitTickModel((n) => (n === 3 ? "stop" : "continue")),
      4.5,
    );

    expect(report.status).toBe("ok");
    // Stopped at the third crossing, s = 3, well before t_f = 4.5.
    expect(report.tFinal).toBeCloseTo(3, 10);
    expect(report.yFinal[0]).toBeCloseTo(3, 10);
    // The distinguishing assertion of the whole ADR: `yFinal` carries the
    // action's transform. A plain terminal stop would report the state the
    // event fired at, with the counter still at 2.
    expect(report.yFinal[1]).toBe(3);
    expect(collector.events.filter((r) => r.event.name === "tick")).toHaveLength(3);
  });

  it('a "stop" firing is dispatched to sinks exactly like a continuing one', () => {
    const { collector } = solve(
      createUnitTickModel((n) => (n === 2 ? "stop" : "continue")),
      4.5,
    );

    const ticks = collector.events.filter((r) => r.event.name === "tick");
    expect(ticks).toHaveLength(2);
    // The stopping firing is the last recorded event, not a silently
    // swallowed one -- a caller reconstructing the flight from the event
    // log must see the impact that ended it.
    expect(ticks.at(-1)!.t).toBeCloseTo(2, 10);
  });
});
