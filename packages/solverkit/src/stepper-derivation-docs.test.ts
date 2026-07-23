import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  STEPPER_DERIVATION_DOCS,
  stepperDerivationDoc,
  BackwardEulerStepper,
  ClassicalRK4Stepper,
  ExplicitEulerStepper,
  HeunRK2Stepper,
  MidpointRK2Stepper,
  SemiImplicitEulerStepper,
  VerletStepper,
  createBogackiShampine32Stepper,
  createDormandPrince54Stepper,
} from "./index.js";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

describe("STEPPER_DERIVATION_DOCS", () => {
  it("every mapped filename exists on disk (stays in sync with docs-derivation-links.test.ts's own files)", () => {
    for (const filename of Object.values(STEPPER_DERIVATION_DOCS)) {
      expect(existsSync(join(SRC_DIR, filename))).toBe(true);
    }
  });

  it("every real Stepper's info.id resolves to a doc", () => {
    const steppers = [
      new ExplicitEulerStepper(),
      new SemiImplicitEulerStepper(),
      new HeunRK2Stepper(),
      new MidpointRK2Stepper(),
      new ClassicalRK4Stepper(),
      createBogackiShampine32Stepper(),
      createDormandPrince54Stepper(),
      new VerletStepper("velocity"),
      new VerletStepper("position"),
      new BackwardEulerStepper(),
    ];
    for (const stepper of steppers) {
      expect(stepperDerivationDoc(stepper.info.id)).toBeDefined();
    }
  });

  it("returns undefined for an unknown id", () => {
    expect(stepperDerivationDoc("not-a-real-stepper")).toBeUndefined();
  });
});
