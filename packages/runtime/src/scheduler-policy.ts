/**
 * Scheduler routing policy (P7.28): job size plus backend availability decides
 * where an ensemble runs -- small on the main thread, medium across workers,
 * huge on the GPU.
 *
 * **This is the question P7.13 does not answer, and the difference is the whole
 * task.** {@link selectExecutionPlan} answers "what is the best backend this
 * machine *has*", and it answers it identically for a 4-replicate job and a
 * 4-million-replicate one, because availability is all it is given. That is
 * correct for a capability panel and wrong for a scheduler, because **dispatch
 * is not free**. A job small enough is finished on the main thread before a
 * worker has been spawned or a GPU buffer mapped, so routing it to the "best"
 * backend makes it slower. This module therefore takes a job SIZE as well, and
 * it can route *down* from what the machine offers. A policy that could only
 * route up would not be a policy; it would be `selectExecutionPlan` with extra
 * steps.
 *
 * **THE SMALL BOUNDARY IS MEASURED AND THE HUGE BOUNDARY IS DECLARED, AND THE
 * TWO ARE LABELLED DIFFERENTLY ON PURPOSE.** P0.131 is open about phase-7 tasks
 * that carry bare thresholds set before anything was measured, and it records
 * P7.03 and P7.05 as two-for-two that the shape fails. A routing policy is
 * mostly thresholds, so that failure was available here by default and the
 * defence is to say, per constant, which kind of number it is. See
 * {@link DEFAULT_SCHEDULER_THRESHOLDS}: one of the two was measured in this
 * container by `scripts/measure-dispatch-crossover.mjs` and one could not be.
 * Neither is presented as the other.
 *
 * **Every threshold is injectable, and that is not a convenience.** The
 * measured crossover is a property of a machine -- worker startup is an OS and
 * runtime cost -- so a constant baked into the module would be this container's
 * answer imposed on every caller. {@link routeEnsembleJob} takes thresholds and
 * defaults them, which is also what lets the decision table be tested at
 * boundaries chosen by the test rather than at whatever the defaults happen to
 * be today. A test that moved when a default moved would be testing the
 * default, not the policy.
 *
 * **Pure and synchronous, like `selectExecutionPlan` and for the same reasons:**
 * the whole decision table is testable without a probe, and a UI can re-render
 * a routing explanation from a stored report without re-probing anything. It
 * allocates a fresh route per call and mutates neither argument.
 *
 * **What this module does NOT do, stated because the boundary is easy to lose.**
 * It does not dispatch: it names a backend and a chunk count, and
 * `heterogeneous-executor.ts` remains the thing that runs a job. It does not
 * add a backend. And it does not claim the GPU is *faster* at any size -- it
 * claims a job is GPU-SIZED, which is a policy statement. Whether the GPU
 * actually wins there is P7.20's measurement, it needs hardware, and nothing
 * here should be read as having answered it.
 */

import {
  BACKEND_LABELS,
  CPU_BACKEND_PREFERENCE,
  type CpuCapabilities,
  type ExecutionBackendId,
  type WebGpuProbeResult,
} from "./webgpu-capability.js";

/**
 * Which band of the size axis a job fell in, before availability was consulted.
 *
 * Reported separately from the backend actually chosen, because the two come
 * apart constantly and a caller that could only see the backend could not tell
 * *why*: a `huge` job on a machine with no WebGPU and a `medium` job on the same
 * machine both run on workers, and only one of them is being served the tier it
 * asked for. {@link SchedulerRoute.demoted} is the flag for exactly that.
 */
export type JobTier = "small" | "medium" | "huge";

/**
 * The size of the job being routed.
 *
 * Replicate count is the axis, because it is the axis the crossover was
 * measured on and the axis the partition divides. Step count is deliberately
 * NOT a second dimension here: a policy with two thresholds on two axes has
 * four corners to justify and this task has evidence for one of them. If step
 * count ever needs to enter the decision, it should enter it with its own
 * measurement, not by analogy with this one.
 */
export interface EnsembleJobSize {
  readonly replicates: number;
}

