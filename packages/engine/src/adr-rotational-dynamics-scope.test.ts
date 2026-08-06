import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLANAR_CHANNELS } from "./planar-projectile-model.js";
import { PLANAR_SPIN_CHANNELS } from "./planar-projectile-spin-model.js";
import { SPATIAL_CHANNELS } from "./spatial-projectile-model.js";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const ADR_PATH = join(SRC_DIR, "../../../docs/adr/ADR-015-rotational-dynamics-scope.md");

/**
 * P4.39's validation criterion is "ADR merged with decision + revisit trigger" -- a
 * documentary claim. These tests make it machine-checked rather than asserted, and then
 * pin the structural property the ADR actually decides, so that adding an attitude state
 * without reopening the ADR fails here instead of passing silently.
 */
describe("ADR-015 rotational-dynamics scope (P4.39)", () => {
  it("the ADR exists and is Accepted", () => {
    expect(existsSync(ADR_PATH)).toBe(true);
    expect(readFileSync(ADR_PATH, "utf8")).toContain("**Status:** Accepted");
  });

  it("carries both halves of the validation criterion: a decision and a revisit trigger", () => {
    const adr = readFileSync(ADR_PATH, "utf8");
    expect(adr).toContain("\n## Decision\n");
    expect(adr).toContain("\n## Revisit trigger\n");
  });

  it("the revisit trigger names concrete conditions, not just a heading", () => {
    const adr = readFileSync(ADR_PATH, "utf8");
    const section = adr.slice(
      adr.indexOf("\n## Revisit trigger\n"),
      adr.indexOf("\n## Consequences\n"),
    );
    // Bulleted conditions, each a distinct re-entry route. Three is what the ADR states;
    // the assertion is >= so adding a fourth trigger later does not fail this test.
    const bullets = section.split("\n").filter((line) => line.startsWith("- **"));
    expect(bullets.length).toBeGreaterThanOrEqual(3);
    expect(section).toContain("M_{\\text{aero}}");
  });

  /**
   * The decision in one executable form: every *projectile* model's state is positions,
   * velocities, and at most a spin *rate* -- never an orientation. The pendulum and Kepler
   * Stage-B models are deliberately excluded: `theta` there is a generalized coordinate of a
   * different system, not projectile attitude.
   */
  it("no projectile model declares an orientation channel", () => {
    const ORIENTATION_NAMES = new Set([
      "q0",
      "q1",
      "q2",
      "q3",
      "qw",
      "qx",
      "qy",
      "qz",
      "quat",
      "roll",
      "pitch",
      "yaw",
      "phi",
      "psi",
      "alpha",
      "attitude",
    ]);
    for (const channels of [PLANAR_CHANNELS, PLANAR_SPIN_CHANNELS, SPATIAL_CHANNELS]) {
      for (const channel of channels) {
        expect(ORIENTATION_NAMES.has(channel.name)).toBe(false);
      }
    }
  });

  it("the only rotational state any projectile model carries is the spin rate omega", () => {
    expect(PLANAR_CHANNELS.map((c) => c.name)).toEqual(["x", "y", "vx", "vy"]);
    expect(SPATIAL_CHANNELS.map((c) => c.name)).toEqual(["x", "y", "z", "vx", "vy", "vz"]);
    expect(PLANAR_SPIN_CHANNELS.map((c) => c.name)).toEqual(["x", "y", "vx", "vy", "omega"]);

    const omega = PLANAR_SPIN_CHANNELS.find((c) => c.name === "omega");
    // rad/s, not rad: a rate, per the ADR's "the spin channel keeps its own name" constraint.
    expect(omega?.unit).toBe("rad/s");
  });
});
