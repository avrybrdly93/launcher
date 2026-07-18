import { describe, expect, it } from "vitest";
import {
  EULER_TABLEAU,
  HEUN_TABLEAU,
  MIDPOINT_TABLEAU,
  RK4_TABLEAU,
  type ButcherTableau,
} from "./explicit-rk-kernel.js";
import { checkOrderConditions, verifiesOrder } from "./order-condition-checker.js";

describe("checkOrderConditions / verifiesOrder (P2.14)", () => {
  it("RK4 passes all 8 order-4 conditions (eq. 4.7)", () => {
    const conditions = checkOrderConditions(RK4_TABLEAU);
    expect(conditions).toHaveLength(8);
    expect(conditions.filter((c) => c.satisfied)).toHaveLength(8);
    expect(verifiesOrder(RK4_TABLEAU, 4)).toBe(true);
  });

  it("Euler passes only the order-1 condition", () => {
    const conditions = checkOrderConditions(EULER_TABLEAU);
    const order1 = conditions.filter((c) => c.treeOrder === 1);
    const higher = conditions.filter((c) => c.treeOrder > 1);
    expect(order1.every((c) => c.satisfied)).toBe(true);
    expect(higher.some((c) => !c.satisfied)).toBe(true);
    expect(verifiesOrder(EULER_TABLEAU, 1)).toBe(true);
    expect(verifiesOrder(EULER_TABLEAU, 2)).toBe(false);
  });

  it("midpoint and Heun pass order-1/2 conditions but not order-3/4", () => {
    for (const tableau of [MIDPOINT_TABLEAU, HEUN_TABLEAU]) {
      expect(verifiesOrder(tableau, 2)).toBe(true);
      expect(verifiesOrder(tableau, 4)).toBe(false);

      const conditions = checkOrderConditions(tableau);
      const upToOrder2 = conditions.filter((c) => c.treeOrder <= 2);
      const above = conditions.filter((c) => c.treeOrder > 2);
      expect(upToOrder2.every((c) => c.satisfied)).toBe(true);
      expect(above.some((c) => !c.satisfied)).toBe(true);
    }
  });

  it("a corrupted RK4 tableau is caught", () => {
    const corrupted: ButcherTableau = {
      c: RK4_TABLEAU.c,
      a: RK4_TABLEAU.a,
      b: [1 / 6, 1 / 3, 1 / 3 + 1e-3, 1 / 6],
    };

    expect(verifiesOrder(corrupted, 4)).toBe(false);
    const conditions = checkOrderConditions(corrupted);
    expect(conditions.some((c) => !c.satisfied)).toBe(true);
  });

  it("reports the exact target for each condition", () => {
    const conditions = checkOrderConditions(RK4_TABLEAU);
    const targets = conditions.map((c) => c.target);
    expect(targets).toEqual([1, 0.5, 1 / 3, 1 / 6, 1 / 4, 1 / 8, 1 / 12, 1 / 24]);
  });
});
