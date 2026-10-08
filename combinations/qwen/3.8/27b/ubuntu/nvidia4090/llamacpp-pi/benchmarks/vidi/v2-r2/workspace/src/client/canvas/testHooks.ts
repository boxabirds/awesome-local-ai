import type { Camera } from './camera';
import type { StickySnapshot } from '../../shared/board-model';

declare global {
  interface Window {
    /** Test-only board control (e2e); absent in production builds. */
    __vidi6?: {
      setCamera(cam: Camera): void;
      /** Read one object's current model state, or undefined when absent. */
      getObject(id: string): BoardObjectState | undefined;
      /** Every object's current model state, sorted by id (story 3). */
      getObjects(): BoardObjectState[];
      /** Live mapped ConnectionState of the board provider (story 3). */
      connectionState: string;
      /**
       * Drops the live WebSocket (simulates the network going away) so the
       * provider's disconnect path runs. Used by the e2e outage test (TC-27).
       */
      dropConnection(): void;
      /** Brings the WebSocket back (simulates the network returning). */
      resumeConnection(): void;
    };
  }
}

export interface BoardObjectState {
  id: string;
  x: number;
  y: number;
  z: number;
  color: string;
  text: string;
}

/**
 * Installs the `window.__vidi6` test hooks, but only in test builds
 * (`vite build --mode test` / Vitest). In production builds the condition is
 * statically false, so the hooks are excluded from the bundle.
 *
 * `connectionState` starts at 'connecting'; App keeps it current via
 * `updateVidi6ConnectionState` on every transition.
 */
export function installVidi6TestHooks(
  setCamera: (cam: Camera) => void,
  getObjects: () => readonly StickySnapshot[],
  dropConnection: () => void,
  resumeConnection: () => void,
): void {
  if (import.meta.env.MODE !== 'test' || typeof window === 'undefined') {
    return;
  }
  window.__vidi6 = {
    setCamera,
    getObject: (id) => {
      const o = getObjects().find((o) => o.id === id);
      return o === undefined ? undefined : toState(o);
    },
    getObjects: (): BoardObjectState[] =>
      getObjects()
        .map(toState)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    connectionState: 'connecting',
    dropConnection,
    resumeConnection,
  };
}

/** Updates the hook's live connectionState (no-op outside test builds). */
export function updateVidi6ConnectionState(state: string): void {
  if (import.meta.env.MODE !== 'test' || typeof window === 'undefined') {
    return;
  }
  if (window.__vidi6 !== undefined) {
    window.__vidi6.connectionState = state;
  }
}

function toState(o: StickySnapshot): BoardObjectState {
  return { id: o.id, x: o.x, y: o.y, z: o.z, color: o.color, text: o.text };
}
