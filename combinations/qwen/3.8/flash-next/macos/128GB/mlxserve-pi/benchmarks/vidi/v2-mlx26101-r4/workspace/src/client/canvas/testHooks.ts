import type * as Y from 'yjs';

import type { ConnectionState } from '../sync/connectBoard';
import { isStickySnapshot, snapshot } from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';
import { textSnapshots } from '../../shared/objects/text';
import type { TextSnapshot } from '../../shared/objects/text';
import { isShapeSnapshot } from '../../shared/objects/shape';
import type { ShapeSnap } from '../../shared/objects/shape';
import { connectorSnapshots } from '../../shared/objects/connector';
import type { ConnectorSnap } from '../../shared/objects/connector';
import { strokeSnapshots } from '../../shared/objects/stroke';
import type { StrokeSnap } from '../../shared/objects/stroke';
import type { Camera } from './camera';

/**
 * Declared in this module's global scope, and not re-exported from it, so that a
 * Playwright (Node) test can read `window.__vidi6` without importing browser code.
 * This is the same shape as `Vidi6TestHooks` below.
 */
declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

/**
 * Test-only hooks, installed only when the app is built with
 * `import.meta.env.MODE === 'test'` (`npm run build:test`). Dragging a million
 * pixels in an e2e test is impractical, so the tests jump the camera directly.
 * The call site in `cameraStore.ts` is folded away in production builds, so
 * `window.__vidi6` never exists there.
 */
export interface Vidi6TestHooks {
  /** Merge a partial camera (x, y, zoom) into the current camera. */
  setCamera(patch: Partial<Camera>): void;
  getCamera(): Camera;
  /**
   * The document the mounted board owns, or undefined while no board is mounted.
   * Tests read the board's real state here instead of guessing it from pixels.
   */
  getBoardDoc(): Y.Doc | undefined;
  /** The notes of the mounted board, in stacking order, read from the document. */
  getStickies(): readonly StickySnapshot[];
  /**
   * The pieces of text of the mounted board, in stacking order, read from the document.
   *
   * Its own hook rather than a wider `getObjects()`, for the same reason `getStickies` is one: a test reads
   * the board's real state from it, and a hook that returned every type would make a test that means "the
   * text objects" say "everything, then filter". Story 9's e2e tests need this because a text object's box
   * is a thing the document decides, and pixels are a poor witness of a number in a Y.Map.
   */
  getTexts(): readonly TextSnapshot[];
  /**
   * The shapes of the mounted board, in stacking order, read from the document.
   *
   * The same reason as the two above: a shape's kind, colours and label live in the document, and a pixel is
   * a poor witness of a field in a Y.Map. An e2e test that wants to know whether a drag drew a 200x120
   * rectangle reads this rather than measuring a border that antialiasing has already disagreed with.
   */
  getShapes(): readonly ShapeSnap[];
  /**
   * The arrows of the mounted board, with the ends as the board draws them.
   *
   * An arrow's box is derived, so this is the only way to ask what its two ends are attached to — which is
   * what an e2e test about "the arrow followed the shape" is really asking.
   */
  getConnectors(): readonly ConnectorSnap[];
  /**
   * The drawings of the mounted board, in stacking order, with the points as the document holds them.
   *
   * The same reason as the four above, and a sharper one: a drawing is up to five thousand numbers in a Y.Map,
   * and no amount of looking at pixels will tell a test whether the points were stored relative to the box, at
   * what base size, or how many survived the smoothing. An e2e test about "the pen drew a line" reads this.
   */
  getStrokes(): readonly StrokeSnap[];
  /**
   * What the board's own connection reports right now, kept up to date as it
   * changes. A test that needs to know whether the board thinks it is live reads
   * this instead of guessing from the badge.
   */
  connectionState: ConnectionState | undefined;
  /**
   * Cut this board's connection, as if the network went down, and leave the board to
   * notice it and come back on its own. Answers whether there was a connection to cut.
   *
   * This is here because Playwright's `context.setOffline` only stops a page from
   * making new connections: a board that is already connected would keep its socket,
   * and an outage that is not noticed by the board is not an outage. Only test builds
   * have it.
   */
  dropConnection(): boolean;
}

/** The document of whichever board is mounted; one at a time in a test. */
let boardDoc: Y.Doc | undefined;

/** How to cut the connection of whichever board is mounted; none when it has none. */
let dropBoardConnection: (() => void) | undefined;

/** Called by `useBoardDoc` when a board mounts (and with undefined when it goes). */
export function registerBoardForTests(doc: Y.Doc | undefined): void {
  boardDoc = doc;
}

/** Called by `useBoardDoc` with the way to cut its connection, and by nothing else. */
export function registerConnectionForTests(drop: (() => void) | undefined): void {
  dropBoardConnection = drop;
}

export function installTestHooks(
  hooks: Omit<
    Vidi6TestHooks,
    | 'getBoardDoc'
    | 'getStickies'
    | 'getTexts'
    | 'getShapes'
    | 'getConnectors'
    | 'getStrokes'
    | 'connectionState'
    | 'dropConnection'
  >,
): void {
  window.__vidi6 = {
    connectionState: undefined,
    getBoardDoc: (): Y.Doc | undefined => boardDoc,
    getStickies: (): readonly StickySnapshot[] => (boardDoc ? snapshot(boardDoc).filter(isStickySnapshot) : []),
    getTexts: (): readonly TextSnapshot[] => (boardDoc ? textSnapshots(boardDoc) : []),
    getShapes: (): readonly ShapeSnap[] => (boardDoc ? snapshot(boardDoc).filter(isShapeSnapshot) : []),
    getConnectors: (): readonly ConnectorSnap[] => (boardDoc ? connectorSnapshots(boardDoc) : []),
    getStrokes: (): readonly StrokeSnap[] => (boardDoc ? strokeSnapshots(boardDoc) : []),
    dropConnection: (): boolean => {
      if (dropBoardConnection === undefined) return false;
      dropBoardConnection();
      return true;
    },
    ...hooks,
  };
}

/** Called by the board whenever its connection changes state (test builds only). */
export function reportConnectionStateForTests(state: ConnectionState): void {
  const hooks = window.__vidi6;
  if (hooks) hooks.connectionState = state;
}