/** The size boundaries between the three tiers, in replicates. */
export interface SchedulerPolicyThresholds {
  /**
   * At or above this many replicates, a job is worth dispatching to workers.
   *
   * **MEASURED**, and this is the one constant here that is.
   * `scripts/measure-dispatch-crossover.mjs` sweeps the job size with the
   * worker count fixed at four against a main-thread arm that spawns nothing,
   * with spawn cost inside the timed region. On this container's four reported
   * CPUs, workers lose by ~30x at one replicate, close the gap monotonically
   * across thirteen swept sizes with no reversal, and overtake at **2048**
   * (0.751x at 1024, 1.114x at 2048); fixed spawn cost is ~78 ms. Reproduced on
   * two independent runs with the same answer. The recorded artifact is
   * `scripts/dispatch-crossover-results.json`, with the environment it was
   * taken in.
   *
   * **It is the measured crossing rounded to the swept size, not the crossing
   * itself, and the distinction matters.** The arms cross shallowly, so the
   * true crossing is somewhere inside (1024, 2048) -- interpolating the two
   * points puts it near 1500 -- and a boundary placed exactly there would be
   * false precision about a quantity that moves with the machine. What the
   * measurement establishes is the order of magnitude and the direction; 2048
   * is the smallest swept size at which workers were observed to win, which is
   * the conservative choice of the two the data supports.
   */
  readonly workerDispatchReplicates: number;
  /**
   * At or above this many replicates, a job is GPU-sized.
   *
   * **DECLARED, NOT MEASURED, and it is labelled that way because it could not
   * be measured here.** A GPU crossover is a rate on a device, and the only
   * adapter reachable in this container is SwiftShader software --
   * `measure-gpu-workgroup-sweep.mjs`'s header is the settled reading on why a
   * rate taken there would read like an answer to a question it cannot answer.
   * So this number is a policy declaration: 65536 replicates, 32x the measured
   * worker boundary, chosen so that a job routed to the GPU is unambiguously
   * past the size where CPU parallelism has stopped being the interesting axis.
   *
   * **What would refine it**: P7.20's throughput measurement on real hardware,
   * which is that task's whole content. Until then a caller who knows their own
   * machine should pass their own number -- which is why this is a field and
   * not a `const`. If this ever acquires a measurement, this comment is the
   * thing to replace, and the word DECLARED is the thing to delete.
   */
  readonly gpuDispatchReplicates: number;
}

/**
 * The defaults: one measured number and one declared one.
 *
 * See each field's own documentation for which is which. They are exported so a
 * caller can start from them and override one, and so a test can assert their
 * relative order without restating the values.
 */
export const DEFAULT_SCHEDULER_THRESHOLDS: SchedulerPolicyThresholds = {
  workerDispatchReplicates: 2048,
  gpuDispatchReplicates: 65536,
};

/** Where a job should run, and why there and not somewhere else. */
export interface SchedulerRoute {
  /** The band the size alone put it in, before availability was consulted. */
  readonly tier: JobTier;
  /** The backend that should actually run it. Always one the machine has. */
  readonly backendId: ExecutionBackendId;
  /** {@link BACKEND_LABELS}, kept beside the id so a panel retypes nothing. */
  readonly label: string;
  readonly kind: "gpu" | "cpu";
  /**
   * How many contiguous chunks to split the job into -- the value a caller
   * passes as `HeterogeneousExecutorOptions.chunks`.
   *
   * **1 for the small tier, and that is the tier's entire content**: one chunk
   * is a job that runs where it was called, with nothing spawned. 1 for the GPU
   * too, which is one device.
   */
  readonly parallelism: number;
  /**
   * True when availability forced a tier lower than the size asked for -- a
   * `huge` job on a machine with no WebGPU, or a `medium` one on a single core.
   *
   * Separate from `tier` because a caller that wants to say "this would be
   * faster on a machine with a GPU" needs to know the difference, and a caller
   * that merely wants to dispatch does not.
   */
  readonly demoted: boolean;
  /** Prose for a panel: which tier, and why this backend serves it. */
  readonly reason: string;
  /** The thresholds this decision was made against, echoed so a report is self-contained. */
  readonly thresholds: SchedulerPolicyThresholds;
}

/**
 * The tier a size alone implies, before any machine is consulted.
 *
 * Exported because it is worth being able to ask "how big is this job" without
 * having a capability report to hand, and because testing the size axis
 * separately from the availability axis is what keeps the decision table from
 * needing every combination of both.
 *
 * **Boundaries are inclusive at the bottom** (`>=`), so a job of exactly
 * `workerDispatchReplicates` is `medium`. Stated because a boundary convention
 * left implicit is the thing an off-by-one hides in, and `scheduler-policy.test.ts`
 * asserts both sides of each one.
 *
 * **Nothing here throws.** A non-finite or negative replicate count is `small`:
 * routing is not validation, `validateEnsembleJob` is, and a policy that threw
 * would turn a bad job spec into a crash in the scheduler rather than a
 * rejection at the executor where it belongs. `small` is also the safe answer --
 * it spawns nothing.
 */
export function classifyJobSize(
  size: EnsembleJobSize,
  thresholds: SchedulerPolicyThresholds = DEFAULT_SCHEDULER_THRESHOLDS,
): JobTier {
  const replicates = Number.isFinite(size.replicates) ? size.replicates : 0;
  if (replicates >= thresholds.gpuDispatchReplicates) return "huge";
  if (replicates >= thresholds.workerDispatchReplicates) return "medium";
  return "small";
}

