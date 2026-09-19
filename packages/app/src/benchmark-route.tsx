/**
 * Public benchmark route (P7.32): the §2.6 batch-throughput benchmark, run by
 * whoever opens the page, on their own machine, ending in a card they can
 * copy.
 *
 * **This module is the edge and nothing more**, the same division
 * `monte-carlo-route.tsx` draws: `benchmark-page-run.ts` owns the workload and
 * `benchmark-result-card.ts` owns what a card may say, both pure and both
 * asserted without a browser. What is left here is the clock, the DOM, the
 * event loop and the clipboard.
 *
 * **The run yields to the event loop, which is what makes Cancel real.** The
 * ladder is CPU-bound JavaScript on the thread that paints. Driving the
 * generator inside a `setTimeout(0)` chain -- rather than looping it to
 * exhaustion -- is what lets the progress bar move and the Cancel button be
 * delivered at all. A Cancel wired to a synchronous run would be decoration.
 *
 * **What this page is NOT.** It is not P7.20. P7.20 asks for a published
 * ≥1e6 trajectories/s GPU figure with adapter info, measured on hardware; this
 * page reports whatever the visitor's machine did on one thread, says so on
 * the card, and withholds the §2.6 verdict because one thread is not the
 * configuration that budget is stated at. Nothing measured here is recorded
 * into the repository.
 */

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  buildResultCard,
  benchmarkPageSteps,
  detectComputeCapability,
  formatResultCard,
  verdictRung,
  PAGE_REPLICATES,
  type BenchmarkPageStep,
  type ComputeCapabilityReport,
  type LadderRung,
  type ResultCard,
} from "@ballista/runtime";
import "./solver-lab-route.css";

/** What the page is doing right now. */
type RunState = "idle" | "running" | "done" | "cancelled" | "failed";

/**
 * Drives `benchmarkPageSteps` one step per macrotask.
 *
 * `setTimeout(0)` rather than `queueMicrotask`: a microtask runs before the
 * browser gets a chance to paint, so a microtask chain would starve the very
 * repaint the yielding exists to allow.
 */
function driveRun(
  steps: Generator<BenchmarkPageStep, void, void>,
  onStep: (step: BenchmarkPageStep) => void,
  onDone: () => void,
  onError: (error: unknown) => void,
  cancelled: () => boolean,
): void {
  const pump = (): void => {
    if (cancelled()) return;
    try {
      const next = steps.next();
      if (next.done) {
        onDone();
        return;
      }
      onStep(next.value);
      setTimeout(pump, 0);
    } catch (error) {
      onError(error);
    }
  };
  setTimeout(pump, 0);
}

export function BenchmarkRoute() {
  const [state, setState] = useState<RunState>("idle");
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [card, setCard] = useState<ResultCard | null>(null);
  const [includeAdapter, setIncludeAdapter] = useState(false);
  const [capability, setCapability] = useState<ComputeCapabilityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const cancelledRef = useRef(false);
  const rungsRef = useRef<LadderRung[]>([]);

  useEffect(() => {
    let live = true;
    void detectComputeCapability().then((report) => {
      if (live) setCapability(report);
    });
    return () => {
      live = false;
      cancelledRef.current = true;
    };
  }, []);

  const start = useCallback(() => {
    if (!capability) return;
    cancelledRef.current = false;
    rungsRef.current = [];
    setCard(null);
    setError(null);
    setCopied(false);
    setState("running");
    setProgress({ completed: 0, total: 0 });

    const steps = benchmarkPageSteps(PAGE_REPLICATES, {
      now: () => performance.now(),
    });

    driveRun(
      steps,
      (step) => {
        setProgress({ completed: step.completed, total: step.total });
        if (step.rung) rungsRef.current = [...rungsRef.current, step.rung];
      },
      () => {
        const chosen = verdictRung(rungsRef.current);
        if (!chosen) {
          // Not a pass and not a miss: the ladder never reached the accuracy a
          // result is read at. Saying so beats falling back to the fastest
          // rung, which is the one that is fast because it is wrong.
          setError("No ladder rung reached the accuracy a result is read at; no card was built.");
          setState("failed");
          return;
        }
        setCard(buildResultCard(chosen, capability, { includeAdapter }));
        setState("done");
      },
      (thrown) => {
        setError(thrown instanceof Error ? thrown.message : String(thrown));
        setState("failed");
      },
      () => cancelledRef.current,
    );
  }, [capability, includeAdapter]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setState("cancelled");
  }, []);

  // The opt-in is applied to the card already on screen, so toggling it after a
  // run does not require re-running the benchmark -- and so a user can see
  // exactly what including the adapter adds before they copy anything.
  const toggleAdapter = useCallback(
    (next: boolean) => {
      setIncludeAdapter(next);
      setCopied(false);
      const chosen = verdictRung(rungsRef.current);
      if (chosen && capability) {
        setCard(buildResultCard(chosen, capability, { includeAdapter: next }));
      }
    },
    [capability],
  );

  const copy = useCallback(() => {
    if (!card) return;
    const text = formatResultCard(card);
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  }, [card]);

  const percent = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div class="solver-lab-route" data-testid="benchmark-route">
      <a href="#/" class="solver-lab-route-back" data-testid="benchmark-back-link">
        &larr; Back to simulator
      </a>
      <h1>Run the benchmark</h1>
      <p data-testid="benchmark-intro">
        Runs the project&rsquo;s batch-throughput benchmark — {PAGE_REPLICATES} replicates of a golf
        drive per step, fixed-step RK4 — on this machine, on one thread, and gives you a result card
        you can copy. Nothing is sent anywhere.
      </p>

      <div>
        <button
          type="button"
          data-testid="benchmark-run"
          disabled={state === "running" || capability === null}
          onClick={start}
        >
          {state === "running" ? "Running…" : "Run benchmark"}
        </button>
        {state === "running" && (
          <button type="button" data-testid="benchmark-cancel" onClick={cancel}>
            Cancel
          </button>
        )}
      </div>

      {state === "running" && (
        <p data-testid="benchmark-progress">
          {percent}% — {progress.completed} of {progress.total} replicates
        </p>
      )}
      {state === "cancelled" && (
        <p data-testid="benchmark-cancelled">Cancelled. Nothing was recorded.</p>
      )}
      {state === "failed" && <p data-testid="benchmark-error">{error}</p>}

      {card && (
        <section data-testid="benchmark-card">
          <h2>Result card</h2>
          <label>
            <input
              type="checkbox"
              data-testid="benchmark-adapter-optin"
              checked={includeAdapter}
              onChange={(event) => toggleAdapter((event.currentTarget as HTMLInputElement).checked)}
            />{" "}
            Include my graphics adapter&rsquo;s vendor and architecture
          </label>
          <pre data-testid="benchmark-card-text">{formatResultCard(card)}</pre>
          <button type="button" data-testid="benchmark-copy" onClick={copy}>
            {copied ? "Copied" : "Copy card"}
          </button>
        </section>
      )}
    </div>
  );
}
