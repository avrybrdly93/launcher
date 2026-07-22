import { describe, expect, it } from "vitest";
import { createPlaybackStore } from "./playback-store.js";

describe("playbackStore", () => {
  it("starts paused at t=0, 1x speed, no loop", () => {
    const { getState } = createPlaybackStore();
    expect(getState()).toEqual({ playbackTime: 0, speed: 1, loop: false, playing: false });
  });

  it("setPlaybackTime/setSpeed/setLoop update only their own field, leaving prior snapshots untouched", () => {
    const { getState, setPlaybackTime, setSpeed, setLoop } = createPlaybackStore();
    const before = getState();

    setPlaybackTime(1.5);
    setSpeed(2);
    setLoop(true);

    const after = getState();
    expect(after).toEqual({ playbackTime: 1.5, speed: 2, loop: true, playing: false });
    expect(before).toEqual({ playbackTime: 0, speed: 1, loop: false, playing: false });
  });

  it("play/pause toggle playing without disturbing playbackTime", () => {
    const { getState, setPlaybackTime, play, pause } = createPlaybackStore();
    setPlaybackTime(3);
    play();
    expect(getState().playing).toBe(true);
    expect(getState().playbackTime).toBe(3);
    pause();
    expect(getState().playing).toBe(false);
    expect(getState().playbackTime).toBe(3);
  });

  it("reset returns to the initial state", () => {
    const { getState, setPlaybackTime, setSpeed, setLoop, play, reset } = createPlaybackStore();
    setPlaybackTime(5);
    setSpeed(0.5);
    setLoop(true);
    play();
    reset();
    expect(getState()).toEqual({ playbackTime: 0, speed: 1, loop: false, playing: false });
  });

  it("every published snapshot is frozen", () => {
    const { getState, setPlaybackTime } = createPlaybackStore();
    expect(Object.isFrozen(getState())).toBe(true);
    setPlaybackTime(1);
    const state = getState();
    expect(Object.isFrozen(state)).toBe(true);
    expect(() => {
      // @ts-expect-error -- intentionally violating readonly to prove runtime immutability
      state.playbackTime = 99;
    }).toThrow(TypeError);
  });
});
