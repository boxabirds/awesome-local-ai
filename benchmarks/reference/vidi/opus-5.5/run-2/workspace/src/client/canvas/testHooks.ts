/**
 * Test-only hooks (design Fixtures): `window.__vidi6.setCamera()` lets e2e tests jump
 * far across the board without dragging a million pixels, and `connectionState` /
 * `connectionLog` expose the mapped sync connection state (story 3 nightly TC-29/30).
 * Installed only when `import.meta.env.MODE === 'test'`; the production build strips the call.
 */
import type { Camera } from './camera';
import type { ConnectionState } from '../sync/connectBoard';

export interface Vidi6TestHooks {
  getCamera(): Camera;
  setCamera(camera: Camera): void;
  /** Latest mapped connection state of this tab's board provider. */
  readonly connectionState?: ConnectionState;
  /** Every connection state this tab went through, in order. */
  readonly connectionLog?: readonly ConnectionState[];
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

let connectionState: ConnectionState | undefined;
const connectionLog: ConnectionState[] = [];

/** Called by connectBoard in test builds only. */
export function recordConnectionState(state: ConnectionState): void {
  connectionState = state;
  connectionLog.push(state);
}

export function installTestHooks(hooks: Pick<Vidi6TestHooks, 'getCamera' | 'setCamera'>): () => void {
  const installed: Vidi6TestHooks = {
    ...hooks,
    get connectionState() {
      return connectionState;
    },
    get connectionLog() {
      return [...connectionLog];
    },
  };
  window.__vidi6 = installed;
  return () => {
    if (window.__vidi6 === installed) delete window.__vidi6;
  };
}
