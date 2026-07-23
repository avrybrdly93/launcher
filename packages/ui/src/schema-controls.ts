/**
 * Schema-driven control generation (§6.3 "generated from schemas where
 * possible"; P3.18). `generateControlDescriptors` walks a zod object
 * schema's own shape and derives a widget for each field entirely from
 * what the schema itself already declares -- no parallel per-field UI
 * registry to keep in sync:
 *
 * - `z.number().min(a).max(b)` -> a **slider** (bounds needed to draw a
 *   track); `.step()`/`.multipleOf()` sets its step. A number with only
 *   one or neither bound -> a plain **number** input.
 * - `z.enum([...])` -> a **select**, options read straight from the enum.
 * - `z.boolean()` -> a **checkbox**.
 * - `.describe("Label|unit")` supplies the human label and (optionally,
 *   after the `|`) a display unit; omitted entirely falls back to a
 *   humanized field name with no unit.
 * - `.optional()`/`.default(...)` wrappers are unwrapped transparently, so
 *   an optional/defaulted field gets the same control its inner type would.
 *
 * This is what makes "adding a mock force with schema yields working
 * controls, zero UI edits" (this task's validation criterion) true by
 * construction: a brand-new schema authored *after* this module is written
 * flows through the same unmodified `generateControlDescriptors` -- there
 * is no per-force/per-field switch anywhere in the UI layer to extend.
 * Rendering those descriptors into actual DOM widgets is a later Phase 3
 * task (P3.19+); this module's scope stops at the framework-agnostic
 * descriptor data those renderers will consume.
 */

import { z } from "zod";

/** The widget kind a field's zod type determines (see module docs for the derivation rules). */
export type ControlKind = "slider" | "number" | "select" | "checkbox";

/** One field's fully-resolved, renderer-agnostic control description. */
export interface ControlDescriptor {
  /** The schema's field key -- also this control's identity for a caller writing values back. */
  readonly path: string;
  readonly kind: ControlKind;
  readonly label: string;
  readonly unit?: string;
  /** The field's current value, read from the `values` bag passed to {@link generateControlDescriptors}. */
  readonly value: unknown;
  /** Slider/number only, from `.min()`. */
  readonly min?: number;
  /** Slider/number only, from `.max()`. */
  readonly max?: number;
  /** Slider/number only, from `.step()`/`.multipleOf()`. */
  readonly step?: number;
  /** Select only, the enum's own literal values in declared order. */
  readonly options?: readonly string[];
}

/** Strips `.optional()`/`.default(...)` wrappers to reach the field's underlying type -- both are common on schema fields but carry no control-relevant information of their own. */
function unwrapField(field: z.ZodTypeAny): z.ZodTypeAny {
  let current = field;
  for (;;) {
    if (current instanceof z.ZodOptional) {
      current = current.unwrap();
    } else if (current instanceof z.ZodDefault) {
      current = current.removeDefault();
    } else {
      return current;
    }
  }
}

/** `"maxSteps"` -> `"Max Steps"`: the fallback label when a field carries no `.describe()`. */
function humanizeFieldName(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Splits a `.describe("Label|unit")` string into its label and optional unit; no description at all falls back to a humanized field name. */
function resolveLabelAndUnit(
  description: string | undefined,
  key: string,
): { readonly label: string; readonly unit?: string } {
  if (!description) return { label: humanizeFieldName(key) };
  const separatorIndex = description.indexOf("|");
  if (separatorIndex === -1) return { label: description };
  return {
    label: description.slice(0, separatorIndex).trim(),
    unit: description.slice(separatorIndex + 1).trim(),
  };
}

/** The `multipleOf` check's value, if `field` declares one (`.step()`/`.multipleOf()` are the same check under the hood). */
function stepOf(field: z.ZodNumber): number | undefined {
  const check = field._def.checks.find((c) => c.kind === "multipleOf");
  return check?.value;
}

/**
 * Derives one field's {@link ControlDescriptor}, or `undefined` for a zod
 * type this v1 generator doesn't map to a control (e.g. nested objects,
 * strings, arrays) -- skipped rather than guessed at, matching this
 * module's "no per-field special-casing" contract by not silently
 * inventing an unsupported one either.
 */
function describeField(
  key: string,
  rawField: z.ZodTypeAny,
  value: unknown,
): ControlDescriptor | undefined {
  const field = unwrapField(rawField);
  const { label, unit } = resolveLabelAndUnit(field.description, key);
  const unitProp = unit !== undefined ? { unit } : {};

  if (field instanceof z.ZodEnum) {
    return { path: key, kind: "select", label, ...unitProp, value, options: field.options };
  }
  if (field instanceof z.ZodBoolean) {
    return { path: key, kind: "checkbox", label, ...unitProp, value };
  }
  if (field instanceof z.ZodNumber) {
    const min = field.minValue ?? undefined;
    const max = field.maxValue ?? undefined;
    const step = stepOf(field);
    const kind: ControlKind = min !== undefined && max !== undefined ? "slider" : "number";
    return {
      path: key,
      kind,
      label,
      ...unitProp,
      value,
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(step !== undefined ? { step } : {}),
    };
  }
  return undefined;
}

/**
 * Generates one {@link ControlDescriptor} per supported field of `schema`,
 * in the schema's own declared key order, with each control's current
 * value read from `values[key]`. A field whose zod type isn't one of
 * number/enum/boolean (see {@link describeField}) contributes no
 * descriptor rather than a broken or guessed-at one.
 */
export function generateControlDescriptors(
  schema: z.ZodObject<z.ZodRawShape>,
  values: Readonly<Record<string, unknown>>,
): readonly ControlDescriptor[] {
  const descriptors: ControlDescriptor[] = [];
  for (const [key, rawField] of Object.entries(schema.shape)) {
    const descriptor = describeField(key, rawField, values[key]);
    if (descriptor) descriptors.push(descriptor);
  }
  return descriptors;
}
