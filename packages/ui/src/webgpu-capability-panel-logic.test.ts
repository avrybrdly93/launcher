/**
 * P7.13's panel-logic tests: the sentences a user reads, checked without a DOM.
 *
 * The point of asserting prose is that "graceful" is a property of what the
 * user is told. A panel can take the CPU branch perfectly and still fail this
 * task by rendering "WebGPU: false" and stopping.
 */

import { describe, expect, it } from "vitest";
import {
  BROWSER_CPU_BACKENDS,
  REPORTED_WEBGPU_LIMITS,
  selectExecutionPlan,
  type ComputeCapabilityReport,
  type CpuCapabilities,
  type WebGpuLimitsSummary,
  type WebGpuProbeResult,
} from "@ballista/runtime";

import {
  EXPLAINED_REASONS,
  UNSUPPORTED_EXPLANATIONS,
  describeAdapter,
  describeParallelism,
  formatLimit,
  headlineFor,
  limitRows,
} from "./webgpu-capability-panel-logic.js";

const ALL_LIMITS: WebGpuLimitsSummary = {
  maxComputeWorkgroupSizeX: 256,
  maxComputeInvocationsPerWorkgroup: 1024,
  maxComputeWorkgroupsPerDimension: 65535,
  maxStorageBufferBindingSize: 134217728,
  maxBufferSize: 2147483648,
};

const reportWith = (plan: ComputeCapabilityReport["plan"]): ComputeCapabilityReport =>
  ({
    webgpu: { supported: false, reason: "no-navigator-gpu", error: null },
    cpu: { available: BROWSER_CPU_BACKENDS, hardwareConcurrency: plan.parallelism },
    plan,
  }) as ComputeCapabilityReport;

describe("every way WebGPU can be absent has an explanation", () => {
  it("covers all four reasons the runtime can report", () => {
    // Keyed by the runtime's union, so a fifth reason added there without a
    // sentence here is a type error rather than a blank cell on screen. This
    // asserts the count has not silently diverged.
    expect([...EXPLAINED_REASONS].sort()).toEqual([
      "adapter-request-failed",
      "device-request-failed",
      "no-adapter",
      "no-navigator-gpu",
    ]);
  });

  it.each(EXPLAINED_REASONS)("%s says what happened and what would change it", (reason) => {
    const entry = UNSUPPORTED_EXPLANATIONS[reason];
    expect(entry.summary.trim().length).toBeGreaterThan(20);
    expect(entry.remedy.trim().length).toBeGreaterThan(20);
    expect(entry.summary).not.toBe(entry.remedy);
  });

  it("tells a browser with no WebGPU that the hardware is not the issue", () => {
    // The remedy must not send a Safari user to update their graphics driver.
    const entry = UNSUPPORTED_EXPLANATIONS["no-navigator-gpu"];
    expect(entry.remedy).toMatch(/browser/i);
    expect(entry.remedy).toMatch(/nothing about this machine/i);
  });

  it("tells a browser that offered no adapter that the hardware IS the issue", () => {
    const entry = UNSUPPORTED_EXPLANATIONS["no-adapter"];
    expect(entry.remedy).toMatch(/driver/i);
  });
});

describe("formatLimit", () => {
  it("shows an unreported limit as an em dash, never as zero", () => {
    // An unreported limit and a limit of zero are different claims and only one
    // of them would be alarming.
    for (const key of REPORTED_WEBGPU_LIMITS) {
      expect(formatLimit(key, null)).toBe("—");
    }
  });

  it("shows byte limits in MiB and count limits with thousands separators", () => {
    expect(formatLimit("maxStorageBufferBindingSize", 134217728)).toBe("128 MiB");
    expect(formatLimit("maxBufferSize", 2147483648)).toBe("2048 MiB");
    expect(formatLimit("maxComputeWorkgroupsPerDimension", 65535)).toBe("65,535");
    expect(formatLimit("maxComputeWorkgroupSizeX", 256)).toBe("256");
  });

  it("keeps a decimal place below 10 MiB, where the fraction carries information", () => {
    expect(formatLimit("maxBufferSize", 1024 * 1024 * 2.5)).toBe("2.5 MiB");
    expect(formatLimit("maxBufferSize", 0)).toBe("0.0 MiB");
  });
});

describe("limitRows", () => {
  it("emits one row per reported limit, in the runtime's order, each labelled", () => {
    const rows = limitRows(ALL_LIMITS);
    expect(rows.map((row) => row.key)).toEqual([...REPORTED_WEBGPU_LIMITS]);
    for (const row of rows) {
      expect(row.label.trim()).not.toBe("");
      expect(row.value.trim()).not.toBe("");
    }
  });
});

describe("describeAdapter", () => {
  it("joins the parts the browser did report", () => {
    expect(describeAdapter({ vendor: "acme", architecture: "rdna-9" })).toBe("acme · rdna-9");
  });

  it("says so plainly when the browser blanks every field", () => {
    // Firefox and Safari do this as a fingerprinting defence, so it is normal
    // rather than a rendering bug -- and a blank line would read as one.
    expect(describeAdapter({})).toBe("Not reported by this browser");
    expect(describeAdapter({ vendor: "", architecture: "  ", device: "" })).toBe(
      "Not reported by this browser",
    );
  });
});

describe("headlineFor states the outcome rather than the absence", () => {
  it("names the CPU backend and its worker count", () => {
    const webgpu = {
      supported: false,
      reason: "no-navigator-gpu",
      error: null,
    } as WebGpuProbeResult;
    const cpu: CpuCapabilities = { available: BROWSER_CPU_BACKENDS, hardwareConcurrency: 8 };
    const plan = selectExecutionPlan(webgpu, cpu);
    const headline = headlineFor(reportWith(plan));
    // Capacity and current use are different claims; the headline makes only
    // the one this module can stand behind.
    expect(headline).toBe("Running on: TypeScript reference stepper");
    expect(headline).not.toMatch(/webgpu/i);
    expect(headline).not.toMatch(/worker/i);
    expect(describeParallelism(reportWith(plan))).toBe(
      "up to 8 worker threads reported by this browser",
    );
  });

  it("reports a single-threaded machine as one thread, not as 'up to 1'", () => {
    const webgpu = { supported: false, reason: "no-adapter", error: null } as WebGpuProbeResult;
    const cpu: CpuCapabilities = { available: BROWSER_CPU_BACKENDS, hardwareConcurrency: 1 };
    const plan = selectExecutionPlan(webgpu, cpu);
    expect(headlineFor(reportWith(plan))).toBe("Running on: TypeScript reference stepper");
    expect(describeParallelism(reportWith(plan))).toBe("1 thread reported by this browser");
  });

  it("names the GPU, with no worker count, when WebGPU is available", () => {
    const webgpu: WebGpuProbeResult = {
      supported: true,
      reason: null,
      adapter: {},
      features: [],
      limits: ALL_LIMITS,
    };
    const cpu: CpuCapabilities = { available: BROWSER_CPU_BACKENDS, hardwareConcurrency: 8 };
    expect(headlineFor(reportWith(selectExecutionPlan(webgpu, cpu)))).toBe(
      "Running on: WebGPU compute",
    );
  });
});
