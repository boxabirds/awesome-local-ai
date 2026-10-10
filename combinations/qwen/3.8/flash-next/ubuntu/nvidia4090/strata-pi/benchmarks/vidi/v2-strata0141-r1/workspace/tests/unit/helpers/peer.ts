import * as Y from 'yjs';
import { LOCAL_ORIGIN, initDoc } from '../../../src/shared/board-model';
import { LOAD_ORIGIN } from '../../../src/worker/board-store';

/**
 * A simulated remote peer for the undo unit tests (design: "Mock vs real
 * boundaries" - the peer is a second **real** Y.Doc exchanging real updates, so
 * nothing about Yjs is faked).
 *
 * A provider's origin is whatever the provider passes to `Y.applyUpdate`; the
 * board only ever tracks `LOCAL_ORIGIN` (story 8, Key decision 1), so updates
 * that arrive here are invisible to the undo history, exactly as the real
 * `y-websocket` provider's are.
 */

/** The origin a room's update arrives with (the provider is not tracked). */
export const PROVIDER_ORIGIN: unique symbol = Symbol('test-provider');

/** Re-exported so a test can apply an update the way story 4 loads one. */
export { LOAD_ORIGIN, LOCAL_ORIGIN };

/** Everything `target` does not know yet about `doc`, as one update. */
export function updateFor(doc: Y.Doc, target: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc, Y.encodeStateVector(target));
}

export interface Peer {
  /** The colleague's own document. */
  readonly doc: Y.Doc;
  /** Make a change on the colleague's copy and deliver it to the local board. */
  change<T>(write: (doc: Y.Doc) => T): T;
  /** Deliver everything the colleague has that the local board lacks. */
  sync(): void;
  destroy(): void;
}

/**
 * A second document holding the same board, joined to `local`.
 *
 * `change` writes through the shared board model (the peer is a real client) and
 * then sends the update to `local` with `PROVIDER_ORIGIN` - the origin a real
 * provider applies with.
 */
export function createPeer(local: Y.Doc): Peer {
  const peer = new Y.Doc();
  initDoc(peer);
  Y.applyUpdate(peer, updateFor(local, peer), PROVIDER_ORIGIN);

  const peerApi: Peer = {
    doc: peer,
    change<T>(write: (doc: Y.Doc) => T): T {
      const result = write(peer);
      peerApi.sync();
      return result;
    },
    sync(): void {
      Y.applyUpdate(local, updateFor(peer, local), PROVIDER_ORIGIN);
    },
    destroy(): void {
      peer.destroy();
    },
  };
  return peerApi;
}

/** Apply an update the way story 4 does: read out of storage, `LOAD_ORIGIN`. */
export function applyLoadUpdate(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update, LOAD_ORIGIN);
}
