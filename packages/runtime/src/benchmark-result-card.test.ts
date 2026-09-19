/**
 * Result-card tests (P7.32).
 *
 * Four blocks, and the order is the order of what would be worst to get
 * wrong: the withheld verdict, the allowlist, the opt-in default, and the
 * rendering. The first three are the task's actual claims -- "anonymized",
 * "opt-in", and a number that does not pretend to be a verdict -- and each is
 * asserted against a hostile input rather than a convenient one.
 */

import { describe, expect, it } from "vitest";
import {
  ACCURACY_CEILING,
  THROUGHPUT_BUDGET_TRAJECTORIES_PER_SECOND,
  THROUGHPUT_WORKERS,
  type LadderRung,
} from "./batch-throughput.js";
import {
  ANONYMISED_ADAPTER_FIELDS,
  anonymiseAdapter,
  budgetVerdict,
  buildResultCard,
  formatResultCard,
  verdictWithheldReason,
} from "./benchmark-result-card.js";
import type { ComputeCapabilityReport } from "./webgpu-capability.js";

function rung(overrides: Partial<LadderRung> = {}): LadderRung {
  return {
    stepSize: 0.1,
    replicates: 2000,
    workers: 1,
    elapsedSeconds: 0.5,
    trajectoriesPerSecond: 4000,
    relativeRangeError: 1e-12,
    ...overrides,
  };
}

/** A capability report with a supported adapter carrying the fields under test. */
function capability(
  adapter: Record<string, unknown> = {},
  planLabel = "TypeScript reference stepper",
): ComputeCapabilityReport {
  return {
    webgpu: {
      supported: true,
      reason: null,
      adapter: adapter as never,
      features: [],
      limits: {
        maxComputeWorkgroupSizeX: null,
        maxComputeInvocationsPerWorkgroup: null,
        maxComputeWorkgroupsPerDimension: null,
        maxStorageBufferBindingSize: null,
        maxBufferSize: null,
      },
    },
    cpu: { available: ["ts"], hardwareConcurrency: 4 },
    plan: {
      backendId: "ts",
      label: planLabel,
      kind: "cpu",
      reason: "no WebGPU adapter",
      parallelism: 1,
    },
  };
}

describe("budgetVerdict withholds rather than guesses (P7.32)", () => {
  it("gives no verdict for a single-threaded run, however fast it was", () => {
    // Ten times the budget, on one thread. The temptation is to call this a
    // pass; it is a measurement of a configuration the budget says nothing
    // about.
    const fast = rung({
      workers: 1,
      trajectoriesPerSecond: THROUGHPUT_BUDGET_TRAJECTORIES_PER_SECOND * 10,
    });
    expect(budgetVerdict(fast, fast.workers)).toBe("not-applicable");
    expect(verdictWithheldReason(fast, fast.workers)).toMatch(/not the 4 /);
  });

  it("gives no verdict for a slow single-threaded run either — the miss is not the default", () => {
    const slow = rung({
      workers: 1,
      trajectoriesPerSecond: THROUGHPUT_BUDGET_TRAJECTORIES_PER_SECOND / 100,
    });
    expect(budgetVerdict(slow, slow.workers)).toBe("not-applicable");
  });

  it("reads a real verdict at the configuration the budget is stated at", () => {
    const meets = rung({
      workers: THROUGHPUT_WORKERS,
      trajectoriesPerSecond: THROUGHPUT_BUDGET_TRAJECTORIES_PER_SECOND + 1,
    });
    const misses = rung({
      workers: THROUGHPUT_WORKERS,
      trajectoriesPerSecond: THROUGHPUT_BUDGET_TRAJECTORIES_PER_SECOND - 1,
    });
    expect(budgetVerdict(meets, meets.workers)).toBe("meets");
    expect(budgetVerdict(misses, misses.workers)).toBe("misses");
    expect(verdictWithheldReason(meets, meets.workers)).toBeNull();
  });

  it("withholds a verdict from a rung that is fast because it is inaccurate", () => {
    const inaccurate = rung({
      workers: THROUGHPUT_WORKERS,
      trajectoriesPerSecond: THROUGHPUT_BUDGET_TRAJECTORIES_PER_SECOND * 100,
      relativeRangeError: ACCURACY_CEILING * 10,
    });
    expect(budgetVerdict(inaccurate, inaccurate.workers)).toBe("not-applicable");
    expect(verdictWithheldReason(inaccurate, inaccurate.workers)).toMatch(/accuracy/);
  });
});

