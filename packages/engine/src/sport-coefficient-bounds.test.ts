import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";

/**
 * P4.05 validation criterion: sport data-asset Cd/Cl values fall within the
 * literature ranges asserted in each asset's `provenance` citation (§3.3
 * option 3, §3.6). Schema validity and non-empty provenance are already
 * covered by projectile-spec.test.ts; this file checks the actual numbers.
 */
const LITERATURE_CD_RANGE: Record<string, readonly [number, number]> = {
  "golf-ball": [0.2, 0.3], // Bearman & Harvey (1976)
  "soccer-ball": [0.2, 0.3], // Asai et al. (2007)
  baseball: [0.3, 0.4], // Adair (2002)
};

const LITERATURE_MAX_CL_RANGE: Record<string, readonly [number, number]> = {
  "golf-ball": [0.5, 0.7], // blueprint eq. (3.16) default saturating fit
  "soccer-ball": [0.2, 0.4], // Asai et al. (2007)
  baseball: [0.2, 0.5], // Watts & Ferrer (1987)
};

function assetById(id: string) {
  const asset = PROJECTILE_ASSETS.find((a) => a.id === id);
  if (asset === undefined) throw new Error(`no projectile asset "${id}"`);
  return asset;
}

describe("sport Cd/Cl data assets (P4.05)", () => {
  for (const [id, [lo, hi]] of Object.entries(LITERATURE_CD_RANGE)) {
    it(`${id}: constant Cd is within its cited literature range [${lo}, ${hi}]`, () => {
      const { dragModel } = assetById(id);
      expect(dragModel.kind).toBe("constant");
      if (dragModel.kind !== "constant") return;
      expect(dragModel.cd).toBeGreaterThanOrEqual(lo);
      expect(dragModel.cd).toBeLessThanOrEqual(hi);
    });
  }

  for (const [id, [lo, hi]] of Object.entries(LITERATURE_MAX_CL_RANGE)) {
    it(`${id}: saturating-fit max Cl is within its cited literature range [${lo}, ${hi}]`, () => {
      const { liftModel } = assetById(id);
      expect(liftModel?.kind).toBe("saturating");
      if (liftModel?.kind !== "saturating") return;
      expect(liftModel.maxCl).toBeGreaterThanOrEqual(lo);
      expect(liftModel.maxCl).toBeLessThanOrEqual(hi);
    });
  }

  it("every sport asset (golf, soccer, baseball) carries a non-empty provenance citation", () => {
    for (const id of ["golf-ball", "soccer-ball", "baseball"]) {
      expect(assetById(id).provenance.length).toBeGreaterThan(20);
    }
  });
});
