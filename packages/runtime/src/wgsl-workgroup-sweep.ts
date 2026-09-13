/**
 * P7.15's workgroup-size sweep: which sizes to try on a given device, and how
 * to decide whether the fastest one actually won.
 *
 * Everything here is pure. No WebGPU type appears, no device is touched, and
 * the timings arrive as plain numbers — the same separation
 * `wgsl-rk4-dispatch.ts` makes by injecting a structural device, and for the
 * same reason: the decisions worth getting right are decisions about numbers,
 * and a decision about numbers should not need a GPU to test.
 *
 * ## What this file is careful about, and why
 *
 * A workgroup sweep is a benchmark, and a benchmark's characteristic failure is
 * not producing a wrong number — it is producing a real number and attaching a
 * conclusion the number does not support. Three guards, in the order they bite:
 *
 *   1. **Candidates are filtered against the device's own limits**, not against
 *      a constant. A size above `maxComputeWorkgroupSizeX` or
 *      `maxComputeInvocationsPerWorkgroup` fails pipeline creation, and a sweep
 *      that hard-errors partway through has measured nothing.
 *   2. **The statistic is the median**, not the mean. One scheduler hiccup in a
 *      handful of repeats moves a mean by more than the effect being measured.
 *   3. **"Fastest" and "won" are different claims, and only one of them is
 *      reported as a winner.** See {@link summariseWorkgroupSweep}.
 */

import { WGSL_MAX_PORTABLE_WORKGROUP_SIZE } from "./wgsl-rk4-kernel.js";

/**
 * The two device limits that bound a workgroup size along x.
 *
 * A structural type rather than `GPUSupportedLimits`, for the reason
 * `wgsl-rk4-dispatch.ts` gives for `GpuComputeDeviceLike`: `@webgpu/types`
 * would be a dependency for two of its members, and a caller reading limits off
 * a real device satisfies this shape without conversion.
 */
export interface WorkgroupLimitsLike {
  /** Largest `@workgroup_size` first component the device accepts. */
  readonly maxComputeWorkgroupSizeX: number;
  /** Largest total invocations per workgroup the device accepts. */
  readonly maxComputeInvocationsPerWorkgroup: number;
}

/**
 * The sizes a sweep tries unless told otherwise.
 *
 * Powers of two from 1 to the portable ceiling. Powers of two because subgroup
 * widths in current use are 32 and 64 and a non-multiple wastes lanes on one or
 * both; 1 is included deliberately even though it is certain to be bad, because
 * a sweep whose candidates are all plausible cannot show that the sweep is
 * measuring anything at all. If 1 does not come last in the ranking, the
 * harness is not measuring occupancy.
 */
export const DEFAULT_WORKGROUP_CANDIDATES: readonly number[] = [1, 8, 16, 32, 64, 128, 256];

/**
 * The candidate sizes runnable on a device with these limits, ascending.
 *
 * Filters rather than throws on an out-of-range candidate: a sweep's candidate
 * list is a wish, and a device that cannot honour part of it should yield a
 * shorter sweep and not a failed one.
 *
 * @throws RangeError if either limit is not a positive integer, or if no
 *   candidate survives. The second is not a device quirk to tolerate — every
 *   conformant device accepts at least 256, so an empty result means the limits
 *   were read from the wrong place.
 */
export function planWorkgroupSweep(
  limits: WorkgroupLimitsLike,
  candidates: readonly number[] = DEFAULT_WORKGROUP_CANDIDATES,
): number[] {
  const { maxComputeWorkgroupSizeX, maxComputeInvocationsPerWorkgroup } = limits;
  for (const [name, value] of [
    ["maxComputeWorkgroupSizeX", maxComputeWorkgroupSizeX],
    ["maxComputeInvocationsPerWorkgroup", maxComputeInvocationsPerWorkgroup],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive integer, got ${value}`);
    }
  }
  const ceiling = Math.min(maxComputeWorkgroupSizeX, maxComputeInvocationsPerWorkgroup);

  const kept = [...new Set(candidates)]
    .filter((size) => Number.isInteger(size) && size > 0 && size <= ceiling)
    .sort((a, b) => a - b);

  if (kept.length === 0) {
    throw new RangeError(
      `no candidate workgroup size is within the device ceiling of ${ceiling}; every conformant device accepts ${WGSL_MAX_PORTABLE_WORKGROUP_SIZE}, so these limits are probably not the device's`,
    );
  }
  return kept;
}

