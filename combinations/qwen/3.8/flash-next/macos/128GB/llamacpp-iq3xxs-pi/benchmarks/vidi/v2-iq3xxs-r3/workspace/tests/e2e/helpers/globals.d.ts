/** Page-side globals the e2e tests install (in addition to `window.__vidi6`). */

import type { SeedNote } from "../../../src/client/testSeed";

export interface WheelObservation {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

declare global {
  interface Window {
    __wheelObservations: WheelObservation[];
    /**
     * What the client's own test hook exposes (story 4 uses `seed` to build a
     * board of a known size through the real board model, so the notes it counts
     * later left the client as real Yjs updates and went through the room).
     */
    __vidi6Board?: {
      deleteNote(id: string): boolean;
      seed(notes: SeedNote[]): string[];
    };
  }
}

export {};