/** The best CPU backend this bundle can actually reach, with `"ts"` as the floor. */
function bestAvailableCpuBackend(cpu: CpuCapabilities): ExecutionBackendId {
  return (
    CPU_BACKEND_PREFERENCE.find((id) => cpu.available.includes(id)) ??
    ("ts" satisfies ExecutionBackendId)
  );
}

/**
 * Route one job: its size, and what this machine turned out to offer.
 *
 * The decision is two steps, and they are separate because they answer to
 * different things. First {@link classifyJobSize} reads the size axis alone.
 * Then availability can only ever lower that tier -- a machine cannot make a
 * 10-replicate job worth a GPU dispatch, but a missing GPU certainly makes a
 * 10-million-replicate job run on workers. Every demotion sets `demoted` and
 * says in `reason` what was missing.
 *
 * **The blueprint's "small -> main TS" is instantiated as "main thread, best
 * reachable CPU backend", and the difference is deliberate.** In a browser
 * those are the same sentence, because `BROWSER_CPU_BACKENDS` is exactly
 * `["ts"]` (P0.133: `@ballista/wasm-core` reads its artifact through
 * `node:fs/promises`). Naming `"ts"` unconditionally would hard-code that
 * browser limitation into a Node caller's routing, telling a process that CAN
 * reach the SIMD kernel to use the reference stepper instead -- the mirror
 * image of the false-fallback mistake `BROWSER_CPU_BACKENDS` exists to prevent.
 * What the small tier fixes is the PARALLELISM (one chunk, nothing spawned),
 * which is what the measurement was about; which CPU backend runs that chunk is
 * an availability question and is answered the same way everywhere else.
 */
export function routeEnsembleJob(
  size: EnsembleJobSize,
  capability: { readonly webgpu: WebGpuProbeResult; readonly cpu: CpuCapabilities },
  thresholds: SchedulerPolicyThresholds = DEFAULT_SCHEDULER_THRESHOLDS,
): SchedulerRoute {
  const tier = classifyJobSize(size, thresholds);
  const cores = Math.max(1, Math.trunc(capability.cpu.hardwareConcurrency) || 1);
  const cpuBackend = bestAvailableCpuBackend(capability.cpu);

  const onMainThread = (reason: string, demoted: boolean): SchedulerRoute => ({
    tier,
    backendId: cpuBackend,
    label: BACKEND_LABELS[cpuBackend],
    kind: "cpu",
    parallelism: 1,
    demoted,
    reason,
    thresholds,
  });

  if (tier === "huge") {
    if (capability.webgpu.supported) {
      return {
        tier,
        backendId: "webgpu",
        label: BACKEND_LABELS.webgpu,
        kind: "gpu",
        parallelism: 1,
        demoted: false,
        reason: `${size.replicates} replicates is at or above the ${thresholds.gpuDispatchReplicates}-replicate GPU boundary, and a WebGPU device was obtained.`,
        thresholds,
      };
    }
    // Demoted, not failed. The size still says GPU; the machine has none.
    if (cores > 1) {
      return {
        tier,
        backendId: cpuBackend,
        label: BACKEND_LABELS[cpuBackend],
        kind: "cpu",
        parallelism: cores,
        demoted: true,
        reason: `${size.replicates} replicates is GPU-sized, but WebGPU is unavailable (${capability.webgpu.reason}), so it runs across ${cores} workers instead.`,
        thresholds,
      };
    }
    return onMainThread(
      `${size.replicates} replicates is GPU-sized, but WebGPU is unavailable (${capability.webgpu.reason}) and only one core is reported, so it runs on the main thread. This will be slow; it is the only correct option this machine offers.`,
      true,
    );
  }

  if (tier === "medium") {
    if (cores > 1) {
      return {
        tier,
        backendId: cpuBackend,
        label: BACKEND_LABELS[cpuBackend],
        kind: "cpu",
        parallelism: cores,
        demoted: false,
        reason: `${size.replicates} replicates is at or above the ${thresholds.workerDispatchReplicates}-replicate worker boundary, so dispatch across ${cores} workers pays for itself.`,
        thresholds,
      };
    }
    return onMainThread(
      `${size.replicates} replicates would be worth dispatching, but only one core is reported, so workers would add spawn cost and no parallelism.`,
      true,
    );
  }

  return onMainThread(
    `${size.replicates} replicates is below the ${thresholds.workerDispatchReplicates}-replicate worker boundary, so it runs where it was called -- dispatch would cost more than the work.`,
    false,
  );
}
