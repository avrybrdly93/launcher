import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Every SolverKit {@link Stepper} implementation (P2.51: "each stepper links its
 * derivation"). Steppers sharing a file (e.g. the two `EmbeddedRKStepper` tableaux) each
 * still get their own co-located page, since they derive from different order conditions.
 */
const STEPPER_SOURCE_FILES = [
  "explicit-euler-stepper",
  "semi-implicit-euler-stepper",
  "heun-rk2-stepper",
  "midpoint-rk2-stepper",
  "classical-rk4-stepper",
  "bogacki-shampine-32",
  "dormand-prince-54",
  "verlet-stepper",
  "backward-euler-stepper",
];

describe("stepper derivation pages (P2.51)", () => {
  for (const name of STEPPER_SOURCE_FILES) {
    it(`${name}.ts links a co-located derivation page that exists`, () => {
      const sourcePath = join(SRC_DIR, `${name}.ts`);
      const derivationPath = join(SRC_DIR, `${name}.derivation.md`);
      const source = readFileSync(sourcePath, "utf8");

      expect(existsSync(derivationPath)).toBe(true);
      expect(source).toContain(`(./${name}.derivation.md)`);
    });
  }

  it("typedoc.json wires every derivation page in via projectDocuments", () => {
    const typedocConfig = readFileSync(join(SRC_DIR, "../typedoc.json"), "utf8");
    expect(JSON.parse(typedocConfig).projectDocuments).toContain("src/*.derivation.md");
  });
});
