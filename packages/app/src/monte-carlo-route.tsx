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
 * **The study runs in a worker (P0.119), which is what makes Cancel and the
 * progress bar real.** The work is CPU-bound JavaScript, so a synchronous
 * `runMcDashboardStudy` call on this thread would block the event loop for its
 * whole duration -- during which the Cancel click cannot be delivered, the bar
 * cannot paint, and the `AbortSignal` cannot become aborted. A Cancel button
 * wired to that would be decoration.
 *
 * Until P0.119 this route drove `mcDashboardStudySteps` itself and hopped a
 * macrotask every few replicates, which made the button real but left the
 * integrations on the UI thread between hops. `pool.runMc` moves the whole
 * drain into a worker instead: the same generator, the same steps, the same
 * partial estimates, on a thread that cannot stall a frame. Cancel is now a
 * worker termination rather than a loop that checks a flag -- see
 * `WorkerPool.runMc` for why a busy worker cannot be asked politely.
 */

import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import {
  createWorkerPool,
  DEFAULT_FAN_REPLICATES,
  detectComputeCapability,
  type ComputeCapabilityReport,
  type McDashboardStudySpec,
} from "@ballista/runtime";
import { uncertainScenarioSpecSchema, type UncertainScenarioSpec } from "@ballista/engine";
import type { Target } from "@ballista/analysis";
import { MonteCarloPage, WebGpuCapabilityPanel, type McStudyRunner } from "@ballista/ui";
import { createMcWorker } from "./mc-worker-factory.js";
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
 * The study spec for one run at `replicates`, exactly as it crosses into the
 * worker.
 *
 * Exported for its test: the route's own value is the one thing a fake worker
 * cannot check, so the suite asserts the spec is a valid, varying golf-drive
 * study rather than trusting that it is.
 */
export function golfDriveStudySpec(replicates: number): McDashboardStudySpec {
  return {
    study: { ...GOLF_DRIVE_UNCERTAINTY_STUDY, replicates },
    target: GOLF_DRIVE_TARGET,
  };
}

/** Study knobs the dashboard runs with, forwarded into the worker. */
export const GOLF_DRIVE_STUDY_OPTIONS = { fanReplicates: DEFAULT_FAN_REPLICATES } as const;

/**
 * P7.13's capability report, mounted here because this is the route whose work
 * is an ensemble -- the thing Phase 7's GPU path is being built to accelerate.
 *
 * Probed once on mount and held in state. The probe is async and cannot throw
 * (`probeWebGpu`'s contract), so there is no error branch to render: the report
 * *is* the answer, on a machine with no GPU as much as on one with.
 */
function useComputeCapability(): ComputeCapabilityReport | null {
  const [report, setReport] = useState<ComputeCapabilityReport | null>(null);

  useEffect(() => {
    let live = true;
    void detectComputeCapability().then((result) => {
      if (live) setReport(result);
    });
    return () => {
      live = false;
    };
  }, []);

  return report;
}

export function MonteCarloRoute() {
  const capability = useComputeCapability();

  // One worker, created once for the route's lifetime and terminated with it,
  // exactly as `inverse-solver-route.tsx` does. Size 1 because a study is a
  // sequential reduction -- see `WorkerPool.runMc` for why there is nothing
  // here to fan out. A cancelled study terminates this worker and the pool
  // refills the slot, so the route survives a Cancel without remounting.
  const pool = useMemo(() => createWorkerPool({ createWorker: createMcWorker, size: 1 }), []);
  useEffect(() => () => pool.terminate(), [pool]);

  const runStudy = useCallback<McStudyRunner>(
    ({ replicates, signal, onProgress }) =>
      pool.runMc(golfDriveStudySpec(replicates), {
        studyOptions: GOLF_DRIVE_STUDY_OPTIONS,
        ...(signal === undefined ? {} : { signal }),
        ...(onProgress === undefined ? {} : { onProgress }),
      }),
    [pool],
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
        The study runs in a worker, so the page stays responsive while it works &mdash; the progress
        bar keeps moving, the estimate below it tightens as replicates accumulate, and Cancel takes
        effect immediately rather than at the end of a batch.
      </p>
      <MonteCarloPage runStudy={runStudy} targetLabel={label} initialReplicates={256} />
      <WebGpuCapabilityPanel report={capability} />
    </div>
  );
}
