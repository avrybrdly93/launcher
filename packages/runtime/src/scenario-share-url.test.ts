import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PRESET_SCENARIOS, SchemaValidationError, type ScenarioSpec } from "@ballista/engine";
import {
  HermiteDenseOutputStepper,
  TrajectoryRecorder,
  integrate,
  type Trajectory,
} from "@ballista/solverkit";
import {
  buildShareUrl,
  decodeScenarioFromShareFragment,
  encodeScenarioToShareFragment,
  parseShareUrl,
} from "./scenario-share-url.js";
import { resolveModel, resolveSolverConfig, resolveStepper } from "./scenario-resolver.js";

/** SHA-256 over every buffer backing a `Trajectory` (§2.6's determinism contract, mirrors `solverkit/src/determinism.test.ts`'s `hashTrajectory`). */
function hashTrajectory(trajectory: Trajectory): string {
  const hash = createHash("sha256");
  hash.update(Buffer.from(trajectory.t.buffer, trajectory.t.byteOffset, trajectory.t.byteLength));
  for (const channel of trajectory.channels) {
    hash.update(Buffer.from(channel.buffer, channel.byteOffset, channel.byteLength));
  }
  return hash.digest("hex");
}

/** Resolves `spec` into a live Model/EvalContext/Stepper and integrates it to a frozen `Trajectory`. */
function solve(spec: ScenarioSpec): Trajectory {
  const { model, ctx, y0 } = resolveModel(spec);
  const stepper = new HermiteDenseOutputStepper(resolveStepper(spec.solver.stepper));
  const cfg = resolveSolverConfig(spec);
  const recorder = new TrajectoryRecorder();
  const report = integrate(model, ctx, y0, [0, 5], cfg, stepper, [recorder]);
  expect(report.status).toBe("ok");
  return recorder.trajectory;
}

describe("encodeScenarioToShareFragment / decodeScenarioFromShareFragment", () => {
  it("round-trips every preset scenario bit-equal", async () => {
    for (const spec of PRESET_SCENARIOS) {
      const fragment = await encodeScenarioToShareFragment(spec);
      const decoded = await decodeScenarioFromShareFragment(fragment);
      expect(decoded).toEqual(spec);
    }
  });

  it("produces a URL-safe string: no '+', '/', or '=' characters", async () => {
    const fragment = await encodeScenarioToShareFragment(PRESET_SCENARIOS[0]!);
    expect(fragment).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("actually compresses -- the encoded fragment is smaller than the raw JSON for a non-trivial scenario", async () => {
    const spec = PRESET_SCENARIOS[0]!;
    const fragment = await encodeScenarioToShareFragment(spec);
    expect(fragment.length).toBeLessThan(JSON.stringify(spec).length);
  });

  it("rejects a corrupt fragment", async () => {
    await expect(decodeScenarioFromShareFragment("not-a-valid-fragment!!!")).rejects.toThrow();
  });
});

describe("buildShareUrl / parseShareUrl (P3.32 validation criterion: URL round-trip reproduces trajectory hash)", () => {
  it("a scenario encoded into a share URL and decoded back out integrates to the bit-identical trajectory (identical SHA-256 hash)", async () => {
    const original =
      PRESET_SCENARIOS.find((s) => s.projectile.id === "golf-ball") ?? PRESET_SCENARIOS[0]!;

    const url = await buildShareUrl("https://ballista.example/app", original);
    const decoded = await parseShareUrl(url);
    expect(decoded).not.toBeNull();
    expect(decoded).toEqual(original);

    const originalHash = hashTrajectory(solve(original));
    const decodedHash = hashTrajectory(solve(decoded!));
    expect(decodedHash).toBe(originalHash);
  });

  it("holds for every preset scenario, not just one", async () => {
    for (const spec of PRESET_SCENARIOS) {
      const url = await buildShareUrl("https://ballista.example/app", spec);
      const decoded = await parseShareUrl(url);
      expect(hashTrajectory(solve(decoded!))).toBe(hashTrajectory(solve(spec)));
    }
  });

  it("preserves the base URL's origin and path, only replacing the fragment", async () => {
    const url = await buildShareUrl("https://ballista.example/app?foo=bar", PRESET_SCENARIOS[0]!);
    expect(url.startsWith("https://ballista.example/app?foo=bar#s=")).toBe(true);
  });

  it("parseShareUrl returns null when the URL has no share fragment", async () => {
    expect(await parseShareUrl("https://ballista.example/app")).toBeNull();
    expect(await parseShareUrl("https://ballista.example/app#unrelated=1")).toBeNull();
  });

  it("parseShareUrl returns null (not a throw) for a corrupt share fragment", async () => {
    expect(await parseShareUrl("https://ballista.example/app#s=not-valid-base64url!!!")).toBeNull();
  });

  it("rejects a fragment whose decoded payload fails schema validation, at the decode level (not silently)", async () => {
    const invalid = { ...PRESET_SCENARIOS[0]!, schemaVersion: 999 };
    const fragment = await encodeScenarioToShareFragment(invalid as never);
    await expect(decodeScenarioFromShareFragment(fragment)).rejects.toThrow(SchemaValidationError);
  });
});
