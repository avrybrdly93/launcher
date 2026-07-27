import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";

/** Looks up a sport asset by id, failing loudly if the library shape changes. */
function asset(id: string) {
  const found = PROJECTILE_ASSETS.find((a) => a.id === id);
  if (found === undefined) throw new Error(`expected projectile asset '${id}' in library`);
  return found;
}

/** Reads the scalar Cd for a "constant" drag model (all three sport assets use this kind). */
function constantCd(spec: ReturnType<typeof asset>): number {
  if (spec.dragModel.kind !== "constant")
    throw new Error(`expected constant drag model for '${spec.id}'`);
  return spec.dragModel.cd;
}

/** Reads (maxCl, slope) for a "saturating" lift model. */
function saturatingLift(spec: ReturnType<typeof asset>): { maxCl: number; slope: number } {
  if (spec.liftModel === undefined || spec.liftModel.kind !== "saturating") {
    throw new Error(`expected saturating lift model for '${spec.id}'`);
  }
  return { maxCl: spec.liftModel.maxCl, slope: spec.liftModel.slope };
}

describe("P4.05: sport Cd/CL data assets fall within published literature ranges", () => {
  it("golf ball: Cd in [0.2, 0.3] per Bearman & Harvey (1976)", () => {
    const cd = constantCd(asset("golf-ball"));
    expect(cd).toBeGreaterThanOrEqual(0.2);
    expect(cd).toBeLessThanOrEqual(0.3);
  });

  it("golf ball: CL(S) saturates at maxCl in [0.4, 0.7] per eq. (3.16)", () => {
    const { maxCl, slope } = saturatingLift(asset("golf-ball"));
    expect(maxCl).toBeGreaterThanOrEqual(0.4);
    expect(maxCl).toBeLessThanOrEqual(0.7);
    expect(slope).toBeGreaterThan(0);
  });

  it("soccer ball: Cd in [0.2, 0.3] per Asai et al. (2007)", () => {
    const cd = constantCd(asset("soccer-ball"));
    expect(cd).toBeGreaterThanOrEqual(0.2);
    expect(cd).toBeLessThanOrEqual(0.3);
  });

  it("soccer ball: CL(S) saturates at maxCl in [0.2, 0.4] per Asai et al. (2007) / Bray & Kelley (2003)", () => {
    const { maxCl, slope } = saturatingLift(asset("soccer-ball"));
    expect(maxCl).toBeGreaterThanOrEqual(0.2);
    expect(maxCl).toBeLessThanOrEqual(0.4);
    expect(slope).toBeGreaterThan(0);
  });

  it("baseball: Cd in [0.3, 0.4] per Adair (2002)", () => {
    const cd = constantCd(asset("baseball"));
    expect(cd).toBeGreaterThanOrEqual(0.3);
    expect(cd).toBeLessThanOrEqual(0.4);
  });

  it("baseball: CL(S) saturates at maxCl in [0.2, 0.4] per Nathan (2008)", () => {
    const { maxCl, slope } = saturatingLift(asset("baseball"));
    expect(maxCl).toBeGreaterThanOrEqual(0.2);
    expect(maxCl).toBeLessThanOrEqual(0.4);
    expect(slope).toBeGreaterThan(0);
  });

  it("all three sport balls carry a non-empty provenance citation distinct from the generic default", () => {
    for (const id of ["golf-ball", "soccer-ball", "baseball"]) {
      const spec = asset(id);
      expect(spec.provenance.length).toBeGreaterThan(40);
      expect(spec.liftModel).toBeDefined();
    }
  });
});
