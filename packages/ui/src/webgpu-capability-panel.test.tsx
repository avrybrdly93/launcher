// @vitest-environment jsdom
/**
 * P7.13's UI half. The validation criterion is "unsupported browsers get
 * graceful CPU path", and on the UI side "graceful" means something specific
 * and checkable: on a machine with no WebGPU the panel still renders, still
 * names the backend that runs, and never presents the absence as an error.
 *
 * So the assertions here are mostly about the *unsupported* renders. The
 * supported branch gets one section at the end, built from a report this file
 * constructs rather than from a GPU, because no container running these tests
 * has one.
 */

import { render } from "preact";
import { afterEach, describe, expect, it } from "vitest";

import {
  BROWSER_CPU_BACKENDS,
  NODE_CPU_BACKENDS,
  selectExecutionPlan,
  type ComputeCapabilityReport,
  type CpuCapabilities,
  type WebGpuProbeResult,
  type WebGpuUnsupportedReason,
} from "@ballista/runtime";

import { WebGpuCapabilityPanel } from "./webgpu-capability-panel.js";
import { EXPLAINED_REASONS, UNSUPPORTED_EXPLANATIONS } from "./webgpu-capability-panel-logic.js";

let host: HTMLDivElement | undefined;

const mount = (vnode: preact.ComponentChild): HTMLDivElement => {
  host = document.createElement("div");
  document.body.append(host);
  render(vnode, host);
  return host;
};

afterEach(() => {
  if (host !== undefined) render(null, host);
  host?.remove();
  host = undefined;
});

const q = (root: ParentNode, id: string): HTMLElement | null =>
  root.querySelector(`[data-testid="${id}"]`);

const cpu = (available: readonly string[] = BROWSER_CPU_BACKENDS): CpuCapabilities =>
  ({ available, hardwareConcurrency: 4 }) as CpuCapabilities;

function unsupportedReport(
  reason: WebGpuUnsupportedReason,
  error: string | null = null,
  available: readonly string[] = BROWSER_CPU_BACKENDS,
): ComputeCapabilityReport {
  const webgpu = { supported: false, reason, error } as WebGpuProbeResult;
  const capabilities = cpu(available);
  return { webgpu, cpu: capabilities, plan: selectExecutionPlan(webgpu, capabilities) };
}

function supportedReport(): ComputeCapabilityReport {
  const webgpu: WebGpuProbeResult = {
    supported: true,
    reason: null,
    adapter: { vendor: "acme", architecture: "rdna-9", device: "", description: "" },
    features: ["shader-f16", "timestamp-query"],
    limits: {
      maxComputeWorkgroupSizeX: 256,
      maxComputeInvocationsPerWorkgroup: 256,
      maxComputeWorkgroupsPerDimension: 65535,
      maxStorageBufferBindingSize: 134217728,
      maxBufferSize: null,
    },
  };
  const capabilities = cpu(NODE_CPU_BACKENDS);
  return { webgpu, cpu: capabilities, plan: selectExecutionPlan(webgpu, capabilities) };
}

describe("WebGpuCapabilityPanel before the probe resolves", () => {
  it("says it is detecting rather than rendering nothing", () => {
    // A blank panel and a failed panel look identical, which is the shape this
    // task exists to remove.
    const root = mount(<WebGpuCapabilityPanel report={null} />);
    expect(q(root, "capability-panel")).not.toBeNull();
    expect(q(root, "capability-pending")?.textContent).toMatch(/detecting/i);
  });
});

