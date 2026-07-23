import { describe, expect, it, vi } from "vitest";
import type { ControlDescriptor } from "./schema-controls.js";
import { NumericControlRow } from "./numeric-control-row.js";

const SLIDER_DESCRIPTOR: ControlDescriptor = {
  path: "v0",
  kind: "slider",
  label: "Launch speed v₀",
  unit: "m/s",
  value: 50,
  min: 0,
  max: 150,
  step: 0.1,
};

/** A synthetic input/keyboard event: just enough shape for the handlers under test, cast at the call site (mirrors how app-shell.test.tsx drives vnodes directly rather than mounting to a real DOM). */
function fakeInputEvent(value: number): { currentTarget: { value: string } } {
  return { currentTarget: { value: String(value) } };
}
function fakeKeyEvent(
  key: string,
  shiftKey: boolean,
): { key: string; shiftKey: boolean; preventDefault: () => void; currentTarget: unknown } {
  return { key, shiftKey, preventDefault: vi.fn(), currentTarget: {} };
}

describe("NumericControlRow: structure", () => {
  it("a slider-kind descriptor renders both a range input and a synced number input", () => {
    const vnode = NumericControlRow({ descriptor: SLIDER_DESCRIPTOR, onChange: vi.fn() });

    expect(vnode.props["data-testid"]).toBe("control-v0");
    const [label, sliderInput, numberInput] = vnode.props.children;

    expect(label.props.children).toEqual(["Launch speed v₀", " (m/s)"]);

    expect(sliderInput.type).toBe("input");
    expect(sliderInput.props.type).toBe("range");
    expect(sliderInput.props.min).toBe(0);
    expect(sliderInput.props.max).toBe(150);
    expect(sliderInput.props.step).toBe(0.1);
    expect(sliderInput.props.value).toBe(50);

    expect(numberInput.type).toBe("input");
    expect(numberInput.props.type).toBe("number");
    expect(numberInput.props.value).toBe(50);
  });

  it("a number-kind descriptor (no slider) renders no range input", () => {
    const numberDescriptor: ControlDescriptor = {
      path: "phaseOffset",
      kind: "number",
      label: "Phase offset",
      value: 1.5,
    };
    const vnode = NumericControlRow({ descriptor: numberDescriptor, onChange: vi.fn() });
    const [, sliderSlot, numberInput] = vnode.props.children;

    expect(sliderSlot).toBe(false);
    expect(numberInput.props.type).toBe("number");
  });

  it("omits the unit suffix entirely when the descriptor has none", () => {
    const noUnit: ControlDescriptor = { path: "x", kind: "number", label: "X", value: 1 };
    const vnode = NumericControlRow({ descriptor: noUnit, onChange: vi.fn() });
    const [label] = vnode.props.children;
    expect(label.props.children).toEqual(["X", ""]);
  });
});

describe("NumericControlRow: committed values clamp to schema ranges (P3.19 validation criterion)", () => {
  it("an onInput value inside range is passed straight through", () => {
    const onChange = vi.fn();
    const vnode = NumericControlRow({ descriptor: SLIDER_DESCRIPTOR, onChange });
    const [, sliderInput] = vnode.props.children;

    sliderInput.props.onInput(fakeInputEvent(75));
    expect(onChange).toHaveBeenCalledWith(75);
  });

  it("an onInput value beyond max/min clamps before reaching onChange", () => {
    const onChange = vi.fn();
    const vnode = NumericControlRow({ descriptor: SLIDER_DESCRIPTOR, onChange });
    const [, , numberInput] = vnode.props.children;

    numberInput.props.onInput(fakeInputEvent(9999));
    expect(onChange).toHaveBeenCalledWith(150);

    numberInput.props.onInput(fakeInputEvent(-9999));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("a non-numeric input value is ignored (never forwarded as NaN)", () => {
    const onChange = vi.fn();
    const vnode = NumericControlRow({ descriptor: SLIDER_DESCRIPTOR, onChange });
    const [, sliderInput] = vnode.props.children;

    sliderInput.props.onInput({ currentTarget: { value: "not-a-number" } });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("NumericControlRow: keyboard nudge, shift-fine works (P3.19 validation criterion)", () => {
  it("ArrowUp nudges by the full step; shift+ArrowUp nudges by a tenth of it", () => {
    const onChangeNormal = vi.fn();
    const normalVNode = NumericControlRow({
      descriptor: SLIDER_DESCRIPTOR,
      onChange: onChangeNormal,
    });
    const [, sliderInputNormal] = normalVNode.props.children;
    sliderInputNormal.props.onKeyDown(fakeKeyEvent("ArrowUp", false));
    expect(onChangeNormal).toHaveBeenCalledWith(expect.closeTo(50.1, 9));

    const onChangeFine = vi.fn();
    const fineVNode = NumericControlRow({ descriptor: SLIDER_DESCRIPTOR, onChange: onChangeFine });
    const [, sliderInputFine] = fineVNode.props.children;
    sliderInputFine.props.onKeyDown(fakeKeyEvent("ArrowUp", true));
    expect(onChangeFine).toHaveBeenCalledWith(expect.closeTo(50.01, 9));
  });

  it("ArrowDown/ArrowLeft nudge down, ArrowUp/ArrowRight nudge up", () => {
    const onChange = vi.fn();
    const vnode = NumericControlRow({ descriptor: SLIDER_DESCRIPTOR, onChange });
    const [, sliderInput] = vnode.props.children;

    sliderInput.props.onKeyDown(fakeKeyEvent("ArrowRight", false));
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(50.1, 9));

    sliderInput.props.onKeyDown(fakeKeyEvent("ArrowLeft", false));
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(49.9, 9));
  });

  it("a nudge at the range's max clamps rather than overshooting", () => {
    const atMax: ControlDescriptor = { ...SLIDER_DESCRIPTOR, value: 150 };
    const onChange = vi.fn();
    const vnode = NumericControlRow({ descriptor: atMax, onChange });
    const [, sliderInput] = vnode.props.children;

    sliderInput.props.onKeyDown(fakeKeyEvent("ArrowUp", false));
    expect(onChange).toHaveBeenCalledWith(150);
  });

  it("preventDefault is called for a nudge key, and an unrelated key is ignored entirely", () => {
    const onChange = vi.fn();
    const vnode = NumericControlRow({ descriptor: SLIDER_DESCRIPTOR, onChange });
    const [, sliderInput] = vnode.props.children;

    const nudgeEvent = fakeKeyEvent("ArrowUp", false);
    sliderInput.props.onKeyDown(nudgeEvent);
    expect(nudgeEvent.preventDefault).toHaveBeenCalled();

    onChange.mockClear();
    const otherEvent = fakeKeyEvent("Enter", false);
    sliderInput.props.onKeyDown(otherEvent);
    expect(onChange).not.toHaveBeenCalled();
    expect(otherEvent.preventDefault).not.toHaveBeenCalled();
  });
});
