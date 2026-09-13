import { describe, expect, it } from "vitest";
import {
  ADAPTER_CLASSES,
  DEFAULT_WORKGROUP_CANDIDATES,
  classifyAdapter,
  planWorkgroupSweep,
  summariseWorkgroupSweep,
} from "./wgsl-workgroup-sweep.js";

/**
 * **The sweep's decisions are tested here; the sweep's timings are not.**
 *
 * Nothing in this file runs on a GPU or measures anything. What it pins is the
 * reasoning a benchmark applies to numbers it is handed — which candidates are
 * runnable, which statistic is used, and, above all, when the fastest size is
 * allowed to be called the best one.
 *
 * That last is the part worth testing hard. A benchmark's characteristic
 * failure is not a wrong number, it is a real number carrying a conclusion it
 * does not support, and a conclusion is exactly the kind of thing a unit test
 * can hold to account with no hardware in the room.
 */

describe("planWorkgroupSweep", () => {
  it("keeps every default candidate on a device at the portable limits", () => {
    const plan = planWorkgroupSweep({
      maxComputeWorkgroupSizeX: 256,
      maxComputeInvocationsPerWorkgroup: 256,
    });
    expect(plan).toStrictEqual([...DEFAULT_WORKGROUP_CANDIDATES]);
  });

  it("filters against the smaller of the two limits", () => {
    // A device may bound the x component generously and total invocations
    // tightly, or the reverse. Taking one and ignoring the other yields a
    // candidate that fails pipeline creation partway through the sweep.
    expect(
      planWorkgroupSweep({
        maxComputeWorkgroupSizeX: 256,
        maxComputeInvocationsPerWorkgroup: 64,
      }),
    ).toStrictEqual([1, 8, 16, 32, 64]);
    expect(
      planWorkgroupSweep({
        maxComputeWorkgroupSizeX: 32,
        maxComputeInvocationsPerWorkgroup: 256,
      }),
    ).toStrictEqual([1, 8, 16, 32]);
  });

  it("keeps a candidate above the portable ceiling when the device reports room", () => {
    const plan = planWorkgroupSweep(
      { maxComputeWorkgroupSizeX: 1024, maxComputeInvocationsPerWorkgroup: 1024 },
      [64, 512, 1024, 2048],
    );
    expect(plan).toStrictEqual([64, 512, 1024]);
  });

  it("dedupes and sorts a caller's candidate list", () => {
    const plan = planWorkgroupSweep(
      { maxComputeWorkgroupSizeX: 256, maxComputeInvocationsPerWorkgroup: 256 },
      [64, 8, 64, 32, 8],
    );
    expect(plan).toStrictEqual([8, 32, 64]);
  });

  it("drops candidates that are not positive integers rather than failing", () => {
    const plan = planWorkgroupSweep(
      { maxComputeWorkgroupSizeX: 256, maxComputeInvocationsPerWorkgroup: 256 },
      [0, -8, 1.5, 32, Number.NaN],
    );
    expect(plan).toStrictEqual([32]);
  });

  it("rejects limits that are not positive integers", () => {
    expect(() =>
      planWorkgroupSweep({ maxComputeWorkgroupSizeX: 0, maxComputeInvocationsPerWorkgroup: 256 }),
    ).toThrow(RangeError);
    expect(() =>
      planWorkgroupSweep({
        maxComputeWorkgroupSizeX: 256,
        maxComputeInvocationsPerWorkgroup: Number.NaN,
      }),
    ).toThrow(RangeError);
  });

  it("rejects an empty plan rather than sweeping nothing", () => {
    // Every conformant device accepts 256, so limits that admit no candidate
    // were read from somewhere other than a device. A zero-length sweep would
    // otherwise produce a results file with no rows and no error.
    expect(() =>
      planWorkgroupSweep(
        { maxComputeWorkgroupSizeX: 256, maxComputeInvocationsPerWorkgroup: 256 },
        [512, 1024],
      ),
    ).toThrow(/no candidate workgroup size/);
  });

  it("includes 1 in the defaults, which is the sweep's own control", () => {
    // A candidate certain to be bad. If it does not come last in a real
    // ranking, the harness is not measuring occupancy at all.
    expect(DEFAULT_WORKGROUP_CANDIDATES).toContain(1);
  });
});

