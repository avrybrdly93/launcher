/**
 * Wires the default route to a live `SimulationSession` (P3.03/P3.13,
 * `@ballista/runtime`) plus a `compareStore` (P3.25) and the share-URL
 * codec (P3.32): on mount, decodes a `#s=...` share fragment if the page
 * was opened from one, else runs `DEFAULT_SCENARIO` -- either way a real
 * trajectory is committed and published before this renders its ready
 * state. Exposes exactly the affordances P3.46's smoke suite drives: a
 * scrub input over `playback.playbackTime`, a pin button that appends the
 * current trajectory to the compare legend, and a share button that
 * builds a share URL and pushes it into the address bar via
 * `history.replaceState` (so reloading, or opening the URL fresh, lands
 * back on the same scenario through the same boot path).
 *
 * This does not wire the full six-group control dock (`LaunchPanel` et al.,
 * §6.3) or the WorldLayer/HudLayer canvas render loop (§6.1) -- neither is
 * named in this task's validation criterion ("load, run default, scrub,
 * pin, share-URL"), and each is its own substantial integration.
 */

import {
  DEFAULT_SCENARIO,
  buildShareUrl,
  compareLegend,
  createCompareStore,
  createSimulationSession,
  parseShareUrl,
  type CompareStoreState,
  type PlaybackStoreState,
  type ResultStoreState,
} from "@ballista/runtime";
import { CompareLegend } from "@ballista/ui";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

/** The subset of a nanostores `ReadableAtom` {@link useAtomValue} needs (avoids an `app` -> `nanostores` direct dependency for one type). */
interface ObservableAtom<T> {
  get(): T;
  subscribe(listener: (value: T) => void): () => void;
}

/** Re-renders on every change to a nanostores atom, starting from its current value. */
function useAtomValue<T>(atom: ObservableAtom<T>): T {
  const [value, setValue] = useState(atom.get());
  useEffect(() => atom.subscribe(setValue), [atom]);
  return value;
}

function hasShareFragment(): boolean {
  return typeof window !== "undefined" && window.location.hash.startsWith("#s=");
}

export function SimulatorControls() {
  const session = useMemo(() => createSimulationSession(), []);
  const compareStore = useMemo(() => createCompareStore(), []);
  const booted = useRef(false);
  const [ready, setReady] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      const shared = hasShareFragment() ? await parseShareUrl(window.location.href) : null;
      session.commitScenario(shared ?? DEFAULT_SCENARIO);
      setReady(true);
    })();
  }, [session]);

  const resultState: ResultStoreState = useAtomValue(session.result.store);
  const playbackState: PlaybackStoreState = useAtomValue(session.playback.store);
  const compareState: CompareStoreState = useAtomValue(compareStore.store);

  const trajectory = resultState.trajectory;
  const duration = trajectory && trajectory.nSteps > 0 ? trajectory.t[trajectory.nSteps - 1]! : 0;

  function handleScrub(event: Event) {
    session.scrubTo(Number((event.currentTarget as HTMLInputElement).value));
  }

  function handlePin() {
    if (!trajectory) return;
    const committed = session.scenario.getState().committed;
    compareStore.pin(trajectory, committed.solver.stepper, committed.projectile.name);
  }

  async function handleShare() {
    const committed = session.scenario.getState().committed;
    const url = await buildShareUrl(window.location.href, committed);
    setShareUrl(url);
    window.history.replaceState(null, "", url);
  }

  if (!ready) {
    return (
      <p class="simulator-controls" data-testid="sim-status" data-sim-status="loading">
        Running default scenario&hellip;
      </p>
    );
  }

  return (
    <div class="simulator-controls" data-testid="simulator-controls">
      <p data-testid="sim-summary" data-sim-status="ready">
        {trajectory
          ? `steps=${trajectory.nSteps} range=${trajectory.channels[0]![
              trajectory.nSteps - 1
            ]!.toFixed(6)} duration=${duration.toFixed(6)}`
          : "no trajectory"}
      </p>

      <label>
        Scrub
        <input
          type="range"
          data-testid="scrub-bar"
          min={0}
          max={duration > 0 ? duration : 0}
          step={duration > 0 ? duration / 1000 : 1}
          value={playbackState.playbackTime}
          disabled={duration <= 0}
          onInput={handleScrub}
        />
      </label>
      <span data-testid="scrub-time">{playbackState.playbackTime.toFixed(6)}</span>

      <button type="button" data-testid="pin-button" disabled={!trajectory} onClick={handlePin}>
        Pin trajectory
      </button>
      <CompareLegend
        entries={compareLegend(compareState)}
        onUnpin={(id) => compareStore.unpin(id)}
      />

      <button type="button" data-testid="share-button" onClick={() => void handleShare()}>
        Copy share URL
      </button>
      {shareUrl !== null && (
        <input type="text" readOnly data-testid="share-url-output" value={shareUrl} />
      )}
    </div>
  );
}
