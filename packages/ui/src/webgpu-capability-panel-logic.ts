/**
 * Non-rendering logic for the compute-capability panel (P7.13), split out for
 * the same reason `forces-panel-logic.ts` and `model-picker-logic.ts` are: the
 * part this task is actually validated on -- what a user is *told* when their
 * browser has no WebGPU -- is then testable without a DOM.
 *
 * **The prose lives here rather than in the `.tsx`, and that is the point.**
 * The validation criterion is "unsupported browsers get graceful CPU path", and
 * "graceful" is a property of the sentence the user reads, not of the control
 * flow that produced it. Putting those sentences in a module makes them
 * assertable: `webgpu-capability-panel-logic.test.ts` checks that every one of
 * the four {@link WebGpuUnsupportedReason}s has an explanation, that none of
 * them is a dead end, and that each says what to do about it -- or says plainly
 * that there is nothing to do, which is also an answer.
 *
 * Nothing here restates a fact `@ballista/runtime` already owns. Backend labels
 * come from `BACKEND_LABELS`, the plan's `reason` comes from
 * `selectExecutionPlan`, and the limit keys come from `REPORTED_WEBGPU_LIMITS`.
 * A second copy of any of those would rot silently the first time the runtime's
 * changed and the panel's did not.
 */

import {
  REPORTED_WEBGPU_LIMITS,
  type ComputeCapabilityReport,
  type WebGpuLimitsSummary,
  type WebGpuUnsupportedReason,
} from "@ballista/runtime";

/** One line of the "why not, and what now" table. */
export interface UnsupportedExplanation {
  /** What happened, in a user's terms rather than the spec's. */
  readonly summary: string;
  /**
   * What, if anything, would change the answer. **"Nothing" is a permitted and
   * honest value** -- telling a Safari user to update their driver would be
   * worse than telling them their browser does not implement WebGPU.
   */
  readonly remedy: string;
}

/**
 * Why WebGPU is unavailable and what the user can do, one entry per reason.
 *
 * Keyed by the runtime's own union, so adding a reason there without a sentence
 * here is a type error rather than a blank cell on screen.
 */
export const UNSUPPORTED_EXPLANATIONS: Readonly<
  Record<WebGpuUnsupportedReason, UnsupportedExplanation>
> = {
  "no-navigator-gpu": {
    summary: "This browser does not implement WebGPU at all.",
    remedy:
      "A current Chromium-based browser (Chrome or Edge 113+) implements it; Firefox and Safari " +
      "are shipping it progressively. Nothing about this machine's hardware changes this answer.",
  },
  "no-adapter": {
    summary:
      "The browser implements WebGPU but offered no adapter for this machine's graphics hardware.",
    remedy:
      "This is the specification's documented way of saying 'not on this hardware' — commonly a " +
      "blocklisted or outdated graphics driver, a software-rendered or headless context, or a GPU " +
      "the browser declines to expose. A driver update may change it.",
  },
  "adapter-request-failed": {
    summary: "Requesting a WebGPU adapter raised an error.",
    remedy:
      "This is not an outcome the specification describes, so it most likely indicates a browser " +
      "or driver bug rather than a limitation of this machine. The simulation is unaffected — it " +
      "runs on the CPU path below.",
  },
  "device-request-failed": {
    summary: "A WebGPU adapter exists, but a device could not be created on it.",
    remedy:
      "The GPU is present and currently unusable — typically the device was lost, or another " +
      "application holds an exclusive context. Reloading the page often resolves it.",
  },
};

/** Every reason the panel knows how to explain, in the order the docs list them. */
export const EXPLAINED_REASONS = Object.keys(
  UNSUPPORTED_EXPLANATIONS,
) as readonly WebGpuUnsupportedReason[];

/** A limit as the panel shows it: the key, a human label, and a formatted value. */
export interface LimitRow {
  readonly key: keyof WebGpuLimitsSummary;
  readonly label: string;
  readonly value: string;
}

const LIMIT_LABELS: Readonly<Record<keyof WebGpuLimitsSummary, string>> = {
  maxComputeWorkgroupSizeX: "Max workgroup size (X)",
  maxComputeInvocationsPerWorkgroup: "Max invocations per workgroup",
  maxComputeWorkgroupsPerDimension: "Max workgroups per dimension",
  maxStorageBufferBindingSize: "Max storage buffer binding",
  maxBufferSize: "Max buffer size",
};

/** The two limits measured in bytes, which are shown as MiB rather than as ten digits. */
const BYTE_LIMITS: ReadonlySet<keyof WebGpuLimitsSummary> = new Set([
  "maxStorageBufferBindingSize",
  "maxBufferSize",
]);

/**
 * Format one limit for display.
 *
 * A limit the adapter did not report shows as an em dash, never as `0` or
 * `null` — an unreported limit and a limit of zero are different claims, and
 * only one of them would be alarming.
 */
export function formatLimit(key: keyof WebGpuLimitsSummary, value: number | null): string {
  if (value === null) {
    return "—";
  }
  if (BYTE_LIMITS.has(key)) {
    const mib = value / (1024 * 1024);
    // One decimal place only below 10 MiB, where the fraction carries
    // information; above it the integer is what a reader compares.
    return `${mib >= 10 ? Math.round(mib).toString() : mib.toFixed(1)} MiB`;
  }
  return value.toLocaleString("en-US");
}

/** The limit rows, in {@link REPORTED_WEBGPU_LIMITS} order, ready to render. */
export function limitRows(limits: WebGpuLimitsSummary): readonly LimitRow[] {
  return REPORTED_WEBGPU_LIMITS.map((key) => ({
    key,
    label: LIMIT_LABELS[key],
    value: formatLimit(key, limits[key]),
  }));
}

/**
 * The adapter's identifying string, or an honest statement that it has none.
 *
 * Firefox and Safari blank every field as a fingerprinting defence, so an empty
 * adapter is normal. Saying "not reported" is accurate; leaving the line blank
 * would read as a rendering bug.
 */
export function describeAdapter(adapter: {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
}): string {
  const parts = [adapter.vendor, adapter.architecture, adapter.device, adapter.description]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "");
  return parts.length === 0 ? "Not reported by this browser" : parts.join(" · ");
}

/**
 * The one-line headline: what is running, said first.
 *
 * A capability panel whose first line is a negative ("WebGPU: unsupported")
 * makes the reader hunt for the part that matters. This states the outcome.
 *
 * **The worker count is deliberately not in here**, though `plan.parallelism`
 * carries it. "TypeScript reference stepper × 8 workers" reads as a statement
 * about what the page in front of you is doing, and that would be false on the
 * Monte Carlo route, which runs on the UI thread until P6.25 moves it. Capacity
 * and current use are different claims; {@link describeParallelism} states the
 * one this module can actually stand behind.
 */
export function headlineFor(report: ComputeCapabilityReport): string {
  return `Running on: ${report.plan.label}`;
}

/**
 * The machine's worker capacity, phrased as capacity.
 *
 * Reads `navigator.hardwareConcurrency`, which is what the browser is willing
 * to report about the machine -- not a measurement of what any particular view
 * currently dispatches. P7.12 measured this repository's ensemble path at 3.08x
 * on four such threads, which is the closest thing to a throughput claim that
 * belongs on screen.
 */
export function describeParallelism(report: ComputeCapabilityReport): string {
  const n = report.plan.parallelism;
  return n <= 1
    ? "1 thread reported by this browser"
    : `up to ${n} worker threads reported by this browser`;
}
