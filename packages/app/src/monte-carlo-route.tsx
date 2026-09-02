/**
 * Monte Carlo dashboard route (P6.24): the golf-drive uncertainty study the
 * task's criterion names, run end to end from the UI.
 *
 * The route is the edge that supplies a real runner, exactly as
 * `inverse-solver-route.tsx` supplies a real worker pool: `MonteCarloPage`
 * takes `runStudy` as a prop so the pane's lifecycle is testable without
 * integrating anything, and this module is where the integration actually
 * happens.
 *
 * **The study runs on this thread, and the driver is what keeps Cancel
 * honest.** P6.25 is the task that moves it to a worker and streams partial
 * results; until then the work is CPU-bound JavaScript on the UI thread, and
 * a single synchronous `runMcDashboardStudy` call would block the event loop
 * for its whole duration -- during which the Cancel click cannot be
 * delivered, the progress bar cannot paint, and the `AbortSignal` cannot
 * become aborted. A Cancel button wired to that would be decoration. So this
 * drives `mcDashboardStudySteps` instead and yields to the event loop every
 * {@link YIELD_EVERY} replicates, which is what makes the button, and the
 * bar, real.
 */

import { useCallback, useMemo } from "preact/hooks";
import {
  DEFAULT_FAN_REPLICATES,
  mcDashboardStudySteps,
  type McDashboardResult,
} from "@ballista/runtime";
import { uncertainScenarioSpecSchema, type UncertainScenarioSpec } from "@ballista/engine";
import type { Target } from "@ballista/analysis";
import { MonteCarloPage, type McStudyRunner } from "@ballista/ui";
import { PRESET_SCENARIO_OPTIONS } from "./preset-scenario-options.js";
import "./solver-lab-route.css";

/**
 * The golf drive, looked up by its **curated** id rather than by its
 * projectile's.
 *
 * P0.115 is the reason: two presets share a projectile id, and
 * `PRESET_SCENARIOS.find((s) => s.projectile.id === ...)` silently returns
 * whichever comes first. `PRESET_SCENARIO_OPTIONS` carries the unique curated
 * id, so this cannot pick the wrong scenario.
 */
const GOLF_DRIVE = PRESET_SCENARIO_OPTIONS.find((option) => option.id === "golf-drive")!.spec;

/**
 * What varies about the drive, and by how much.
 *
 * Three inputs, chosen because each is a thing a golfer actually fails to
 * repeat and each moves the range through a different mechanism: ball speed
 * (the dominant term), launch angle via the vertical component, and backspin,
 * which is the Magnus force's whole input and the reason this preset is the
 * library's reference Magnus scenario.
 *
 * **The spreads are illustrative and are not measurements of any golfer.**
 * They are round numbers of order a few percent -- enough to produce a
 * visible ensemble -- and nothing downstream should be read as a claim about
 * real dispersion. The study is here to exercise the estimators.
 */
export const GOLF_DRIVE_UNCERTAINTY_STUDY: UncertainScenarioSpec =
  uncertainScenarioSpecSchema.parse({
    schemaVersion: 1,
    base: { ...GOLF_DRIVE, initialConditions: { ...GOLF_DRIVE.initialConditions, x0: 0, y0: 0 } },
    overlays: [
      {
        path: "initialConditions.vx0",
        distribution: {
          kind: "normal",
          mean: GOLF_DRIVE.initialConditions.vx0,
          stdDev: 1.5,
        },
      },
      {
        path: "initialConditions.vy0",
        distribution: {
          kind: "normal",
          mean: GOLF_DRIVE.initialConditions.vy0,
          stdDev: 1.0,
        },
      },
      {
        path: "initialConditions.spin0",
        distribution: { kind: "normal", mean: 300, stdDev: 25 },
      },
    ],
    // Overwritten per run by the pane's N control; this is the schema's
    // required field, not the number the dashboard uses.
    replicates: 512,
    seed: 20260902,
  });