describe("summariseWorkgroupSweep", () => {
  it("ranks by median, ascending", () => {
    const summary = summariseWorkgroupSweep([
      { workgroupSize: 1, timingsMs: [90, 100, 110] },
      { workgroupSize: 64, timingsMs: [9, 10, 11] },
      { workgroupSize: 32, timingsMs: [19, 20, 21] },
    ]);
    expect(summary.rankings.map((r) => r.workgroupSize)).toStrictEqual([64, 32, 1]);
    expect(summary.rankings[0]?.medianMs).toBe(10);
    expect(summary.rankings[0]?.minMs).toBe(9);
    expect(summary.rankings[0]?.maxMs).toBe(11);
    expect(summary.rankings[0]?.repeats).toBe(3);
  });

  it("uses the median and not the mean, so one hiccup does not decide the sweep", () => {
    // 64 is faster on four of five repeats and its mean is worse, because one
    // repeat was descheduled. A mean-ranked sweep reports 32.
    const summary = summariseWorkgroupSweep([
      { workgroupSize: 64, timingsMs: [10, 10, 10, 10, 500] },
      { workgroupSize: 32, timingsMs: [20, 20, 20, 20, 20] },
    ]);
    expect(summary.fastestWorkgroupSize).toBe(64);
  });

  it("averages the two middle timings on an even repeat count", () => {
    const summary = summariseWorkgroupSweep([{ workgroupSize: 64, timingsMs: [10, 20, 30, 40] }]);
    expect(summary.rankings[0]?.medianMs).toBe(25);
  });

  it("calls a size best only when the two samples do not overlap", () => {
    const separated = summariseWorkgroupSweep([
      { workgroupSize: 64, timingsMs: [10, 11, 12] },
      { workgroupSize: 32, timingsMs: [20, 21, 22] },
    ]);
    expect(separated.separated).toBe(true);
    expect(separated.bestWorkgroupSize).toBe(64);
    expect(separated.separationMs).toBe(10);
  });

  it("refuses to name a best size when the top two overlap", () => {
    // 64 has the lower median and 32's fastest repeat beat 64's slowest. That
    // is a sweep that found the choice does not matter at this resolution --
    // a real result, and not a winner.
    const overlapping = summariseWorkgroupSweep([
      { workgroupSize: 64, timingsMs: [10, 12, 18] },
      { workgroupSize: 32, timingsMs: [11, 13, 19] },
    ]);
    expect(overlapping.fastestWorkgroupSize).toBe(64);
    expect(overlapping.separated).toBe(false);
    expect(overlapping.bestWorkgroupSize).toBeNull();
    // The ordering is still reported, because it is still true.
    expect(overlapping.separationMs).toBe(1);
  });

  it("refuses a best size on a single sample, having nothing to separate from", () => {
    const lone = summariseWorkgroupSweep([{ workgroupSize: 64, timingsMs: [10, 11] }]);
    expect(lone.fastestWorkgroupSize).toBe(64);
    expect(lone.runnerUpWorkgroupSize).toBeNull();
    expect(lone.separationMs).toBeNull();
    expect(lone.separated).toBeNull();
    expect(lone.bestWorkgroupSize).toBeNull();
  });

  it("breaks a median tie by the smaller size, so a rerun does not reorder", () => {
    const tied = summariseWorkgroupSweep([
      { workgroupSize: 64, timingsMs: [10, 10] },
      { workgroupSize: 32, timingsMs: [10, 10] },
    ]);
    expect(tied.rankings.map((r) => r.workgroupSize)).toStrictEqual([32, 64]);
    expect(tied.separationMs).toBe(0);
    expect(tied.bestWorkgroupSize).toBeNull();
  });

  it("rejects inputs that would rank as if they were measurements", () => {
    expect(() => summariseWorkgroupSweep([])).toThrow(/at least one sample/);
    expect(() => summariseWorkgroupSweep([{ workgroupSize: 64, timingsMs: [] }])).toThrow(
      /no timings/,
    );
    expect(() =>
      summariseWorkgroupSweep([
        { workgroupSize: 64, timingsMs: [1] },
        { workgroupSize: 64, timingsMs: [2] },
      ]),
    ).toThrow(/appears twice/);
    expect(() =>
      summariseWorkgroupSweep([{ workgroupSize: 64, timingsMs: [1, Number.NaN] }]),
    ).toThrow(/non-finite/);
    expect(() => summariseWorkgroupSweep([{ workgroupSize: 64, timingsMs: [-1] }])).toThrow(
      /negative/,
    );
    expect(() => summariseWorkgroupSweep([{ workgroupSize: 0, timingsMs: [1] }])).toThrow(
      /positive integer/,
    );
  });
});

describe("classifyAdapter", () => {
  it("has exactly two classes", () => {
    expect([...ADAPTER_CLASSES]).toStrictEqual(["software", "hardware"]);
  });

  it("classifies the adapter this container actually reports as software", () => {
    // Verbatim from `scripts/gpu-rk4-agreement-results.json`, recorded by the
    // 99th run. Note `isFallbackAdapter: null` -- Chromium does not set it, so
    // the fallback flag alone would classify this hardware.
    expect(
      classifyAdapter({
        vendor: "google",
        architecture: "swiftshader",
        description: "",
        isFallbackAdapter: null,
      }),
    ).toBe("software");
  });

  it("recognises the other software renderers a CI runner may present", () => {
    for (const architecture of ["lavapipe", "llvmpipe", "SwiftShader", "WARP"]) {
      expect(classifyAdapter({ vendor: "mesa", architecture })).toBe("software");
    }
    expect(classifyAdapter({ description: "Software Rasterizer" })).toBe("software");
  });

  it("honours an explicit fallback flag whatever the strings say", () => {
    expect(
      classifyAdapter({ vendor: "nvidia", architecture: "ampere", isFallbackAdapter: true }),
    ).toBe("software");
  });

  it("classifies a named hardware adapter as hardware", () => {
    expect(
      classifyAdapter({
        vendor: "nvidia",
        architecture: "ampere",
        description: "NVIDIA GeForce RTX 3080",
        isFallbackAdapter: false,
      }),
    ).toBe("hardware");
    expect(classifyAdapter({ vendor: "apple", architecture: "apple-m1" })).toBe("hardware");
  });

  it("calls an adapter that reports nothing software, not hardware", () => {
    // The asymmetry is the point. Labelling software `hardware` puts a CPU
    // emulation's occupancy curve into the record as evidence about a GPU,
    // which is precisely the failure P7.15's criterion had to be read to
    // avoid. Labelling hardware `software` understates a real result and
    // someone corrects it. An adapter with masking on reports empty strings.
    expect(classifyAdapter({})).toBe("software");
    expect(classifyAdapter({ vendor: "", architecture: "", description: "" })).toBe("software");
    expect(classifyAdapter({ isFallbackAdapter: null })).toBe("software");
  });
});
