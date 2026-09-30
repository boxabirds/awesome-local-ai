// A second real `Y.Doc` that trades updates with the local one, standing in for
// "another person" without a server (design: Mock vs real boundaries).
//
// Everything the peer changes arrives in the local document under a *non-local*
// origin, so an `UndoManager` that tracks only `LOCAL_ORIGIN` never sees it — which
// is exactly the property the per-person undo history has to have. The peer's own
// edits run as ordinary model calls on the peer document and are piped over.

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';

/** The origin a peer's change arrives under: never `LOCAL_ORIGIN`, never tracked. */
export const PEER_ORIGIN: unique symbol = Symbol('test.peer');

/** A stand-in for story 4's `LOAD_ORIGIN` on the client side (never tracked). */
export const LOAD_ORIGIN: unique symbol = Symbol('test.load');

export interface Peer {
  /** The other person's document. */
  readonly peer: Y.Doc;
  /** Run a change on the peer; it lands locally under `PEER_ORIGIN`. */
  remote(run: (peer: Y.Doc) => void): void;
  /** Run a change on the peer; it lands locally under `LOAD_ORIGIN`. */
  load(run: (peer: Y.Doc) => void): void;
  /** Stop piping and drop the peer document. */
  destroy(): void;
}

/**
 * Link `local` to a fresh peer document. Local changes are copied to the peer;
 * peer changes come back under whichever origin the scenario asked for. Applying
 * a remote update re-fires the local `update` event, so a change already known to
 * have come from the peer is never echoed back to it.
 */
export function createPeer(local: Y.Doc): Peer {
  const peer = new Y.Doc();

  // The origin the *next* batch of peer updates is applied to `local` under.
  let applyOrigin: unknown = PEER_ORIGIN;

  // A change this tab made (LOCAL_ORIGIN, or any origin that is not one of the
  // "came from the other side" markers) is forwarded to the peer.
  const onLocal = (update: Uint8Array, origin: unknown): void => {
    if (origin === PEER_ORIGIN || origin === LOAD_ORIGIN) return;
    Y.applyUpdate(peer, update);
  };
  // Anything the peer produced comes back under `applyOrigin`, and the local
  // `update` that applying it fires is not echoed again.
  const onPeer = (update: Uint8Array): void => {
    const origin = applyOrigin;
    applyOrigin = PEER_ORIGIN;
    Y.applyUpdate(local, update, origin);
  };

  local.on('update', onLocal);
  peer.on('update', onPeer);

  // The handshake a real provider does first: give the peer the state the local
  // document already holds, so a later delta that touches a type created before
  // the link (the objects map, made by `initDoc`) has something to integrate
  // into. Applying it echoes a no-op back onto `local` under `PEER_ORIGIN`.
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(local));

  const run = (origin: unknown, body: (doc: Y.Doc) => void): void => {
    applyOrigin = origin;
    // Open one transaction so the whole batch arrives together, then let the
    // natural `update` piping deliver it under `applyOrigin`.
    peer.transact(() => body(peer), LOCAL_ORIGIN);
    applyOrigin = PEER_ORIGIN;
  };

  return {
    peer,
    remote(body): void {
      run(PEER_ORIGIN, body);
    },
    load(body): void {
      run(LOAD_ORIGIN, body);
    },
    destroy(): void {
      local.off('update', onLocal);
      peer.off('update', onPeer);
      peer.destroy();
    },
  };
}
