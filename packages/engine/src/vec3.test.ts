import { describe, expect, it } from "vitest";
import {
  add,
  cross,
  dot,
  norm,
  normSq,
  scale,
  sub,
  zero,
  type MutVec3,
  type Vec3,
} from "./vec3.js";

describe("vec3", () => {
  it("add/sub/scale match componentwise arithmetic", () => {
    const a: Vec3 = [1, 2, 3];
    const b: Vec3 = [4, -5, 6];
    const out: MutVec3 = [0, 0, 0];

    expect(add(a, b, out)).toEqual([5, -3, 9]);
    expect(sub(a, b, out)).toEqual([-3, 7, -3]);
    expect(scale(a, 2, out)).toEqual([2, 4, 6]);
    expect(scale(a, 0, out)).toEqual([0, 0, 0]);
  });

  it("add/sub/scale write into and return the same `out` array (no allocation)", () => {
    const a: Vec3 = [1, 2, 3];
    const b: Vec3 = [4, 5, 6];
    const out: MutVec3 = [0, 0, 0];
    expect(add(a, b, out)).toBe(out);
  });

  it("dot product matches the standard formula, including orthogonal basis vectors", () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(1 * 4 + 2 * 5 + 3 * 6);
    expect(dot([1, 0, 0], [0, 1, 0])).toBe(0);
    expect(dot([2, 0, 0], [3, 0, 0])).toBe(6);
  });

  it("cross of standard basis vectors follows the right-hand rule", () => {
    const out: MutVec3 = [0, 0, 0];
    const ex: Vec3 = [1, 0, 0];
    const ey: Vec3 = [0, 1, 0];
    const ez: Vec3 = [0, 0, 1];

    expect(cross(ex, ey, out)).toEqual([0, 0, 1]); // e_x x e_y = e_z
    expect(cross(ey, ez, out)).toEqual([1, 0, 0]); // e_y x e_z = e_x
    expect(cross(ez, ex, out)).toEqual([0, 1, 0]); // e_z x e_x = e_y

    // Antisymmetry: swapping operands flips the sign.
    expect(cross(ey, ex, out)).toEqual([0, 0, -1]);
  });

  it("cross(e_z, v) with v=(vx,vy,0) reduces to (-vy, vx, 0), matching MagnusForce's e_z convention", () => {
    const out: MutVec3 = [0, 0, 0];
    const ez: Vec3 = [0, 0, 1];
    const v: Vec3 = [3, 7, 0];
    expect(cross(ez, v, out)).toEqual([-7, 3, 0]);
  });

  it("cross product of a vector with itself is zero", () => {
    const out: MutVec3 = [0, 0, 0];
    expect(cross([1, 2, 3], [1, 2, 3], out)).toEqual([0, 0, 0]);
  });

  it("cross product magnitude matches |a||b|sin(theta) for perpendicular unit vectors", () => {
    const out: MutVec3 = [0, 0, 0];
    cross([1, 0, 0], [0, 1, 0], out);
    expect(norm(out)).toBeCloseTo(1, 15);
  });

  it("norm and normSq are consistent and match Pythagoras in 3D", () => {
    const a: Vec3 = [3, 4, 12];
    expect(normSq(a)).toBe(3 * 3 + 4 * 4 + 12 * 12);
    expect(norm(a)).toBeCloseTo(13, 15);
    expect(norm(a) * norm(a)).toBeCloseTo(normSq(a), 12);
  });

  it("zero() returns a fresh (3,) zero vector each call", () => {
    const z1 = zero();
    const z2 = zero();
    expect(z1).toEqual([0, 0, 0]);
    expect(z1).not.toBe(z2);
  });
});
