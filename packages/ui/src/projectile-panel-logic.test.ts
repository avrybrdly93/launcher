import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS, type ProjectileSpec } from "@ballista/engine";
import {
  CUSTOM_PROJECTILE_ID,
  findProjectilePreset,
  hasEditableDragCoefficient,
  toCustomProjectileSpec,
} from "./projectile-panel-logic.js";

describe("findProjectilePreset", () => {
  it("finds every catalog preset by its own id", () => {
    for (const preset of PROJECTILE_ASSETS) {
      expect(findProjectilePreset(preset.id)).toEqual(preset);
    }
  });

  it("returns undefined for the custom id and for an unknown id", () => {
    expect(findProjectilePreset(CUSTOM_PROJECTILE_ID)).toBeUndefined();
    expect(findProjectilePreset("not-a-real-preset")).toBeUndefined();
  });
});

describe("toCustomProjectileSpec: custom persists in draft (P3.20 validation criterion)", () => {
  const golfBall = PROJECTILE_ASSETS.find((p) => p.id === "golf-ball")!;

  it("carries over mass/radius/dragModel/liftModel from the current spec, changing only id/name/provenance", () => {
    const custom = toCustomProjectileSpec(golfBall);

    expect(custom.id).toBe(CUSTOM_PROJECTILE_ID);
    expect(custom.name).toBe("Custom");
    expect(custom.mass).toBe(golfBall.mass);
    expect(custom.radius).toBe(golfBall.radius);
    expect(custom.dragModel).toEqual(golfBall.dragModel);
    expect(custom.liftModel).toEqual(golfBall.liftModel);
    expect(custom.provenance).not.toBe(golfBall.provenance);
  });

  it("is idempotent-safe: re-customizing an already-custom spec keeps its (possibly edited) mass/radius", () => {
    const custom = toCustomProjectileSpec(golfBall);
    const editedCustom: ProjectileSpec = { ...custom, mass: 0.05 };

    const reCustomized = toCustomProjectileSpec(editedCustom);
    expect(reCustomized.mass).toBe(0.05);
    expect(reCustomized.id).toBe(CUSTOM_PROJECTILE_ID);
  });
});

describe("hasEditableDragCoefficient", () => {
  it("is true for a constant drag model", () => {
    expect(hasEditableDragCoefficient({ kind: "constant", cd: 0.3 })).toBe(true);
  });

  it("is false for a tabulated-Reynolds drag model (no single Cd to expose)", () => {
    const smoothSphere = PROJECTILE_ASSETS.find((p) => p.dragModel.kind === "tabulated-reynolds")!;
    expect(hasEditableDragCoefficient(smoothSphere.dragModel)).toBe(false);
  });
});
