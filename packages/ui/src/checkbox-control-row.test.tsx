import { describe, expect, it, vi } from "vitest";
import type { ControlDescriptor } from "./schema-controls.js";
import { CheckboxControlRow } from "./checkbox-control-row.js";

const DESCRIPTOR: ControlDescriptor = {
  path: "altitudeDependent",
  kind: "checkbox",
  label: "Altitude-dependent g",
  value: false,
};

function fakeChangeEvent(checked: boolean): { currentTarget: { checked: boolean } } {
  return { currentTarget: { checked } };
}

/** `vnode.props.children` is the bare child directly (not an array) when there's exactly one. */
function labelOf(vnode: { props: { children: unknown } }): { props: { children: unknown } } {
  return vnode.props.children as { props: { children: unknown } };
}

function flatChildren(children: unknown): unknown[] {
  return ([] as unknown[]).concat(children).flat(Infinity);
}

describe("CheckboxControlRow", () => {
  it("renders a checkbox input reflecting the descriptor's current value", () => {
    const vnode = CheckboxControlRow({
      descriptor: { ...DESCRIPTOR, value: true },
      onChange: vi.fn(),
    });

    expect(vnode.props["data-testid"]).toBe("control-altitudeDependent");
    const [input, labelText] = flatChildren(labelOf(vnode).props.children) as [
      { type: string; props: { type: string; checked: boolean } },
      string,
    ];

    expect(input.type).toBe("input");
    expect(input.props.type).toBe("checkbox");
    expect(input.props.checked).toBe(true);
    expect(labelText).toBe("Altitude-dependent g");
  });

  it("a non-true descriptor value renders unchecked", () => {
    const vnode = CheckboxControlRow({ descriptor: DESCRIPTOR, onChange: vi.fn() });
    const [input] = flatChildren(labelOf(vnode).props.children) as [
      { props: { checked: boolean } },
    ];
    expect(input.props.checked).toBe(false);
  });

  it("toggling the checkbox commits the new checked state", () => {
    const onChange = vi.fn();
    const vnode = CheckboxControlRow({ descriptor: DESCRIPTOR, onChange });
    const [input] = flatChildren(labelOf(vnode).props.children) as [
      { props: { onChange: (e: unknown) => void } },
    ];

    input.props.onChange(fakeChangeEvent(true));
    expect(onChange).toHaveBeenCalledWith(true);

    input.props.onChange(fakeChangeEvent(false));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
