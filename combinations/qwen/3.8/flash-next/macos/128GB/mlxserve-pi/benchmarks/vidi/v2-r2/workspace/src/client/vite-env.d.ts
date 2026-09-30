/// <reference types="vite/client" />

import type { Camera } from './canvas/camera';
import type * as Y from 'yjs';
import type { StickySnapshot } from '../shared/board-model';

/**
 * Test-only hooks, installed on `window` only in the `test` build
 * (`vite build --mode test`). Production builds dead-code-eliminate the
 * assignment, so the hook does not exist there.
 */
export interface Vidi6TestApi {
  /** Jump the board camera to an exact position, e.g. far from the start. */
  setCamera(x: number, y: number, zoom: number): void;
  /** The live board document, for end-to-end state comparison. */
  doc?: Y.Doc;
  /** The board notes as plain JSON, readable across the Playwright boundary. */
  snapshot?(): readonly StickySnapshot[];
  /** Whether a standalone collaboration endpoint is configured for this build. */
  __serverMode?: boolean;
  /** Forcibly close the provider socket (simulate a dropped link). */
  __drop?(): void;
  /** Re-open the provider socket and resync. */
  __restore?(): void;
  /** Whether the provider still holds a local awareness state (presence alive). */
  __awarenessPresent?(): boolean;
  /** How many times the provider has begun (re)connecting. */
  __reconnectCount?(): number;
  /** The mapped connection state, newest last, deduplicated. */
  __stateLog?(): readonly string[];
  /** Tear the connection down the way unmounting a context does. */
  __destroy?(): void;
  /** The current mapped connection state. */
  connectionState?: string;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestApi;
  }

  /** Safari's non-standard gesture events (pinch on trackpads). */
  interface GestureEvent extends UIEvent {
    readonly scale: number;
    readonly rotation: number;
    readonly clientX: number;
    readonly clientY: number;
  }
}

export type { Camera };
