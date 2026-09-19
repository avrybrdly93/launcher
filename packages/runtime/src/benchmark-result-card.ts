/**
 * The result card a user gets from the public benchmark page (P7.32): what a
 * card *is*, what may appear on one, and how it renders as shareable text.
 *
 * **This module is the definition and the route is the mechanism**, the same
 * line `batch-throughput.ts` already draws against
 * `scripts/measure-batch-throughput.mjs`. Everything here is pure: no DOM, no
 * clock, no `navigator`. The route measures and supplies; this module decides
 * what the measurement is allowed to say and what of the machine may travel
 * with it. That split is what lets the privacy and honesty properties be
 * asserted by a unit test rather than driven through a browser.
 *
 * **Why the verdict is withheld rather than computed.** §2.6's budget is
 * stated at {@link THROUGHPUT_WORKERS} workers. A page that ran one thread and
 * printed "budget missed" would be reporting a different configuration's
 * failure as this one's -- the number would be real and the verdict would be
 * about a benchmark nobody ran. So {@link budgetVerdict} returns
 * `"not-applicable"` for any configuration that is not §2.6's, and the card
 * says so in those words. Defaulting it to a miss is the easy wrong answer
 * here, and it is wrong in the direction that looks rigorous.
 *
 * **Why anonymisation is an allowlist.** {@link ANONYMISED_ADAPTER_FIELDS}
 * names the fields that may leave the machine; everything else is dropped
 * whether or not anyone thought of it. A denylist protects against the fields
 * its author remembered, which is the wrong guarantee for a capability report
 * that other tasks keep adding to -- see `webgpu-capability.ts`, whose
 * `GpuAdapterInfoLike` already carries a `device` string that no card should
 * ever repeat.
 *
 * **Nothing here transmits anything.** A card is text the user reads and then
 * chooses to paste. "Opt-in reporting" is the opt-in
 * ({@link ResultCardOptions.includeAdapter}, off by default) plus the copy
 * button; there is no endpoint, and adding one is not this task's to invent.
 */

import {
  ACCURACY_CEILING,
  THROUGHPUT_BUDGET_TRAJECTORIES_PER_SECOND,
  THROUGHPUT_WORKERS,
  type LadderRung,
} from "./batch-throughput.js";
import type { ComputeCapabilityReport, GpuAdapterInfoLike } from "./webgpu-capability.js";

/**
 * The adapter fields a card may carry, and the only ones.
 *
 * `vendor` and `architecture` are the two the WebGPU spec itself designates
 * as the coarse, low-entropy pair -- "amd"/"rdna3" -- and they are what makes
 * a shared number interpretable at all. `device` and `description` are
 * deliberately absent: both are free-form strings a driver may fill with a
 * precise model, a board id or a build string, which is exactly the entropy a
 * user opting in to "anonymized adapter reporting" is agreeing *not* to send.
 *
 * `benchmark-result-card.test.ts` asserts that an adapter carrying unknown
 * extra fields contributes none of them, so a later addition to
 * `GpuAdapterInfoLike` cannot leak by default.
 */
export const ANONYMISED_ADAPTER_FIELDS = ["vendor", "architecture"] as const;

/** An adapter descriptor reduced to {@link ANONYMISED_ADAPTER_FIELDS}. */
export interface AnonymisedAdapter {
  readonly vendor: string | null;
  readonly architecture: string | null;
}

/**
 * Whether a card's throughput figure can be read against §2.6's budget.
 *
 * - `"meets"` / `"misses"` -- the run *was* §2.6's configuration and the
 *   comparison is meaningful.
 * - `"not-applicable"` -- it was not, so there is no verdict to give. The card
 *   prints the reason rather than a number dressed as a result.
 */
export type BudgetVerdict = "meets" | "misses" | "not-applicable";

/**
 * Reads §2.6's verdict, or declines to.
 *
 * `workers` is the whole question: the budget is a statement about four
 * workers, so any other count -- including the single main thread a browser
 * page runs on -- leaves it unanswered. Accuracy matters too: a rung outside
 * {@link ACCURACY_CEILING} is fast because it is wrong, and the benchmark's
 * own `verdictRung` already refuses to read a verdict from one.
 */
export function budgetVerdict(rung: LadderRung, workers: number): BudgetVerdict {
  if (workers !== THROUGHPUT_WORKERS) return "not-applicable";
  if (rung.relativeRangeError > ACCURACY_CEILING) return "not-applicable";
  return rung.trajectoriesPerSecond >= THROUGHPUT_BUDGET_TRAJECTORIES_PER_SECOND
    ? "meets"
    : "misses";
}

/** Why a verdict was withheld, in prose for the card. `null` when one was given. */
export function verdictWithheldReason(rung: LadderRung, workers: number): string | null {
  if (workers !== THROUGHPUT_WORKERS) {
    return (
      `measured on ${workers} thread${workers === 1 ? "" : "s"}, not the ` +
      `${THROUGHPUT_WORKERS} the §2.6 budget is stated at`
    );
  }
  if (rung.relativeRangeError > ACCURACY_CEILING) {
    return `no ladder rung reached the ${ACCURACY_CEILING} accuracy the verdict requires`;
  }
  return null;
}

