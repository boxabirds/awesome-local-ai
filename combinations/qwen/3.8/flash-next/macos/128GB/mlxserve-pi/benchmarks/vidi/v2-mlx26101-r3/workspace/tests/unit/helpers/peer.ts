import * as Y from 'yjs';
import { initDoc } from '../../../src/shared/board-model';

/**
 * Somebody else, working on the same board.
 *
 * Undo is a claim about one person's changes, so a test of it needs a second person - not a mock
 * of one, because the thing that has to be true is that a *real* Yjs update arriving with a
 * foreign origin is not remembered by this tab's history. A stub could not prove that: the whole
 * question is what the real document does with an update it did not make.
 *
 * The two documents are wired the way the room wires them: each applies the other's updates, and
 * marks them as coming from the other, so neither ever mistakes a peer's change for its own. The
 * origin is what story 8's history reads, and it is why the marking matters: an update carries
 * state, not intent, and the origin is the only place a tab can tell its own work apart.
 */

/**
 * The origin the room applies the board with when it reads it out of storage (story 4's
 * `LOAD_ORIGIN` in `src/worker/board-store.ts`).
 *
 * This stands in for it rather than importing it, because the Worker module is compiled with the
 * Workers runtime's types and a node test may not read it. Nothing here cares *which* origin the
 * load used, only that it was not this tab's - which is exactly what the history cares about.
 */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-load');

export interface FakePeer {
  /** The peer's own copy of the board. */
  readonly doc: Y.Doc;
  /**
   * Change the board over the peer's shoulder: the write happens on the peer's document, in a
   * transaction the peer made, and arrives here as a change from elsewhere.
   */
  apply(write: (doc: Y.Doc) => void): void;
  /** How many changes have arrived from the peer since it was connected. */
  arrived(): number;
  /** Stop the peer's changes arriving. What has already arrived stays. */
  disconnect(): void;
  /** The peer goes away; its document is of no further use. */
  destroy(): void;
}

/**
 * A second person on the same board, wired to `local` and sharing whatever `local` already holds.
 *
 * @param local This person's document.
 * @param startEmpty Leave the peer with a board of its own instead of a copy of this one, for a
 * test that wants the two to diverge from an empty beginning.
 */
export function peer(local: Y.Doc, startEmpty = false): FakePeer {
  const other = new Y.Doc();
  if (!startEmpty) {
    // The peer sees what is on the board already, the way the room hands a newcomer the board.
    Y.applyUpdate(other, Y.encodeStateAsUpdate(local), other);
  }
  initDoc(other);
  let count = 0;
  let connected = true;

  const deliver = (from: Y.Doc, to: Y.Doc): ((update: Uint8Array, origin: unknown) => void) => {
    return (update: Uint8Array, origin: unknown) => {
      if (!connected || origin === to) {
        // This is the update that arrived here, going back where it came from.
        return;
      }
      Y.applyUpdate(to, update, from);
    };
  };
  const outgoing = deliver(local, other);
  const incoming = deliver(other, local);
  local.on('update', outgoing);
  other.on('update', (update: Uint8Array, origin: unknown) => {
    incoming(update, origin);
    if (origin !== local) {
      count += 1;
    }
  });

  return {
    doc: other,
    apply(write) {
      other.transact(() => {
        write(other);
      }, other);
    },
    arrived() {
      return count;
    },
    disconnect() {
      connected = false;
      local.off('update', outgoing);
    },
    destroy() {
      connected = false;
      local.off('update', outgoing);
      other.destroy();
    },
  };
}

/**
 * Apply changes to this document the way the room applies the board when it loads it: written
 * into the document, but with the load origin rather than anybody's.
 *
 * This is the case a history must not mistake for its own. A board that arrives from storage is
 * full of other people's changes - and of this person's own, from the session before the page was
 * reloaded - and none of them are undoable, because nothing here is the least bit responsible for
 * them.
 */
export function applyAsLoad(doc: Y.Doc, write: (doc: Y.Doc) => void): void {
  doc.transact(() => {
    write(doc);
  }, LOAD_ORIGIN);
}
