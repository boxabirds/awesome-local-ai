import type { Camera } from './camera';

declare global {
  interface Window {
    /**
     * Test-only hook, present only in builds with MODE === 'test'. Excluded
     * from production builds by Vite's static env replacement.
     */
    __vidi6?: {
      setCamera(cam: Camera): void;
      /** Current mapped connection state (see connectBoard.ConnectionState). */
      connectionState: string;
      /** Every connection-state change since load, in order. */
      connectionStateLog: string[];
      setConnectionState(state: string): void;
      /**
       * Close the board's WebSocket to simulate a network drop (used with
       * context.setOffline in the flaky-wifi e2e so reconnection fails until
       * the browser is back online).
       */
      disconnect?: () => void;
      connectionDebug?: () => { wsReadyState: number | null; wsconnected?: boolean; wsconnecting?: boolean };
      /**
       * Seed the board with N sticky notes (test only). Returns the number of
       * notes now on the board.
       */
      seedNotes?: (count: number) => number;
      /** Get the current note count on the board. */
      noteCount?: () => number;
      /** Insert a sticky note centred on a world point (test only). Returns the id. */
      insertSticky?: (x: number, y: number) => string;
      /** Insert a testbox (registered in test builds) at a top-left (test only). */
      insertTestBox?: (x: number, y: number, width: number, height: number) => string;
      /**
       * Transform-gesture lifecycle log (test only): 'start'/'end' entries,
       * one pair per completed drag (sel.transform onGestureStart/End).
       */
      gestureLog?: string[];
      /** The board's Y.Doc (test only): simulates remote writes. */
      getDoc?: () => import('yjs').Doc;
      /** The board's undo controller (test only, story 8). */
      undo?: {
        undo(): boolean;
        redo(): boolean;
        boundary(): void;
        canUndo(): boolean;
        canRedo(): boolean;
      };
      /** Start editing a note (test only, story 8). */
      startEdit?: (id: string) => void;
      /** Force the load-failed state (test only). */
      forceLoadFailed?: () => void;
      /** Force recovery from load-failed state (test only). */
      forceRecovered?: () => void;
      /** Directly set the connection state (test only). */
      setConnState?: (s: string) => void;
    };
  }
}

export function registerTestHooks(
  setCamera: (cam: Camera) => void,
  seedNotes?: (count: number) => number,
  noteCount?: () => number,
): void {
  if (import.meta.env.MODE !== 'test') return;
  const existing = window.__vidi6;
  window.__vidi6 = {
    setCamera,
    connectionState: existing?.connectionState ?? 'connecting',
    connectionStateLog: existing?.connectionStateLog ?? [],
    setConnectionState(state: string) {
      const hook = window.__vidi6;
      if (!hook) return;
      hook.connectionState = state;
      hook.connectionStateLog.push(state);
    },
    seedNotes,
    noteCount,
    gestureLog: existing?.gestureLog ?? [],
  };
}

export function unregisterTestHooks(): void {
  if (import.meta.env.MODE !== 'test') return;
  delete window.__vidi6;
}

/** Wire the board connection's disconnect() into the test hook (test builds). */
export function setDisconnectHook(
  fn: (() => void) | undefined,
  debug?: (() => { wsReadyState: number | null; wsconnected?: boolean; wsconnecting?: boolean }) | undefined,
): void {
  if (import.meta.env.MODE !== 'test') return;
  const hook = window.__vidi6;
  if (hook) {
    hook.disconnect = fn;
    hook.connectionDebug = debug;
  }
}

/** Wire the board's seedNotes and noteCount into the test hook (test builds). */
export function setBoardHooks(
  seedNotes: ((count: number) => number) | undefined,
  noteCount: (() => number) | undefined,
  forceLoadFailed?: () => void,
  forceRecovered?: () => void,
  setConnState?: (s: string) => void,
  insertSticky?: (x: number, y: number) => string,
  insertTestBox?: (x: number, y: number, width: number, height: number) => string,
): void {
  if (import.meta.env.MODE !== 'test') return;
  const hook = window.__vidi6;
  if (hook) {
    hook.seedNotes = seedNotes;
    hook.noteCount = noteCount;
    hook.forceLoadFailed = forceLoadFailed;
    hook.forceRecovered = forceRecovered;
    hook.setConnState = setConnState;
    hook.insertSticky = insertSticky;
    hook.insertTestBox = insertTestBox;
  }
}