/** Caller-controlled choices about what a card carries. */
export interface ResultCardOptions {
  /**
   * Include {@link ANONYMISED_ADAPTER_FIELDS} from the capability report.
   *
   * **Off by default, and the default is the opt-in.** A caller that passes no
   * options gets a card with no adapter fields at all;
   * `benchmark-result-card.test.ts` asserts that directly rather than leaving
   * it to whatever initial state a checkbox happens to have.
   */
  readonly includeAdapter?: boolean;
}

/** A completed card: the measurement, its configuration, and its caveats. */
export interface ResultCard {
  /** The coarsest accurate rung's rate, in full trajectories per second. */
  readonly trajectoriesPerSecond: number;
  readonly stepSize: number;
  readonly replicates: number;
  readonly workers: number;
  readonly relativeRangeError: number;
  readonly elapsedSeconds: number;
  /** Which backend actually ran, from the capability report's execution plan. */
  readonly backendLabel: string;
  readonly verdict: BudgetVerdict;
  /** Prose for a withheld verdict; `null` when {@link verdict} is a real one. */
  readonly verdictWithheld: string | null;
  /** Present only when the user opted in. `null` otherwise -- never omitted, so a reader can tell. */
  readonly adapter: AnonymisedAdapter | null;
}

/**
 * Reduces an adapter descriptor to the allowlisted fields.
 *
 * A field the adapter did not report becomes `null` rather than being dropped,
 * so a card always has the same shape and a blank adapter -- which Firefox and
 * Safari deliberately produce -- reads as "not reported" instead of as a
 * missing line.
 */
export function anonymiseAdapter(info: GpuAdapterInfoLike): AnonymisedAdapter {
  const read = (key: (typeof ANONYMISED_ADAPTER_FIELDS)[number]): string | null => {
    const value = info[key];
    return typeof value === "string" && value !== "" ? value : null;
  };
  return { vendor: read("vendor"), architecture: read("architecture") };
}

/**
 * Builds the card for a measured rung.
 *
 * `rung` is the benchmark's own verdict rung -- the coarsest step inside the
 * accuracy ceiling -- and not the fastest one measured. Handing this function
 * the fastest rung would produce a bigger number describing a wrong answer,
 * which is what `verdictRung` exists to prevent.
 */
export function buildResultCard(
  rung: LadderRung,
  capability: ComputeCapabilityReport,
  options: ResultCardOptions = {},
): ResultCard {
  const includeAdapter = options.includeAdapter === true;
  const adapter =
    includeAdapter && capability.webgpu.supported
      ? anonymiseAdapter(capability.webgpu.adapter)
      : includeAdapter
        ? { vendor: null, architecture: null }
        : null;

  return {
    trajectoriesPerSecond: rung.trajectoriesPerSecond,
    stepSize: rung.stepSize,
    replicates: rung.replicates,
    workers: rung.workers,
    relativeRangeError: rung.relativeRangeError,
    elapsedSeconds: rung.elapsedSeconds,
    backendLabel: capability.plan.label,
    verdict: budgetVerdict(rung, rung.workers),
    verdictWithheld: verdictWithheldReason(rung, rung.workers),
    adapter,
  };
}

/** Three significant figures, for a rate nobody should read more precisely than that. */
function formatRate(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/**
 * Renders a card as the plain text the copy button puts on the clipboard.
 *
 * Plain text rather than JSON because the point is that a user can read what
 * they are about to paste. A card whose privacy properties can only be checked
 * by parsing it is not meaningfully opt-in.
 *
 * The caveat lines are not optional and are not a footer to be trimmed: a rate
 * shared without its replicate count, its thread count and its provenance is
 * the thing this task would otherwise be adding to the internet.
 */
export function formatResultCard(card: ResultCard): string {
  const lines = [
    "Ballista batch-throughput benchmark — result card",
    `Throughput:  ${formatRate(card.trajectoriesPerSecond)} trajectories/s`,
    `Backend:     ${card.backendLabel}`,
    `Config:      ${card.replicates} replicates, ${card.workers} thread${
      card.workers === 1 ? "" : "s"
    }, RK4 at h=${card.stepSize}`,
    `Accuracy:    relative range error ${card.relativeRangeError.toExponential(2)} ` +
      `(ceiling ${ACCURACY_CEILING})`,
    `Elapsed:     ${card.elapsedSeconds.toFixed(3)} s`,
  ];

  if (card.verdict === "not-applicable") {
    lines.push(
      `§2.6 budget: not assessed — ${card.verdictWithheld ?? "configuration does not match"}`,
    );
  } else {
    lines.push(
      `§2.6 budget: ${card.verdict === "meets" ? "met" : "missed"} ` +
        `(${formatRate(THROUGHPUT_BUDGET_TRAJECTORIES_PER_SECOND)} traj/s at ` +
        `${THROUGHPUT_WORKERS} workers)`,
    );
  }

  if (card.adapter) {
    lines.push(
      `Adapter:     vendor ${card.adapter.vendor ?? "not reported"}, ` +
        `architecture ${card.adapter.architecture ?? "not reported"}`,
    );
  } else {
    lines.push("Adapter:     not included (opt-in)");
  }

  lines.push(
    "Measured on this machine by whoever ran it. Not a published figure of the " +
      "project's, and not comparable to a run at a different replicate or thread count.",
  );
  return lines.join("\n");
}
