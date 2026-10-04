import type * as Y from 'yjs';

import type { Point } from '../../shared/geometry';
import type { StickySnapshot } from '../../shared/board-model';
import type { TextSnapshot } from '../../shared/objects/text';
import type { ConnectorSnapshot } from '../../shared/objects/connector';
import type { ShapeSnapshot } from '../../shared/objects/shape';
import type { StrokeSnapshot } from '../../shared/objects/stroke';
import type { ImageSnapshot } from '../../shared/objects/image';
import type { PenColor, PenThickness, ShapeKind } from '../../shared/config';
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
  /**
   * Story 9: current text-object snapshots, for e2e assertions about free text.
   */
  getTexts?(): TextSnapshot[];
  /** Story 10: current shape snapshots, for e2e assertions about drawn shapes. */
  getShapes?(): ShapeSnapshot[];
  /**
   * Story 10: current connector snapshots, ends included — which is what an assertion
   * about an arrow is really about, since its line is derived from them.
   */
  getConnectors?(): ConnectorSnapshot[];
  /**
   * Put a shape on the board and return its id, centred on the given point at the
   * standard size, so a test can lay out a board instead of dragging one.
   */
  seedShape?(kind: ShapeKind, centreX: number, centreY: number): string;
  /**
   * Draw an arrow between two objects that are already there, by id. An empty string
   * means it could not be made — one of the two is not on the board.
   */
  seedConnector?(fromId: string, toId: string): string;
  /**
   * Story 11: current stroke snapshots, for e2e assertions about a finished sketch — its
   * box, its style, and the path it stored.
   */
  getStrokes?(): StrokeSnapshot[];
  /**
   * Story 12: current image snapshots, for e2e assertions about image objects.
   */
  getImages?(): ImageSnapshot[];
  /**
   * Put a stroke on the board from a recorded pointer path in board units, and return its
   * id, so a test has something to select, resize or delete without drawing it by mouse
   * first. An empty string means the path could not be drawn (it was empty).
   */
  seedStroke?(points: readonly Point[], color?: PenColor, thickness?: PenThickness): string;
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
  /**
   * Story 8: this person's undo history, for tests that drive or inspect it
   * directly (a button click is still the ordinary path in most cases).
   */
  canUndo?(): boolean;
  canRedo?(): boolean;
  /** Reverse / re-apply this person's own last change; false when nothing to do. */
  undoStep?(): boolean;
  redoStep?(): boolean;
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