/**
 * The landing area the hit probability is scored against: a 15 m circle
 * centred 250 m downrange.
 *
 * A point target with a tolerance rather than a ring, because "did the ball
 * finish inside a fairway-width circle" is the question a golfer asks, and
 * `targets.ts`'s `isHit` already answers exactly that for this shape. The
 * radius is generous on purpose -- a target the ensemble always hits or never
 * hits would pin p̂ at 0 or 1 and make the Wilson interval the only thing on
 * the screen with any width.
 */
export const GOLF_DRIVE_TARGET: Target = { kind: "point", center: [250, 0], tolerance: 15 };

export const GOLF_DRIVE_TARGET_LABEL = "a 15 m circle, 250 m downrange";

/**
 * Replicates between yields to the event loop.
 *
 * Small enough that a Cancel click waits at most a handful of integrations,
 * large enough that the yields themselves are not the cost: a macrotask hop
 * is on the order of a millisecond, so yielding every replicate would roughly
 * double the wall time of a study whose replicates take about that long.
 */
const YIELD_EVERY = 16;

/** One macrotask hop, so queued input and a repaint can happen. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Drives the study generator, yielding periodically and honouring `signal`.
 *
 * Exported for its test: this is where "the button works" actually lives, and
 * it is ordinary async code that a test can drive without a DOM.
 */
export async function runGolfDriveStudy(options: {
  readonly replicates: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: Parameters<McStudyRunner>[0]["onProgress"];
  /** Injected by the test so it need not integrate 512 trajectories. */
  readonly study?: UncertainScenarioSpec;
  readonly yieldEvery?: number;
}): Promise<McDashboardResult> {
  const study = options.study ?? GOLF_DRIVE_UNCERTAINTY_STUDY;
  const yieldEvery = options.yieldEvery ?? YIELD_EVERY;
  const steps = mcDashboardStudySteps(
    { study: { ...study, replicates: options.replicates }, target: GOLF_DRIVE_TARGET },
    { fanReplicates: DEFAULT_FAN_REPLICATES },
  );

  let sinceYield = 0;
  for (;;) {
    if (options.signal?.aborted === true) {
      // `return` rather than `throw` into the generator: the study is
      // abandoned, and the finally-less generator simply stops. The rejection
      // is what the pane reads as a cancel.
      steps.return(undefined as never);
      throw new DOMException("study cancelled", "AbortError");
    }
    const next = steps.next();
    if (next.done === true) return next.value;
    options.onProgress?.(next.value);
    sinceYield += 1;
    if (sinceYield >= yieldEvery) {
      sinceYield = 0;
      await yieldToEventLoop();
    }
  }
}

export function MonteCarloRoute() {
  const runStudy = useCallback<McStudyRunner>(
    ({ replicates, signal, onProgress }) =>
      runGolfDriveStudy({
        replicates,
        ...(signal === undefined ? {} : { signal }),
        ...(onProgress === undefined ? {} : { onProgress }),
      }),
    [],
  );

  // Stable across renders so the pane's `useCallback` dependency does not
  // change every time state does, which would rebuild its study closure.
  const label = useMemo(() => GOLF_DRIVE_TARGET_LABEL, []);

  return (
    <div class="solver-lab-route" data-testid="monte-carlo-route">
      <a href="#/" class="solver-lab-route-back" data-testid="monte-carlo-back-link">
        &larr; Back to simulator
      </a>
      <h1>Monte Carlo uncertainty</h1>
      <p>
        The library&rsquo;s golf drive, with ball speed, launch angle and backspin drawn from normal
        distributions instead of fixed. Each replicate is a full integration of the same model the
        simulator runs; the four panels below are four views of the one ensemble. The spreads are
        illustrative round numbers, not measurements of any golfer.
      </p>
      <p>
        The study runs on this thread, so it yields between batches of replicates rather than
        blocking &mdash; which is what lets the progress bar move and Cancel take effect. Moving it
        to a worker, with estimates that tighten live, is P6.25.
      </p>
      <MonteCarloPage runStudy={runStudy} targetLabel={label} initialReplicates={256} />
    </div>
  );
}
