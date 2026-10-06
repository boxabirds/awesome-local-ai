/**
 * A simulated colleague for the undo unit tests (story 8).
 *
 * Undo's whole question is *whose change is this*, so the peer cannot be a mock: it is a second
 * real `Y.Doc` exchanging real updates. The only thing scripted about it is the transaction
 * origin - updates from the peer are applied with an origin that is not `LOCAL_ORIGIN`, exactly
 * like the WebSocket provider does in the app, and story 4's load updates are applied with the
 * room's own `LOAD_ORIGIN`.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { LOAD_ORIGIN } from '../../src/worker/board-store';

/** The origin a provider writes remote changes with in these tests. */
export const REMOTE_ORIGIN: unique symbol = Symbol('vidi6-test-remote');

/** One end of the link, so a test can stop the exchange. */
export interface PeerLink {
  disconnect(): void;
}

/**
 * Connects two documents in both directions, marking what arrives as remote.
 *
 * Local changes (origin `LOCAL_ORIGIN`, or anything this side produced on the peer's behalf) are
 * forwarded; what is applied from the other side is applied with `REMOTE_ORIGIN`, so a
 * `trackedOrigins: LOCAL_ORIGIN` undo manager sees the peer exactly the way it sees the real room.
 */
export function link(peer: Y.Doc, local: Y.Doc): PeerLink {
  let forwarding = false;
  const detach: Array<() => void> = [];

  const relayFrom = (from: Y.Doc, to: Y.Doc): void => {
    const onUpdate = (update: Uint8Array, origin: unknown): void => {
      // never echo an update that came in from the wire back out again
      if (origin === REMOTE_ORIGIN || forwarding) return;
      forwarding = true;
      try {
        Y.applyUpdate(to, update, REMOTE_ORIGIN);
      } finally {
        forwarding = false;
      }
    };
    from.on('update', onUpdate);
    detach.push(() => from.off('update', onUpdate));
  };

  relayFrom(local, peer);
  relayFrom(peer, local);
  // both sides start empty, so a full state exchange is enough to reach the current state
  Y.applyUpdate(local, Y.encodeStateAsUpdate(peer), REMOTE_ORIGIN);
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(local), REMOTE_ORIGIN);

  return {
    disconnect() {
      for (const stop of detach) stop();
      detach.length = 0;
    },
  };
}

/**
 * Applies everything the peer has to `doc` with story 4's load origin: the way a board arrives
 * when the room hands over a stored document.
 */
export function applyAsLoad(peer: Y.Doc, doc: Y.Doc): void {
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer), LOAD_ORIGIN);
}

/** A fresh colleague document, with the board's root structures created. */
export function createPeerDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap<Y.Map<unknown>>('objects');
  return doc;
}

/**
 * Runs one of the peer's own changes: the peer's transaction origin is this test's `LOCAL_ORIGIN`
 * on the peer's document only, so the link forwards it to the board under test as a remote change.
 */
export function peerChange<T>(peer: Y.Doc, run: () => T): T {
  return peer.transact(run, LOCAL_ORIGIN);
}
