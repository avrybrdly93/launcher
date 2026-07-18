import type { ButcherTableau } from "./explicit-rk-kernel.js";

/**
 * One rooted-tree order condition (§4.4, eq. 4.7): a stored tableau has
 * order $p$ only if every condition with `treeOrder <= p` is satisfied.
 * `value` is the tableau's measured left-hand side; `target` is the
 * right-hand side $1/\gamma(\tau)$.
 */
export interface OrderCondition {
  readonly treeOrder: number;
  readonly name: string;
  readonly target: number;
  readonly value: number;
  readonly satisfied: boolean;
}

/** `a_{ij}$, treating the tableau's ragged, strictly-lower-triangular storage as 0 for `j >= i`. */
function aEntry(tableau: ButcherTableau, i: number, j: number): number {
  const row = tableau.a[i];
  return row && j < row.length ? row[j]! : 0;
}

/**
 * Numerically evaluates the 8 rooted-tree order conditions of eq. (4.7) for
 * trees $|\tau| \le 4$ against a {@link ButcherTableau} -- the one order-1
 * tree, one order-2, two order-3, and four order-4 trees the blueprint
 * enumerates explicitly. Order-5 conditions (9 further trees) aren't given a
 * closed form in the blueprint text and aren't needed until P2.24's
 * DOPRI5 lands, so they're out of scope here; a tableau claiming order 5
 * can only be checked up to `treeOrder 4` by this function. Returns all 8
 * regardless of the tableau's own claimed order -- {@link verifiesOrder}
 * is what filters by a target order.
 */
export function checkOrderConditions(tableau: ButcherTableau, tol = 1e-9): OrderCondition[] {
  const stages = tableau.c.length;
  const { b, c } = tableau;

  let sumB = 0;
  let sumBC = 0;
  let sumBC2 = 0;
  let sumBC3 = 0;
  let sumBAC = 0;
  let sumBCAC = 0;
  let sumBAC2 = 0;
  let sumBAAC = 0;

  for (let i = 0; i < stages; i++) {
    const bi = b[i]!;
    const ci = c[i]!;
    sumB += bi;
    sumBC += bi * ci;
    sumBC2 += bi * ci * ci;
    sumBC3 += bi * ci * ci * ci;

    for (let j = 0; j < stages; j++) {
      const aij = aEntry(tableau, i, j);
      if (aij === 0) continue;
      const cj = c[j]!;
      sumBAC += bi * aij * cj;
      sumBCAC += bi * ci * aij * cj;
      sumBAC2 += bi * aij * cj * cj;

      for (let l = 0; l < stages; l++) {
        const ajl = aEntry(tableau, j, l);
        if (ajl === 0) continue;
        sumBAAC += bi * aij * ajl * c[l]!;
      }
    }
  }

  const conditions: readonly [number, string, number, number][] = [
    [1, "sum b_i = 1", sumB, 1],
    [2, "sum b_i c_i = 1/2", sumBC, 1 / 2],
    [3, "sum b_i c_i^2 = 1/3", sumBC2, 1 / 3],
    [3, "sum b_i a_ij c_j = 1/6", sumBAC, 1 / 6],
    [4, "sum b_i c_i^3 = 1/4", sumBC3, 1 / 4],
    [4, "sum b_i c_i a_ij c_j = 1/8", sumBCAC, 1 / 8],
    [4, "sum b_i a_ij c_j^2 = 1/12", sumBAC2, 1 / 12],
    [4, "sum b_i a_ij a_jl c_l = 1/24", sumBAAC, 1 / 24],
  ];

  return conditions.map(([treeOrder, name, value, target]) => ({
    treeOrder,
    name,
    target,
    value,
    satisfied: Math.abs(value - target) <= tol,
  }));
}

/**
 * Whether `tableau` satisfies every order condition for trees up to
 * `claimedOrder` (clamped to the 4 orders {@link checkOrderConditions}
 * covers) -- i.e. whether it is numerically consistent with being an
 * order-`claimedOrder` method.
 */
export function verifiesOrder(tableau: ButcherTableau, claimedOrder: number, tol = 1e-9): boolean {
  return checkOrderConditions(tableau, tol)
    .filter((condition) => condition.treeOrder <= claimedOrder)
    .every((condition) => condition.satisfied);
}
