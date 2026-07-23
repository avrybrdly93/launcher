/**
 * The Launch control group's own schema (§6.3 panel group 1: "v₀ (0–150
 * m/s), θ (0–90°), height, spin ω (±500 rad/s)"; P3.19). A plain zod
 * schema, not a bespoke UI form definition -- `LaunchPanel` derives its
 * controls from this via `generateControlDescriptors` (P3.18), so this
 * file is the *only* place these ranges/units/labels live.
 */

import { z } from "zod";

export const launchSpecSchema = z.object({
  v0: z.number().min(0).max(150).step(0.1).describe("Launch speed v₀|m/s"),
  theta: z.number().min(0).max(90).step(0.1).describe("Launch angle θ|deg"),
  y0: z.number().min(0).max(100).step(0.1).describe("Launch height y₀|m"),
  omega: z.number().min(-500).max(500).step(1).describe("Spin ω|rad/s"),
});

/** Parsed type of {@link launchSpecSchema}. */
export type LaunchSpec = z.infer<typeof launchSpecSchema>;
