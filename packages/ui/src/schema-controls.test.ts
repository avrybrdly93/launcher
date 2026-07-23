import { describe, expect, it } from "vitest";
import { z } from "zod";
import { generateControlDescriptors, type ControlDescriptor } from "./schema-controls.js";

describe("generateControlDescriptors: field-kind derivation", () => {
  it("a number with both min and max becomes a slider, step from .step()", () => {
    const schema = z.object({
      speed: z.number().min(0).max(150).step(0.5).describe("Launch speed|m/s"),
    });
    const [descriptor] = generateControlDescriptors(schema, { speed: 42 });

    expect(descriptor).toEqual({
      path: "speed",
      kind: "slider",
      label: "Launch speed",
      unit: "m/s",
      value: 42,
      min: 0,
      max: 150,
      step: 0.5,
    });
  });

  it("a number with only one bound (or none) becomes a plain number input, not a slider", () => {
    const schema = z.object({
      mass: z.number().describe("Mass|kg"), // no bounds at all
      offsetOnlyMax: z.number().max(10), // upper bound only
    });
    const descriptors = generateControlDescriptors(schema, { mass: 3, offsetOnlyMax: 7 });

    const mass = descriptors.find((d) => d.path === "mass")!;
    expect(mass.kind).toBe("number");
    expect(mass.min).toBeUndefined();
    expect(mass.max).toBeUndefined();

    const offsetOnlyMax = descriptors.find((d) => d.path === "offsetOnlyMax")!;
    expect(offsetOnlyMax.kind).toBe("number");
  });

  it("an enum becomes a select with the enum's own options", () => {
    const schema = z.object({
      profile: z.enum(["linear", "quadratic", "saturating"]).describe("Lift profile"),
    });
    const [descriptor] = generateControlDescriptors(schema, { profile: "quadratic" });

    expect(descriptor).toEqual({
      path: "profile",
      kind: "select",
      label: "Lift profile",
      value: "quadratic",
      options: ["linear", "quadratic", "saturating"],
    });
  });

  it("a boolean becomes a checkbox", () => {
    const schema = z.object({ enabled: z.boolean().describe("Enabled") });
    const [descriptor] = generateControlDescriptors(schema, { enabled: true });

    expect(descriptor).toEqual({
      path: "enabled",
      kind: "checkbox",
      label: "Enabled",
      value: true,
    });
  });

  it("no .describe() falls back to a humanized field name with no unit", () => {
    const schema = z.object({ maxSteps: z.number().min(1).max(1000) });
    const [descriptor] = generateControlDescriptors(schema, { maxSteps: 200 });

    expect(descriptor!.label).toBe("Max Steps");
    expect(descriptor!.unit).toBeUndefined();
  });

  it("optional and defaulted fields resolve through to their inner type's control", () => {
    const schema = z.object({
      rtol: z.number().min(1e-12).max(1e-2).optional().describe("Relative tolerance"),
      controller: z.enum(["I", "PI"]).default("PI").describe("Controller"),
    });
    const descriptors = generateControlDescriptors(schema, { rtol: undefined, controller: "PI" });

    expect(descriptors.find((d) => d.path === "rtol")?.kind).toBe("slider");
    expect(descriptors.find((d) => d.path === "controller")?.kind).toBe("select");
  });

  it("an unsupported field type (e.g. a nested object) contributes no descriptor", () => {
    const schema = z.object({
      speed: z.number().min(0).max(10),
      nested: z.object({ x: z.number() }),
    });
    const descriptors = generateControlDescriptors(schema, { speed: 5, nested: { x: 1 } });

    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]!.path).toBe("speed");
  });

  it("descriptors are generated in the schema's own declared key order", () => {
    const schema = z.object({
      c: z.number().min(0).max(1),
      a: z.number().min(0).max(1),
      b: z.number().min(0).max(1),
    });
    const descriptors = generateControlDescriptors(schema, { a: 0, b: 0, c: 0 });
    expect(descriptors.map((d) => d.path)).toEqual(["c", "a", "b"]);
  });
});

describe("generateControlDescriptors: adding a mock force with schema yields working controls, zero UI edits (P3.18 validation criterion)", () => {
  /**
   * Simulates "adding a new force" the way a real one (gravity, drag,
   * Magnus, buoyancy) would arrive: a brand-new zod schema describing its
   * tunable parameters, authored with no knowledge of
   * `generateControlDescriptors`'s internals and no corresponding change to
   * this module. If the *same*, already-written generator (exercised above
   * against unrelated schemas) produces fully correct, working descriptors
   * for it, that's "zero UI edits" by construction.
   */
  const mockForceParamsSchema = z.object({
    strength: z.number().min(0).max(100).step(0.5).describe("Strength|N"),
    falloffProfile: z.enum(["linear", "inverse-square"]).describe("Falloff profile"),
    decayEnabled: z.boolean().describe("Enable decay"),
    phaseOffset: z.number().describe("Phase offset|rad"), // unbounded -> plain number, not a slider
  });

  it("every field of the mock force's schema yields a correctly-kinded, correctly-valued control", () => {
    const values = {
      strength: 12.5,
      falloffProfile: "inverse-square",
      decayEnabled: true,
      phaseOffset: 1.57,
    };

    const descriptors = generateControlDescriptors(mockForceParamsSchema, values);
    const byPath = new Map(descriptors.map((d) => [d.path, d] as const));

    expect(descriptors).toHaveLength(4);

    const strength: ControlDescriptor = byPath.get("strength")!;
    expect(strength).toEqual({
      path: "strength",
      kind: "slider",
      label: "Strength",
      unit: "N",
      value: 12.5,
      min: 0,
      max: 100,
      step: 0.5,
    });

    const falloffProfile = byPath.get("falloffProfile")!;
    expect(falloffProfile).toEqual({
      path: "falloffProfile",
      kind: "select",
      label: "Falloff profile",
      value: "inverse-square",
      options: ["linear", "inverse-square"],
    });

    const decayEnabled = byPath.get("decayEnabled")!;
    expect(decayEnabled).toEqual({
      path: "decayEnabled",
      kind: "checkbox",
      label: "Enable decay",
      value: true,
    });

    const phaseOffset = byPath.get("phaseOffset")!;
    expect(phaseOffset.kind).toBe("number");
    expect(phaseOffset.label).toBe("Phase offset");
    expect(phaseOffset.unit).toBe("rad");
    expect(phaseOffset.value).toBe(1.57);
  });
});
