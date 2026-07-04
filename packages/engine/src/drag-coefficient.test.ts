import { describe, expect, it } from "vitest";
import { ConstantCd, TabulatedReynoldsCd } from "./drag-coefficient.js";

describe("ConstantCd", () => {
  it("returns 0.47 by default", () => {
    expect(new ConstantCd().cd(1e5, 0.1)).toBe(0.47);
  });
});

describe("TabulatedReynoldsCd", () => {
  const model = new TabulatedReynoldsCd();

  it("matches the subcritical smooth-sphere value near Re=1e3 within 10%", () => {
    const cd = model.cd(1e3, 0);
    expect(Math.abs(cd - 0.47) / 0.47).toBeLessThan(0.1);
  });

  it("drops below 0.2 past the drag crisis at Re=4e5", () => {
    expect(model.cd(4e5, 0)).toBeLessThan(0.2);
  });

  it("is C1-continuous: finite-difference slope agrees on both sides of an interior knot", () => {
    const re0 = 3e5;
    const eps = 1;
    const left = (model.cd(re0, 0) - model.cd(re0 - eps, 0)) / eps;
    const right = (model.cd(re0 + eps, 0) - model.cd(re0, 0)) / eps;
    expect(Math.abs(left - right)).toBeLessThan(1e-3);
  });
});
