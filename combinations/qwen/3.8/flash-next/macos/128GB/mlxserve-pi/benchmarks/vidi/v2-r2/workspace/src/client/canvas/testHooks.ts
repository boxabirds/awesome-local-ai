// Registers the `window.__vidi6` test hooks. Only the `test` build
// (`npm run build:test`, i.e. MODE=test) installs anything on `window`; in the
// production build the guarded block is statically false and is removed by the
// bundler, so the hook is excluded from production builds.

import type { Camera } from './camera';
import type * as Y from 'yjs';
import { applyUpdate } from 'yjs';
import {
  createSticky,
  getStickyText,
  snapshotByCreation,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { textSnapshots } from '../../shared/objects/text';
import { shapeSnapshots } from '../../shared/objects/shape';
import { connectorSnapshots } from '../../shared/objects/connector';
import { strokeSnapshots } from '../../shared/objects/stroke';
import { imageSnapshots } from '../../shared/objects/image';
import type { StickyColor } from '../../shared/config';
import { COLLAB_ENDPOINT } from '../sync/endpoint';
import type { ConnectionState } from '../sync/connectBoard';

export type CameraSetter = (camera: Camera) => void;

let setter: CameraSetter | null = null;

interface MutableApi {
  setCamera?(x: number, y: number, zoom: number): void;
  doc?: Y.Doc;
  snapshot?(): readonly ObjectSnapshot[];
  __serverMode?: boolean;
  __drop?(): void;
  __restore?(): void;
  __awarenessPresent?(): boolean;
  __reconnectCount?(): number;
  __stateLog?(): readonly string[];
  __destroy?(): void;
  __createNotes?(count: number, withTextEvery?: number, perTransaction?: number): Promise<number>;
  __applyUpdate?(update: Uint8Array | number[], origin?: string): void;
  __forceConnectionState?(state: ConnectionState): void;
  /**
   * The pictures on the board, as plain JSON: which have bytes, which are waiting for
   * some, which will never have any. An upload cannot be made to happen on a schedule by
   * a test, so an end-to-end test reads these fields instead of the pixels.
   */
  __images?(): readonly object[];
  connectionState?: string;
}

/** Merge into the single `window.__vidi6` object without clobbering other keys. */
function patch(next: MutableApi): void {
  if (import.meta.env.MODE !== 'test' || typeof window === 'undefined') return;
  window.__vidi6 = {
    ...(window.__vidi6 as MutableApi | undefined),
    ...next,
  } as unknown as typeof window.__vidi6;
}

/** Called by `useCamera` on mount (and cleared on unmount). */
export function registerCameraSetter(next: CameraSetter | null): void {
  setter = next;
  patch({
    setCamera: (x: number, y: number, zoom: number) => {
      setter?.({ x, y, zoom });
    },
  });
}

/**
 * Expose the live board document so end-to-end tests can compare two browsers'
 * state by content. `snapshot` returns plain JSON a test can read back over the
 * Playwright boundary (a raw Y.Doc cannot be serialised across it).
 */
export function registerBoardDoc(doc: Y.Doc | null): void {
  if (doc === null) return;
  patch({
    doc,
    // Every object on the board, of every type: notes, then text objects, then
    // shapes, then arrows, then drawings, each group in creation order. A board with
    // nothing new on it reads exactly as it did before story 9, so the tests written
    // against the older shape are unaffected; a test that wants only one type filters
    // on `type`. An arrow comes out with the box around the two ends it resolved to at
    // this moment, which is how a test reads an arrow following a shape: snapshot,
    // move, snapshot, and compare the two boxes. A stroke comes out with the line it
    // stored, which is how a test reads a drawing two browsers agreed on.
    snapshot: () => [
      ...snapshotByCreation(doc),
      ...textSnapshots(doc),
      ...shapeSnapshots(doc),
      ...connectorSnapshots(doc),
      ...strokeSnapshots(doc),
      ...imageSnapshots(doc),
    ],
    __images: () => imageSnapshots(doc),
    __serverMode: COLLAB_ENDPOINT !== '',
    /**
     * Create `count` notes, giving every `withTextEvery`th one some text, and
     * return how many were made. This is the bulk-edit affordance the persistence
     * tests need - two thousand double-clicks is not a test anyone can wait for -
     * and each note goes through the same model the toolbar uses, so the updates
     * that reach the room are the ones a person typing would produce.
     *
     * `perTransaction` says how many notes one edit covers: the default of one is
     * what a person does (one note, one undo, one update the room has to write
     * down), which is what a test that counts stored updates needs; a large value
     * makes a big board cheap to build when the number of updates does not matter.
     *
     * It is async because a page merges everything it changed in one turn of the
     * event loop into a single update: a turn is let pass between the edits so that
     * they stay separate edits, which is the whole difference between a board that
     * arrives as one message and one that arrives as 560.
     */
    __createNotes: async (
      count: number,
      withTextEvery = 2,
      perTransaction = 1,
    ): Promise<number> => {
      for (let start = 0; start < count; start += Math.max(1, Math.floor(perTransaction))) {
        doc.transact(() => {
          for (
            let index = start;
            index < Math.min(count, start + Math.max(1, Math.floor(perTransaction)));
            index++
          ) {
            const id = createSticky(
              doc,
              { x: (index % 40) * 220, y: Math.floor(index / 40) * 200 },
              NOTE_COLORS[index % NOTE_COLORS.length] as StickyColor,
            );
            if (index % withTextEvery === 0) getStickyText(doc, id)?.insert(0, `note ${index}`);
          }
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return count;
    },
    /**
     * Put a whole update into the board document, the way a peer's update arrives. This
     * is how an end-to-end test seeds a board with something nobody could click into
     * existence: a fixture built by the same model functions the tools call goes in as
     * the bytes the room would have sent, and everything after it - the painting, the
     * undo stack, what the other clients are told - is the board's own work.
     *
     * The bytes may be a plain array because that is what survives the boundary of a
     * browser-driven test; the update is applied as a local change, so it goes on out
     * to the room exactly as the edit of anyone else on the board would.
     */
    __applyUpdate: (update: Uint8Array | number[], origin = 'test'): void => {
      applyUpdate(doc, update instanceof Uint8Array ? update : Uint8Array.from(update), origin);
    },
  });
}

const NOTE_COLORS: readonly string[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

/**
 * Put the app into a connection state it was not told about, for the component
 * tests of what the app *does* with a state (see `canEdit`). The mapping from what
 * the room sends to the state is tested separately, against the provider's own
 * events; what is under test here is the gate, so the state is what a test names.
 */
export function registerConnectionForcer(forcer: ((state: ConnectionState) => void) | null): void {
  patch({
    __forceConnectionState: (state: ConnectionState) => {
      forcer?.(state);
    },
  });
}

export interface ConnectionControl {
  drop(): void;
  restore(): void;
  awarenessPresent(): boolean;
  reconnectCount(): number;
  destroy(): void;
}

/**
 * The mapped `ConnectionState`, newest last, deduplicated. A page-level log
 * because the state is a plain JS value a MutationObserver cannot watch; every
 * change is recorded, so the idle test can assert it never left `connected`
 * between the instants a poll happens to sample.
 */
const stateLog: ConnectionState[] = [];

/** Record the current mapped connection state (called on every change). */
export function registerConnectionState(state: ConnectionState): void {
  if (stateLog[stateLog.length - 1] !== state) stateLog.push(state);
  patch({ connectionState: state });
}

/**
 * Expose deterministic socket drop/restore, an awareness-presence probe and a
 * reconnect counter so end-to-end tests can simulate a dropped link (the badge,
 * offline catch-up and nightly awareness-soak cases) without reaching into the
 * provider's internals.
 */
export function registerConnectionControl(ctrl: ConnectionControl | null): void {
  if (ctrl === null) return;
  patch({
    __drop: ctrl.drop,
    __restore: ctrl.restore,
    __awarenessPresent: ctrl.awarenessPresent,
    __reconnectCount: ctrl.reconnectCount,
    __stateLog: () => stateLog.slice(),
    __destroy: ctrl.destroy,
  });
}
