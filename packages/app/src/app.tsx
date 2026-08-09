import type { ScenarioSpec } from "@ballista/engine";
import {
  DEFAULT_SCENARIO,
  buildShareUrl,
  compareLegend,
  createCompareStore,
  createSimulationSession,
  parseShareUrl,
} from "@ballista/runtime";
import { CompareLegend, SensitivityPanel, computeSensitivityReadout } from "@ballista/ui";
import type { ReadableAtom } from "nanostores";
import { useEffect, useMemo, useState } from "preact/hooks";
import { AppShell } from "./app-shell.js";
import { CanvasViewport } from "./canvas-viewport.js";

/**
 * The default route's session + pin list live at module scope (one instance
 * per page load, shared across every mount of `App` -- e.g. navigating to
 * `#/solver-lab` and back doesn't lose the committed scenario or pinned
 * trajectories). Committing `DEFAULT_SCENARIO` here, synchronously at
 * import time, is what makes "load the app" and "see the default scenario
 * already run" (P3.46) the same moment -- no explicit Run button exists
 * because §5.3's draft/committed split already auto-integrates on commit.
 */
const session = createSimulationSession(DEFAULT_SCENARIO);
const compare = createCompareStore();
session.commitScenario(DEFAULT_SCENARIO);

/**
 * `globalThis.location`, guarded (mirrors `simulation-session.ts`'s
 * `now()`/`defaultFrameScheduler` pattern): this module is imported by
 * `app.test.tsx` under both jsdom and plain-Node vitest environments, and
 * only the former has a `location`.
 */
function currentLocation(): { href: string } | undefined {
  return (globalThis as { location?: { href: string } }).location;
}

// Share-URL "load on boot" (P3.32, §6.3 point 7): if the page was opened
// with a `#s=...` fragment, decode it and commit over the default scenario.
// Async by nature (WHATWG Compression Streams), so this necessarily lands
// a frame or two after the synchronous default-scenario commit above.
const bootLocation = currentLocation();
if (bootLocation) {
  void parseShareUrl(bootLocation.href).then((shared) => {
    if (shared) session.commitScenario(shared);
  });
}

/**
 * Subscribes to a nanostores atom, re-rendering on every change (P3.02
 * stores + preact, no `@nanostores/preact` dependency needed for one hook).
 * Re-syncs to `atom.get()` the moment the effect (re-)runs, not just the
 * initial `useState` snapshot: `useEffect` fires asynchronously after the
 * first paint, so a caller that mutates the atom synchronously right after
 * mount (e.g. a test dispatching a DOM event immediately post-render) would
 * otherwise race ahead of `atom.listen` and be missed -- `listen` only
 * notifies of changes *after* it's called, never replays the current value.
 */
function useAtom<T>(atom: ReadableAtom<T>): T {
  const [value, setValue] = useState(atom.get());
  useEffect(() => {
    setValue(atom.get());
    return atom.listen(setValue);
  }, [atom]);
  return value;
}

function formatSeconds(t: number): string {
  return `${t.toFixed(3)}s`;
}

function currentScenario(): ScenarioSpec {
  return session.scenario.getState().committed;
}

export function App() {
  const result = useAtom(session.result.store);
  const playback = useAtom(session.playback.store);
  const compareState = useAtom(compare.store);
  const scenarioState = useAtom(session.scenario.store);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  /**
   * P5.11's readouts, recomputed only when the *committed* scenario changes --
   * not on playback scrubs, pins or share-URL state, all of which re-render
   * this component without moving the physics.
   *
   * This is a synchronous augmented solve on the main thread, which is a
   * deliberate choice at a measured cost: 0.3-2.7 ms for six of the seven
   * presets, and 22 ms for the dust grain, whose drag relaxation time is far
   * below the step size (`scenario-presets.ts` calls it out as the stiff one).
   * That worst case is one dropped frame per commit, not per frame, and
   * commits are already rate-limited to one per animation frame by §5.3's
   * draft/committed split. Moving it to the worker pool is real work with a
   * real message-protocol surface, and belongs to a task that says so rather
   * than to this one.
   */
  const sensitivity = useMemo(
    () => computeSensitivityReadout(scenarioState.committed),
    [scenarioState.committed],
  );

  const trajectory = result.trajectory;
  const duration = trajectory && trajectory.nSteps > 0 ? trajectory.t[trajectory.nSteps - 1]! : 0;

  function handlePin(): void {
    if (!trajectory) return;
    compare.pin(trajectory, currentScenario().solver.stepper);
  }

  function handleShare(): void {
    const location = currentLocation();
    if (!location) return;
    void buildShareUrl(location.href, currentScenario()).then(setShareUrl);
  }

  return (
    <AppShell
      canvas={<CanvasViewport />}
      controlDock={
        <div class="control-dock" data-testid="control-dock">
          <p data-testid="run-status">
            {trajectory
              ? `Trajectory: ${trajectory.nSteps} points, T=${formatSeconds(duration)}`
              : "No trajectory yet."}
          </p>

          <label class="control-dock__scrubber">
            Playback time
            <input
              type="range"
              min={0}
              max={duration}
              step={duration > 0 ? duration / 1000 : 1}
              value={playback.playbackTime}
              disabled={duration <= 0}
              data-testid="playback-scrubber"
              onInput={(event) => session.scrubTo(Number((event.target as HTMLInputElement).value))}
            />
            <span data-testid="playback-time-readout">{formatSeconds(playback.playbackTime)}</span>
          </label>

          <button type="button" data-testid="pin-button" disabled={!trajectory} onClick={handlePin}>
            Pin trajectory
          </button>
          <CompareLegend
            entries={compareLegend(compareState)}
            onUnpin={(id) => compare.unpin(id)}
          />

          <button type="button" data-testid="share-url-button" onClick={handleShare}>
            Copy share URL
          </button>
          {shareUrl !== null && (
            <input type="text" readOnly value={shareUrl} data-testid="share-url-output" />
          )}

          <p>
            <a href="#/solver-lab">Open Solver Lab &rarr;</a>{" "}
            <a href="#/convergence-study">Open Convergence Study &rarr;</a>{" "}
            <a href="#/stability-explorer">Open Stability Explorer &rarr;</a>{" "}
            <a href="#/energy-drift">Open Energy Drift &rarr;</a>{" "}
            <a href="#/terrain-editor">Open Terrain Editor &rarr;</a>{" "}
            <a href="#/neglected-effects">Open Neglected Effects &rarr;</a>{" "}
            <a href="#/density-altitude">Open Density Altitude &rarr;</a>{" "}
            <a href="#/model-registry">Open Model Registry &rarr;</a>
          </p>
        </div>
      }
      analysisDrawer={<SensitivityPanel readout={sensitivity} />}
    />
  );
}
