import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  FunctionTerrain,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
  type Terrain,
} from "@ballista/engine";
import { ClassicalRK4Stepper } from "./classical-rk4-stepper.js";
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { EventCollector } from "./event-collector.js";
import { HermiteDenseOutputStepper } from "./hermite-dense-output.js";
import { integrate } from "./integrate.js";
import type { Stepper } from "./types.js";

/**
 * P0.101's validation criterion, stated as a sweep rather than as a sentence:
 * **no bouncing configuration returns `status: "ok"` with the projectile
 * below the terrain.**
 *
 * The rest of the restitution suite works the drag-free flat-ground case,
 * because that is the one with a closed form to check impact times and rest
 * counts against. This file gives up the closed form deliberately and buys
 * generality with it: non-flat terrain and quadratic drag, where no
 * analytical answer exists, but where the criterion is still a yes/no
 * question about the final state.
 *
 * **Why this is not a restatement of the fix.** The defect was a residual of
 * either sign left by the root find, so which configurations tripped it was
 * not predictable from the parameters -- P0.101's own filing records the
 * impact count being non-monotone in `h`. Measured on this tree with
 * `withSurfaceSnap` reduced to a no-op, **112 of these 240 configurations
 * return `ok` with the projectile between 42 and 570 m below the ground.**
 * With it in place, none do. That control is the reason the numbers below are
 * an assertion and not a tautology.
 */

const T_SPAN: readonly [number, number] = [0, 12];
const Y0 = [0, 5, 3, 0] as const;

const TERRAINS: readonly (readonly [string, () => Terrain | undefined])[] = [
  ["flat", () => undefined],
  ["slope", () => new FunctionTerrain((x) => -0.1 * x)],
  // A bowl puts the impact on a rising surface on the way out, which is the
  // case where h(x) at the post-impact abscissa differs most from h at the
  // one the bracket started from.
  ["bowl", () => new FunctionTerrain((x) => 0.02 * x * x - 0.4 * x)],
  ["wavy", () => new FunctionTerrain((x) => 0.3 * Math.sin(0.7 * x))],
];

const STEPPERS: readonly (readonly [string, () => Stepper])[] = [
  ["dopri5", () => createDormandPrince54Stepper()],
  ["rk4+hermite", () => new HermiteDenseOutputStepper(new ClassicalRK4Stepper())],
];

function run(
  e: number,
  vRest: number,
  terrain: Terrain | undefined,
  cd: number,
  stepper: Stepper,
  cfg: { h?: number; rtol?: number },
) {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 1,
    radius: 0.05,
    dragCoefficient: new ConstantCd(cd),
  });
  const ctx = createEvalContext(env, params);
  const forces = cd > 0 ? [new GravityForce(), new QuadraticDragForce()] : [new GravityForce()];
  const model = createPlanarProjectileModel(forces, terrain, { e, muF: 1, vRest });
  const collector = new EventCollector();
  const report = integrate(
    model,
    ctx,
    Float64Array.from(Y0),
    T_SPAN,
    { stepper: stepper.info.id, maxSteps: 2_000_000, ...cfg },
    stepper,
    [collector],
  );
  return {
    report,
    impacts: collector.events.filter((r) => r.event.name === "ground-impact"),
  };
}

describe("restitution: a bouncing solve never reports ok below the terrain (P0.101, P0.103)", () => {
  it("holds across 240 configurations of terrain, drag, restitution, stepper and step size", () => {
    const violations: string[] = [];
    let checked = 0;
    let bounced = 0;

    for (const [stepperName, makeStepper] of STEPPERS) {
      // Only the embedded pair can be driven adaptively; `integrate` throws
      // on the others, which is its own contract and not this file's subject.
      const configs =
        stepperName === "dopri5"
          ? [{ h: 0.12 }, { h: 0.4 }, { rtol: 1e-8 }]
          : [{ h: 0.12 }, { h: 0.4 }];

      for (const [terrainName, makeTerrain] of TERRAINS) {
        for (const cd of [0, 0.47]) {
          for (const e of [0.2, 0.5, 0.8]) {
            for (const vRest of [0.2, 1e-3]) {
              for (const cfg of configs) {
                const terrain = makeTerrain();
                const { report, impacts } = run(e, vRest, terrain, cd, makeStepper(), cfg);
                checked++;
                if (impacts.length > 1) bounced++;

                // Height of the ground *under the final position*, which is
                // the only meaningful reference on non-flat terrain.
                const ground = terrain ? terrain.height(report.yFinal[0]!) : 0;
                const depth = report.yFinal[1]! - ground;

                // The criterion. A loud failure is permitted by it and is not
                // counted here; silently finishing underground is not.
                if (report.status === "ok" && depth < -1e-6) {
                  violations.push(
                    `${stepperName} ${terrainName} cd=${cd} e=${e} vRest=${vRest} ` +
                      `${JSON.stringify(cfg)} depth=${depth.toExponential(3)} ` +
                      `impacts=${impacts.length}`,
                  );
                }
              }
            }
          }
        }
      }
    }

    expect(checked).toBe(240);
    // Guards the sweep against becoming vacuous by construction: if a future
    // change stopped these configurations bouncing at all, every one would
    // trivially satisfy the criterion above.
    expect(bounced).toBe(240);
    expect(violations).toEqual([]);
  });
});