describe("anonymisation is an allowlist (P7.32)", () => {
  it("carries the two allowlisted fields", () => {
    expect(anonymiseAdapter({ vendor: "amd", architecture: "rdna3" })).toEqual({
      vendor: "amd",
      architecture: "rdna3",
    });
  });

  it("drops device and description, which drivers fill with identifying strings", () => {
    const result = anonymiseAdapter({
      vendor: "amd",
      architecture: "rdna3",
      device: "Radeon RX 7900 XTX (board 0x744C, serial 1234)",
      description: "Mesa 24.1.0-devel (git-abc1234) on user-laptop",
    });
    expect(result).toEqual({ vendor: "amd", architecture: "rdna3" });
    expect(JSON.stringify(result)).not.toMatch(/serial|Mesa|laptop|744C/);
  });

  it("contributes nothing from a field nobody has thought of yet", () => {
    // The growth test: a future addition to GpuAdapterInfoLike must not reach
    // a card by default. A denylist would pass the two assertions above and
    // fail this one, which is the whole reason the allowlist exists.
    const withFutureField = anonymiseAdapter({
      vendor: "amd",
      architecture: "rdna3",
      driverBuildId: "user@host-2026-09-19-deadbeef",
      installationUuid: "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
    } as never);
    expect(Object.keys(withFutureField).sort()).toEqual([...ANONYMISED_ADAPTER_FIELDS].sort());
    expect(JSON.stringify(withFutureField)).not.toMatch(/deadbeef|9f8e7d6c/);
  });

  it("reports a blank adapter as not-reported rather than as an empty string", () => {
    // Firefox and Safari deliberately report empty strings.
    expect(anonymiseAdapter({ vendor: "", architecture: "" })).toEqual({
      vendor: null,
      architecture: null,
    });
    expect(anonymiseAdapter({})).toEqual({ vendor: null, architecture: null });
  });
});

describe("the adapter opt-in defaults to off (P7.32)", () => {
  const identifying = capability({ vendor: "amd", architecture: "rdna3", device: "RX 7900 XTX" });

  it("omits the adapter entirely when no options are passed", () => {
    const card = buildResultCard(rung(), identifying);
    expect(card.adapter).toBeNull();
    expect(JSON.stringify(card)).not.toMatch(/amd|rdna3|7900/);
  });

  it("omits it when the caller passes options but not the flag", () => {
    const card = buildResultCard(rung(), identifying, {});
    expect(card.adapter).toBeNull();
  });

  it("includes only the allowlisted fields once opted in", () => {
    const card = buildResultCard(rung(), identifying, { includeAdapter: true });
    expect(card.adapter).toEqual({ vendor: "amd", architecture: "rdna3" });
    expect(JSON.stringify(card)).not.toMatch(/7900/);
  });

  it("opting in on a machine with no WebGPU yields nulls, not a missing field", () => {
    const noGpu: ComputeCapabilityReport = {
      ...capability(),
      webgpu: { supported: false, reason: "no-navigator-gpu", error: null },
    };
    const card = buildResultCard(rung(), noGpu, { includeAdapter: true });
    expect(card.adapter).toEqual({ vendor: null, architecture: null });
  });
});

describe("the rendered card carries its own caveats (P7.32)", () => {
  it("states the replicate and thread count beside the rate", () => {
    const text = formatResultCard(buildResultCard(rung({ replicates: 2000 }), capability()));
    expect(text).toMatch(/2000 replicates, 1 thread,/);
    expect(text).toMatch(/4,000 trajectories\/s/);
  });

  it("prints the withheld verdict as withheld, never as a miss", () => {
    const text = formatResultCard(buildResultCard(rung({ workers: 1 }), capability()));
    expect(text).toMatch(/§2\.6 budget: not assessed/);
    expect(text).not.toMatch(/missed/);
  });

  it("says the adapter was not included when it was not", () => {
    const text = formatResultCard(buildResultCard(rung(), capability()));
    expect(text).toMatch(/Adapter:\s+not included \(opt-in\)/);
  });

  it("disclaims the number as the runner's own, not the project's", () => {
    const text = formatResultCard(buildResultCard(rung(), capability()));
    expect(text).toMatch(/Not a published figure of the project's/);
    expect(text).toMatch(/not comparable to a run at a different replicate or thread count/);
  });

  it("names the backend that actually ran", () => {
    const text = formatResultCard(buildResultCard(rung(), capability({}, "WebGPU compute")));
    expect(text).toMatch(/Backend:\s+WebGPU compute/);
  });
});
