/**
 * P7.28's validation criterion: "policy unit tests; end-to-end picks expected
 * backend".
 *
 * **Two clauses, and they are asserted in separate blocks because either can
 * pass while the other fails.** A decision table can be perfectly consistent
 * with itself and name a backend the executor cannot be configured with; an
 * end-to-end run can pick a backend and be driven by a table with an
 * off-by-one at every boundary. Collapsing them into one "the policy works"
 * block would hide exactly that.
 *
 * **NO WALL-CLOCK ASSERTION APPEARS HERE, AND THAT IS THE CONVENTION RATHER
 * THAN AN OMISSION.** `worker-scaling-decision.test.ts` states it: a timing
 * assertion inside `pnpm test` is a flake, and this repository's perf checks
 * all live in scripts that soft-warn for that reason. The measurement that
 * grounds {@link DEFAULT_SCHEDULER_THRESHOLDS}'s worker boundary lives in
 * `scripts/measure-dispatch-crossover.mjs` with the environment it was taken
 * in. What IS asserted about it here is a property of the *artifact* -- that
 * the committed crossover measurement still supports the constant the policy
 * ships -- which is a fact about two files and not about this machine.
 *
 * **Most cases pass explicit thresholds rather than the defaults.** A test
 * written against `DEFAULT_SCHEDULER_THRESHOLDS`'s values would go red when a
 * default moved for a good reason, which makes it a test of the default rather
 * than of the policy. The defaults get their own small block, and everything
 * else states the boundary it is probing.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCHEDULER_THRESHOLDS,
  classifyJobSize,
  routeEnsembleJob,
  type SchedulerPolicyThresholds,
} from "./scheduler-policy.js";
import {
  BROWSER_CPU_BACKENDS,
  NODE_CPU_BACKENDS,
  type CpuCapabilities,
  type WebGpuProbeResult,
} from "./webgpu-capability.js";
import {
  createHeterogeneousExecutor,
  createTsEnsembleBackend,
  type EnsembleBackend,
} from "./heterogeneous-executor.js";
import {
  ENSEMBLE_OBS_COUNT,
  type EnsembleJobSpec,
  type EnsembleReplicate,
} from "./ensemble-job.js";

/** Round numbers, unrelated to the shipped defaults. See the header. */
const T: SchedulerPolicyThresholds = {
  workerDispatchReplicates: 100,
  gpuDispatchReplicates: 10_000,
};

const GPU_YES: WebGpuProbeResult = {
  supported: true,
  reason: null,
  adapter: { vendor: "test" },
  features: [],
  limits: {
    maxComputeWorkgroupSizeX: 256,
    maxComputeInvocationsPerWorkgroup: 256,
    maxComputeWorkgroupsPerDimension: 65535,
    maxStorageBufferBindingSize: null,
    maxBufferSize: null,
  },
};

const GPU_NO: WebGpuProbeResult = { supported: false, reason: "no-navigator-gpu", error: null };

const fourCores: CpuCapabilities = { available: NODE_CPU_BACKENDS, hardwareConcurrency: 4 };
const oneCore: CpuCapabilities = { available: NODE_CPU_BACKENDS, hardwareConcurrency: 1 };
const browserFourCores: CpuCapabilities = {
  available: BROWSER_CPU_BACKENDS,
  hardwareConcurrency: 4,
};