/** One size's repeated timings. */
export interface WorkgroupSample {
  readonly workgroupSize: number;
  /** Wall-clock milliseconds, one per repeat, warm-up already discarded. */
  readonly timingsMs: readonly number[];
}

/** One size's place in the ranking. */
export interface WorkgroupRanking {
  readonly workgroupSize: number;
  readonly medianMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly repeats: number;
}

/** The outcome of a sweep, with its own significance stated. */
export interface WorkgroupSweepSummary {
  /** Every size, fastest median first. */
  readonly rankings: readonly WorkgroupRanking[];
  /** The size with the lowest median. Always defined when there is a sample. */
  readonly fastestWorkgroupSize: number;
  /** The next-lowest median, or `null` when only one size was measured. */
  readonly runnerUpWorkgroupSize: number | null;
  /** `runnerUp.medianMs - fastest.medianMs`; `null` with one size. */
  readonly separationMs: number | null;
  /**
   * Whether **every** timing at the fastest size beat **every** timing at the
   * runner-up. `null` with one size.
   */
  readonly separated: boolean | null;
  /**
   * The size this sweep is willing to call best, or `null`.
   *
   * `null` whenever {@link separated} is not `true` — see the function's note.
   */
  readonly bestWorkgroupSize: number | null;
}

function median(sorted: readonly number[]): number {
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/**
 * Ranks the samples and decides whether the fastest one won.
 *
 * ## "Fastest" is not "best", and the difference is the whole point
 *
 * Some size always has the lowest median; that is arithmetic, not a finding. A
 * sweep reports a *best* size only when the fastest size's slowest repeat still
 * beat the runner-up's fastest repeat — that is, when the two samples do not
 * overlap at all.
 *
 * That criterion is non-parametric and needs no assumption about the timing
 * distribution, which matters because wall-clock timings on a shared machine
 * are not normal and are not even symmetric: they have a hard floor and a long
 * right tail. It is deliberately strict. A sweep that cannot separate its top
 * two sizes has found that the choice does not matter at that resolution, and
 * that is a real result worth recording as itself rather than resolving into a
 * winner by rounding.
 *
 * {@link WorkgroupSweepSummary.fastestWorkgroupSize} is always populated so a
 * caller can report the ordering; {@link WorkgroupSweepSummary.bestWorkgroupSize}
 * is `null` unless the separation holds. A results file should record the
 * second, and say when it is null.
 *
 * @throws RangeError on an empty sample set, a sample with no timings, a
 *   duplicated size, or a non-finite timing. Each of those would otherwise
 *   produce a ranking that looks like a measurement.
 */
export function summariseWorkgroupSweep(
  samples: readonly WorkgroupSample[],
): WorkgroupSweepSummary {
  if (samples.length === 0) {
    throw new RangeError("a sweep summary needs at least one sample");
  }
  const seen = new Set<number>();
  for (const sample of samples) {
    if (!Number.isInteger(sample.workgroupSize) || sample.workgroupSize <= 0) {
      throw new RangeError(
        `workgroup size must be a positive integer, got ${sample.workgroupSize}`,
      );
    }
    if (seen.has(sample.workgroupSize)) {
      throw new RangeError(`workgroup size ${sample.workgroupSize} appears twice`);
    }
    seen.add(sample.workgroupSize);
    if (sample.timingsMs.length === 0) {
      throw new RangeError(`workgroup size ${sample.workgroupSize} has no timings`);
    }
    for (const timing of sample.timingsMs) {
      if (!Number.isFinite(timing) || timing < 0) {
        throw new RangeError(
          `workgroup size ${sample.workgroupSize} has a non-finite or negative timing: ${timing}`,
        );
      }
    }
  }

  const rankings: WorkgroupRanking[] = samples
    .map((sample) => {
      const sorted = [...sample.timingsMs].sort((a, b) => a - b);
      return {
        workgroupSize: sample.workgroupSize,
        medianMs: median(sorted),
        minMs: sorted[0] as number,
        maxMs: sorted[sorted.length - 1] as number,
        repeats: sorted.length,
      };
    })
    // Ties broken by the smaller size, so the ordering is total and a rerun
    // that ties does not reorder the report.
    .sort((a, b) => a.medianMs - b.medianMs || a.workgroupSize - b.workgroupSize);

  const fastest = rankings[0] as WorkgroupRanking;
  const runnerUp = rankings.length > 1 ? (rankings[1] as WorkgroupRanking) : null;
  if (runnerUp === null) {
    return {
      rankings,
      fastestWorkgroupSize: fastest.workgroupSize,
      runnerUpWorkgroupSize: null,
      separationMs: null,
      separated: null,
      bestWorkgroupSize: null,
    };
  }

  const separated = fastest.maxMs < runnerUp.minMs;
  return {
    rankings,
    fastestWorkgroupSize: fastest.workgroupSize,
    runnerUpWorkgroupSize: runnerUp.workgroupSize,
    separationMs: runnerUp.medianMs - fastest.medianMs,
    separated,
    bestWorkgroupSize: separated ? fastest.workgroupSize : null,
  };
}

/** The classes a results file may key a row by. */
export const ADAPTER_CLASSES = ["software", "hardware"] as const;

/** One of {@link ADAPTER_CLASSES}. */
export type AdapterClass = (typeof ADAPTER_CLASSES)[number];

/** As much of a `GPUAdapterInfo` as the class can be derived from. */
export interface AdapterInfoLike {
  readonly vendor?: string | undefined;
  readonly architecture?: string | undefined;
  readonly description?: string | undefined;
  readonly isFallbackAdapter?: boolean | null | undefined;
}

/**
 * Known software renderers, matched against `architecture` and `description`.
 *
 * Lowercase, substring-matched. SwiftShader is what Chromium ships and is the
 * one reachable in this project's container; lavapipe and llvmpipe are Mesa's,
 * which a Linux CI runner without a GPU may present instead; WARP is Windows'.
 */
const SOFTWARE_MARKERS = ["swiftshader", "lavapipe", "llvmpipe", "warp", "software"];

/**
 * Classifies an adapter, **erring towards `software`**.
 *
 * ## The asymmetry is deliberate and is the point of the function
 *
 * The two misclassifications do not cost the same. Labelling a software adapter
 * `hardware` puts a CPU emulation's occupancy curve into the record as evidence
 * about a GPU, which is the exact failure P7.15's criterion had to be read
 * carefully to avoid. Labelling a hardware adapter `software` understates a
 * real result and someone corrects it. So an adapter is `hardware` only when it
 * is not a fallback adapter *and* nothing in its strings says otherwise, and an
 * adapter that reports nothing at all is `software`.
 *
 * An adapter with empty strings and `isFallbackAdapter` unset is exactly what
 * Chromium returns for its SwiftShader adapter with masking on — see
 * `gpu-rk4-agreement-results.json`, whose recorded adapter has
 * `isFallbackAdapter: null` — so the unknown case is not hypothetical.
 */
export function classifyAdapter(info: AdapterInfoLike): AdapterClass {
  if (info.isFallbackAdapter === true) {
    return "software";
  }
  const haystack = [info.vendor, info.architecture, info.description]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();
  if (SOFTWARE_MARKERS.some((marker) => haystack.includes(marker))) {
    return "software";
  }
  // Nothing said hardware; nothing may be read as hardware.
  return haystack.trim() === "" ? "software" : "hardware";
}