describe("WebGpuCapabilityPanel on a machine with no WebGPU", () => {
  it.each(EXPLAINED_REASONS)("renders the panel and the CPU plan when WebGPU is %s", (reason) => {
    const root = mount(<WebGpuCapabilityPanel report={unsupportedReport(reason)} />);

    expect(q(root, "capability-webgpu-unsupported")).not.toBeNull();
    // The headline names what RUNS, not what is missing.
    expect(q(root, "capability-headline")?.textContent).toContain("TypeScript reference stepper");
    expect(q(root, "capability-fallback")?.textContent).toContain("simulation is unaffected");
  });

  it.each(EXPLAINED_REASONS)("explains %s and says what would change it", (reason) => {
    const root = mount(<WebGpuCapabilityPanel report={unsupportedReport(reason)} />);

    const summary = q(root, "capability-unsupported-summary")?.textContent ?? "";
    const remedy = q(root, "capability-unsupported-remedy")?.textContent ?? "";
    expect(summary).toBe(UNSUPPORTED_EXPLANATIONS[reason].summary);
    expect(remedy).toBe(UNSUPPORTED_EXPLANATIONS[reason].remedy);
    expect(summary.length).toBeGreaterThan(20);
    expect(remedy.length).toBeGreaterThan(20);
  });

  it("shows the underlying error only when there was one", () => {
    const withError = mount(
      <WebGpuCapabilityPanel report={unsupportedReport("adapter-request-failed", "boom")} />,
    );
    expect(q(withError, "capability-unsupported-error")?.textContent).toContain("boom");
    render(null, withError);
    withError.remove();

    // `no-adapter` is not a malfunction: nothing threw, the answer is simply
    // no, and an "error" line would misrepresent it.
    const withoutError = mount(<WebGpuCapabilityPanel report={unsupportedReport("no-adapter")} />);
    expect(q(withoutError, "capability-unsupported-error")).toBeNull();
  });

  it("never calls the absence of WebGPU an error, failure, or problem", () => {
    // The criterion is 'graceful'. A machine without a GPU has not malfunctioned.
    for (const reason of EXPLAINED_REASONS) {
      const root = mount(<WebGpuCapabilityPanel report={unsupportedReport(reason)} />);
      const headline = q(root, "capability-headline")?.textContent ?? "";
      const fallback = q(root, "capability-fallback")?.textContent ?? "";
      expect(`${headline} ${fallback}`.toLowerCase()).not.toMatch(
        /\b(error|failed|failure|unsupported|problem|cannot run)\b/,
      );
      render(null, root);
      root.remove();
    }
  });

  it("states the worker count as machine capacity, never as what this view is doing", () => {
    // "TypeScript reference stepper x 4 workers" would read as a claim about
    // the page in front of you, and on the Monte Carlo route -- which runs on
    // the UI thread until P6.25 -- that claim would be false.
    const root = mount(<WebGpuCapabilityPanel report={unsupportedReport("no-navigator-gpu")} />);
    expect(q(root, "capability-headline")?.textContent).not.toContain("4");
    expect(q(root, "capability-parallelism")?.textContent).toContain("up to 4 worker threads");
  });

  it("names the WASM backend instead when one is reachable", () => {
    const root = mount(
      <WebGpuCapabilityPanel report={unsupportedReport("no-adapter", null, NODE_CPU_BACKENDS)} />,
    );
    expect(q(root, "capability-headline")?.textContent).toContain("WebAssembly SIMD");
  });

  it("does not promise that CPU results match a GPU path that does not exist yet", () => {
    // P7.14 has not landed and will be f32 against this path's f64; P7.17
    // exists because f32 is expected to be inadequate for some scenarios. A
    // reassurance that will be false later is not a reassurance.
    const root = mount(<WebGpuCapabilityPanel report={unsupportedReport("no-navigator-gpu")} />);
    const fallback = q(root, "capability-fallback")?.textContent ?? "";
    expect(fallback).not.toMatch(/identical to the GPU/i);
    expect(fallback).toContain("double precision");
  });
});

describe("WebGpuCapabilityPanel on a machine with WebGPU", () => {
  it("reports the adapter, its features and the Phase 7 limits", () => {
    const root = mount(<WebGpuCapabilityPanel report={supportedReport()} />);

    expect(q(root, "capability-webgpu-supported")).not.toBeNull();
    expect(q(root, "capability-headline")?.textContent).toContain("WebGPU compute");
    expect(q(root, "capability-adapter")?.textContent).toContain("acme");
    expect(q(root, "capability-features")?.textContent).toContain("timestamp-query");
    expect(q(root, "capability-limit-maxComputeWorkgroupSizeX")?.textContent).toContain("256");
    expect(q(root, "capability-limit-maxStorageBufferBindingSize")?.textContent).toContain(
      "128 MiB",
    );
    // An unreported limit is an em dash, never a zero.
    expect(q(root, "capability-limit-maxBufferSize")?.textContent).toContain("—");
  });
});