describe("the size axis, read on its own", () => {
  it("puts a job below the worker boundary in the small tier", () => {
    expect(classifyJobSize({ replicates: 99 }, T)).toBe("small");
  });

  it("is inclusive at the bottom of each boundary, so a job exactly on one is the higher tier", () => {
    // Both sides of both boundaries. A convention left implicit is where an
    // off-by-one hides, so each is asserted at the boundary and one below it.
    expect(classifyJobSize({ replicates: 99 }, T)).toBe("small");
    expect(classifyJobSize({ replicates: 100 }, T)).toBe("medium");
    expect(classifyJobSize({ replicates: 9_999 }, T)).toBe("medium");
    expect(classifyJobSize({ replicates: 10_000 }, T)).toBe("huge");
  });

  it("never goes backwards as the job grows", () => {
    // Monotonicity is what makes it a policy rather than a lookup: a size that
    // demoted a tier as it grew would be incoherent however each individual
    // case read.
    const rank = { small: 0, medium: 1, huge: 2 } as const;
    let previous = -1;
    for (let replicates = 0; replicates <= 20_000; replicates += 7) {
      const current = rank[classifyJobSize({ replicates }, T)];
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it("classifies a degenerate replicate count as small rather than throwing", () => {
    // Routing is not validation -- validateEnsembleJob is. A policy that threw
    // would turn a bad job spec into a crash in the scheduler instead of a
    // rejection at the executor. `small` is also the safe answer: it spawns
    // nothing.
    for (const replicates of [0, -1, Number.NaN, Number.POSITIVE_INFINITY * 0]) {
      expect(classifyJobSize({ replicates }, T)).toBe("small");
    }
  });

  it("treats a positive-infinity replicate count as small too, rather than as bigger than every boundary", () => {
    // Written down because the opposite reading is tempting and wrong, and the
    // first draft of this test asserted it. Infinity IS above every finite
    // boundary, so "huge" looks like the consistent answer -- but a replicate
    // count is `job.replicates.length`, which is always a finite non-negative
    // integer, so an infinite one is not a big job. It is a broken input, and
    // routing a broken input to the GPU is the most expensive possible
    // response to it. Every non-finite count takes the same branch and lands on
    // the tier that spawns nothing.
    expect(classifyJobSize({ replicates: Number.POSITIVE_INFINITY }, T)).toBe("small");
  });
});

describe("the decision table: size and availability together", () => {
  it("runs a small job where it was called, spawning nothing, even with a GPU present", () => {
    // The whole reason this module exists. selectExecutionPlan would say
    // "webgpu" here on availability alone, and it would be slower.
    const route = routeEnsembleJob({ replicates: 10 }, { webgpu: GPU_YES, cpu: fourCores }, T);
    expect(route.tier).toBe("small");
    expect(route.parallelism).toBe(1);
    expect(route.kind).toBe("cpu");
    expect(route.demoted).toBe(false);
    expect(route.reason).toContain("dispatch would cost more than the work");
  });

  it("spreads a medium job across the reported cores", () => {
    const route = routeEnsembleJob({ replicates: 500 }, { webgpu: GPU_NO, cpu: fourCores }, T);
    expect(route.tier).toBe("medium");
    expect(route.parallelism).toBe(4);
    expect(route.kind).toBe("cpu");
    expect(route.demoted).toBe(false);
  });

  it("sends a huge job to the GPU when one was obtained", () => {
    const route = routeEnsembleJob({ replicates: 50_000 }, { webgpu: GPU_YES, cpu: fourCores }, T);
    expect(route.tier).toBe("huge");
    expect(route.backendId).toBe("webgpu");
    expect(route.kind).toBe("gpu");
    expect(route.parallelism).toBe(1);
    expect(route.demoted).toBe(false);
  });

  it("demotes a huge job to workers when there is no GPU, and says what was missing", () => {
    const route = routeEnsembleJob({ replicates: 50_000 }, { webgpu: GPU_NO, cpu: fourCores }, T);
    expect(route.tier).toBe("huge");
    expect(route.kind).toBe("cpu");
    expect(route.parallelism).toBe(4);
    expect(route.demoted).toBe(true);
    expect(route.reason).toContain("no-navigator-gpu");
  });

  it("demotes a medium job to the main thread on a single core, because workers would add spawn cost and no parallelism", () => {
    const route = routeEnsembleJob({ replicates: 500 }, { webgpu: GPU_NO, cpu: oneCore }, T);
    expect(route.tier).toBe("medium");
    expect(route.parallelism).toBe(1);
    expect(route.demoted).toBe(true);
  });

  it("demotes a huge job all the way to the main thread when there is neither a GPU nor a second core", () => {
    const route = routeEnsembleJob({ replicates: 50_000 }, { webgpu: GPU_NO, cpu: oneCore }, T);
    expect(route.tier).toBe("huge");
    expect(route.parallelism).toBe(1);
    expect(route.kind).toBe("cpu");
    expect(route.demoted).toBe(true);
    // The honest version of "this machine cannot serve this job well" is to say
    // so, not to pick a backend that cannot run and let dispatch fail.
    expect(route.reason).toContain("only correct option this machine offers");
  });
});

describe("the invariants that hold for every input", () => {
  const machines = [
    { webgpu: GPU_YES, cpu: fourCores },
    { webgpu: GPU_NO, cpu: fourCores },
    { webgpu: GPU_NO, cpu: oneCore },
    { webgpu: GPU_YES, cpu: browserFourCores },
    { webgpu: GPU_NO, cpu: browserFourCores },
    { webgpu: GPU_NO, cpu: { available: [], hardwareConcurrency: 4 } satisfies CpuCapabilities },
  ];
  const sizes = [0, 1, 99, 100, 101, 5_000, 9_999, 10_000, 10_001, 1e6];

  it("never names a CPU backend the caller said it cannot reach", () => {
    // A route naming `wasm-simd` to a browser bundle would be P0.133's false
    // fallback story with a scheduler attached: it would not merely mislead,
    // it would fail to dispatch.
    for (const machine of machines) {
      for (const replicates of sizes) {
        const route = routeEnsembleJob({ replicates }, machine, T);
        if (route.kind === "cpu") {
          const reachable =
            machine.cpu.available.includes(route.backendId) || route.backendId === "ts";
          expect(reachable, `${route.backendId} on ${JSON.stringify(machine.cpu.available)}`).toBe(
            true,
          );
        }
      }
    }
  });

  it("never names the GPU on a machine that has none", () => {
    for (const machine of machines.filter((m) => !m.webgpu.supported)) {
      for (const replicates of sizes) {
        expect(routeEnsembleJob({ replicates }, machine, T).backendId).not.toBe("webgpu");
      }
    }
  });

  it("always returns a route, with a positive integer parallelism", () => {
    // The un-graceful outcome selectExecutionPlan rules out, ruled out again on
    // the axis this module adds. An empty `available` list is in `machines`
    // above precisely so this cannot pass vacuously.
    for (const machine of machines) {
      for (const replicates of sizes) {
        const route = routeEnsembleJob({ replicates }, machine, T);
        expect(route.backendId).toBeTruthy();
        expect(route.label).toBeTruthy();
        expect(route.reason.length).toBeGreaterThan(0);
        expect(Number.isInteger(route.parallelism)).toBe(true);
        expect(route.parallelism).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("is pure: the same inputs give a deep-equal route and neither argument is mutated", () => {
    const machine = { webgpu: GPU_NO, cpu: fourCores };
    const before = JSON.stringify([machine, T]);
    const first = routeEnsembleJob({ replicates: 500 }, machine, T);
    const second = routeEnsembleJob({ replicates: 500 }, machine, T);
    expect(second).toEqual(first);
    expect(JSON.stringify([machine, T])).toBe(before);
  });

  it("echoes the thresholds it decided against, so a report is self-contained", () => {
    // A stored route that did not carry its own thresholds could not be read
    // later: the same tier means different things under different boundaries.
    expect(
      routeEnsembleJob({ replicates: 500 }, { webgpu: GPU_NO, cpu: fourCores }, T).thresholds,
    ).toBe(T);
  });

  it("honours injected thresholds rather than the shipped defaults", () => {
    // The same job size, two policies, two answers. Without this the whole
    // suite could be passing against hard-coded constants.
    const size = { replicates: 500 };
    const machine = { webgpu: GPU_YES, cpu: fourCores };
    const everythingIsHuge: SchedulerPolicyThresholds = {
      workerDispatchReplicates: 1,
      gpuDispatchReplicates: 2,
    };
    const everythingIsSmall: SchedulerPolicyThresholds = {
      workerDispatchReplicates: 1e9,
      gpuDispatchReplicates: 1e10,
    };
    expect(routeEnsembleJob(size, machine, everythingIsHuge).backendId).toBe("webgpu");
    expect(routeEnsembleJob(size, machine, everythingIsSmall).parallelism).toBe(1);
  });
});

describe("the shipped defaults", () => {
  it("orders the two boundaries, so the medium tier is not empty", () => {
    expect(DEFAULT_SCHEDULER_THRESHOLDS.workerDispatchReplicates).toBeLessThan(
      DEFAULT_SCHEDULER_THRESHOLDS.gpuDispatchReplicates,
    );
  });

  it("still sits where the committed crossover measurement put it", () => {
    // A property of two files, not of this machine -- see the header. What this
    // catches is the constant and the artifact drifting apart: if someone
    // re-records the measurement on different hardware and the crossing moves,
    // the shipped default is now unexplained and this fails rather than letting
    // it sit there looking measured.
    const artifact = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../../../scripts/dispatch-crossover-results.json", import.meta.url)),
        "utf8",
      ),
    ) as {
      task: string;
      verdict: { crossoverReplicates: number | null };
      points: { replicates: number; workerSpeedup: number }[];
    };

    expect(artifact.task).toBe("P7.28");
    expect(artifact.verdict.crossoverReplicates).toBe(
      DEFAULT_SCHEDULER_THRESHOLDS.workerDispatchReplicates,
    );

    // And the artifact's own internal consistency: the recorded crossover is
    // genuinely the smallest recorded size at which workers won. A verdict that
    // disagreed with its own points would make the line above meaningless.
    const firstWin = artifact.points.find((point) => point.workerSpeedup > 1);
    expect(firstWin?.replicates).toBe(artifact.verdict.crossoverReplicates);
  });

  it("leaves the GPU boundary above the worker boundary by a wide margin, as a declared policy", () => {
    // Deliberately a loose assertion. The number is DECLARED, not measured (see
    // the field's own docs), so pinning it exactly here would dress a policy
    // choice up as a fact. What is worth asserting is the shape: a GPU-sized
    // job is unambiguously past where CPU parallelism stopped being the
    // interesting axis.
    expect(DEFAULT_SCHEDULER_THRESHOLDS.gpuDispatchReplicates).toBeGreaterThanOrEqual(
      DEFAULT_SCHEDULER_THRESHOLDS.workerDispatchReplicates * 8,
    );
  });
});

/**
 * The criterion's second clause. A decision table that names a backend the
 * executor cannot be configured with has not routed anything, so the route is
 * fed to a real `createHeterogeneousExecutor` and the job is really run.
 */
describe("end-to-end: the routed plan configures the executor and picks the expected backend", () => {
  /**
   * The spread matters: replicates must differ from each other, or a partition
   * that mixed chunks up would still produce a matching buffer. Same shape and
   * same reasoning as `heterogeneous-executor.test.ts`'s fixture.
   */
  function replicate(r: number): EnsembleReplicate {
    return {
      mass: 0.145 * (1 + (r % 97) / 500),
      radius: 0.0366 * (1 + (r % 17) / 400),
      dragCoefficient: 0.47 * (1 + (r % 31) / 200),
      x0: 0,
      y0: 1.5 + (r % 13) * 0.25,
      vx0: 40 + (r % 71) * 0.5,
      vy0: -14 + (r % 53) * 1,
    };
  }

  /** `h` non-dyadic and `t0` non-zero, for heterogeneous-executor.test.ts's stated reasons. */
  function jobOf(replicates: number): EnsembleJobSpec {
    return {
      t0: 0.25,
      h: 0.0071,
      steps: 32,
      gravity: 9.79,
      windX: 3.5,
      windY: -1.25,
      replicates: Array.from({ length: replicates }, (_, r) => replicate(r)),
    };
  }

  /**
   * Builds the executor a route describes: `parallelism` chunks over CPU
   * backends that record which of them ran.
   *
   * The recording is the point -- "picks the expected backend" is a claim about
   * what actually ran, and an assertion on the route object alone would not
   * have checked that the executor could be built from it at all.
   */
  function executorFor(parallelism: number, ran: string[]) {
    const backends: EnsembleBackend[] = Array.from({ length: parallelism }, (_, i) => {
      const inner = createTsEnsembleBackend(`ts-${i}`);
      return {
        id: inner.id,
        runRange: (job, start, end) => {
          ran.push(inner.id);
          return inner.runRange(job, start, end);
        },
      };
    });
    return createHeterogeneousExecutor({ backends, chunks: parallelism });
  }

  it("runs a small job as exactly one chunk on one backend", async () => {
    const route = routeEnsembleJob({ replicates: 40 }, { webgpu: GPU_YES, cpu: fourCores }, T);
    expect(route.parallelism).toBe(1);

    const ran: string[] = [];
    const report = await executorFor(route.parallelism, ran).run(jobOf(40));

    expect(ran).toEqual(["ts-0"]);
    expect(report.assignments).toHaveLength(1);
    expect(report.assignments[0]).toMatchObject({ startIndex: 0, endIndex: 40 });
  });

  it("runs a medium job as one chunk per reported core, covering every replicate exactly once", async () => {
    const route = routeEnsembleJob({ replicates: 200 }, { webgpu: GPU_NO, cpu: fourCores }, T);
    expect(route.parallelism).toBe(4);

    const ran: string[] = [];
    const report = await executorFor(route.parallelism, ran).run(jobOf(200));

    expect([...ran].sort()).toEqual(["ts-0", "ts-1", "ts-2", "ts-3"]);
    const covered = report.assignments.reduce((n, a) => n + (a.endIndex - a.startIndex), 0);
    expect(covered).toBe(200);
    // Contiguous and in order, which is what makes reassembly-by-index a
    // statement about this run rather than about the executor in general.
    const sorted = [...report.assignments].sort((a, b) => a.startIndex - b.startIndex);
    expect(sorted[0]?.startIndex).toBe(0);
    expect(sorted.at(-1)?.endIndex).toBe(200);
  });

  it("produces bit-identical observables however the policy partitioned the job", async () => {
    // The clause that stops routing from being a correctness decision. A policy
    // is only free to move a job between tiers because the answer does not
    // depend on where it ran -- so the small-tier plan and the medium-tier plan
    // must agree exactly, under Object.is and not toBeCloseTo.
    // ENSEMBLE_BACKEND_TOLERANCE_ULP is 0 and P7.10's suite is why.
    const job = jobOf(200);
    const small = routeEnsembleJob({ replicates: 200 }, { webgpu: GPU_NO, cpu: oneCore }, T);
    const medium = routeEnsembleJob({ replicates: 200 }, { webgpu: GPU_NO, cpu: fourCores }, T);
    expect(small.parallelism).toBe(1);
    expect(medium.parallelism).toBe(4);

    const a = await executorFor(small.parallelism, []).run(job);
    const b = await executorFor(medium.parallelism, []).run(job);

    expect(a.observables).toHaveLength(200 * ENSEMBLE_OBS_COUNT);
    expect(b.observables).toHaveLength(a.observables.length);
    const divergences: { slot: number; left: number; right: number }[] = [];
    for (let i = 0; i < a.observables.length; i++) {
      const left = a.observables[i] as number;
      const right = b.observables[i] as number;
      if (!Object.is(left, right)) divergences.push({ slot: i, left, right });
    }
    expect(divergences).toEqual([]);
  });
});
