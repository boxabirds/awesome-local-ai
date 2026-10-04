import type * as Y from 'yjs';

import type { StickySnapshot } from '../../shared/board-model';
import type { Camera } from './camera';
import type { ConnectionState } from '../sync/connectBoard';

/**
 * Hooks used only by the end-to-end and component tests (e.g. jumping a
 * million board units away is impractical by dragging; component tests read the
 * shared document directly). `import.meta.env.MODE` is replaced at build time,
 * so in a production build these branches are dead code and removed.
 */
export interface Vidi6TestHooks {
  setCamera?(camera: Camera): void;
  /** The live board document, for tests that assert model state. */
  doc?: Y.Doc;
  /** Current sticky-note snapshots (sorted by z, id), for e2e assertions. */
  getNotes?(): StickySnapshot[];
  /**
   * Put a sticky note on the board and return its id, so an e2e test can lay out a
   * selection instead of dragging notes into place by hand. The point is where a
   * double-click would have made it — the note's centre.
   */
  seedSticky?(centreX: number, centreY: number): string;
  /** What this page has selected, for assertions about the selection itself. */
  selectedIds?(): string[];
  /** Every object on the board, of any type. */
  objectCount?(): number;
  /** What the connection badge is being told, straight from the provider. */
  connectionState?(): ConnectionState;
  /** Every connection state this page has been in, oldest first. */
  connectionStates?(): ConnectionState[];
  /** Sockets this page has opened at the room, retries included. */
  connectionAttempts?(): number;
  /**
   * Drop the board connection the way leaving the board does, so a test can check
   * nothing reconnects afterwards.
   */
  disconnectBoard?(): void;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export const IS_TEST_MODE = import.meta.env.MODE === 'test';

/** Merge hooks into `window.__vidi6` (no-op in a production build). */
export function registerTestHooks(hooks: Vidi6TestHooks): void {
  if (!IS_TEST_MODE) return;
  window.__vidi6 = { ...window.__vidi6, ...hooks };
}
