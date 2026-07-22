import { atom, type ReadableAtom } from "nanostores";

/** Playback clock state (§5.4): mutable, updated per frame while playing. */
export interface PlaybackStoreState {
  readonly playbackTime: number;
  readonly speed: number;
  readonly loop: boolean;
  readonly playing: boolean;
}

export interface PlaybackStore {
  readonly store: ReadableAtom<PlaybackStoreState>;
  getState(): PlaybackStoreState;
  setPlaybackTime(t: number): void;
  setSpeed(speed: number): void;
  setLoop(loop: boolean): void;
  play(): void;
  pause(): void;
  reset(): void;
}

const INITIAL_STATE: PlaybackStoreState = Object.freeze({
  playbackTime: 0,
  speed: 1,
  loop: false,
  playing: false,
});

export function createPlaybackStore(): PlaybackStore {
  const store = atom<PlaybackStoreState>(INITIAL_STATE);
  const patch = (next: Partial<PlaybackStoreState>) =>
    store.set(Object.freeze({ ...store.get(), ...next }));

  return {
    store,
    getState: () => store.get(),
    setPlaybackTime(t) {
      patch({ playbackTime: t });
    },
    setSpeed(speed) {
      patch({ speed });
    },
    setLoop(loop) {
      patch({ loop });
    },
    play() {
      patch({ playing: true });
    },
    pause() {
      patch({ playing: false });
    },
    reset() {
      store.set(INITIAL_STATE);
    },
  };
}
