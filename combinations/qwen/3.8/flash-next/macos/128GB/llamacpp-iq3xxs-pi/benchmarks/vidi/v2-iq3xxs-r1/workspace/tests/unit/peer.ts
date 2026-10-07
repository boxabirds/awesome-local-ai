import * as Y from 'yjs';

/**
 * A second person, for unit tests (design "Mock vs real boundaries"): the peer is a
 * real `Y.Doc` exchanging real updates with the local one, so a remote change is a
 * real remote change — it just never travels through a server.
 *
 * What matters for story 8 is *where a change came from*: the local board's undo
 * history only follows its own transactions, so every update handed to the local
 * document carries an origin the history ignores.
 */

/** The origin the peer's own writes carry inside the peer document. */
export const PEER_WRITE_ORIGIN: unique symbol = Symbol('vidi6.test.peer-write');
/** The origin the live provider would hand a remote update to this tab with. */
export const REMOTE_SYNC_ORIGIN: unique symbol = Symbol('vidi6.test.remote-sync');
/** The origin story 4's board load writes with (a saved board arriving on open). */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.test.load');

export interface Peer {
  /** The peer's own document: write to it through `transact`. */
  readonly doc: Y.Doc;
  /** Make one transaction on the peer's board; it lands on the local board live. */
  transact(run: () => void): void;
  /** Leave the room. */
  destroy(): void;
}

/**
 * Join a second document to `local` and keep both in step.
 *
 * Updates flow in both directions the moment they happen. The echo back into `local`
 * carries `REMOTE_SYNC_ORIGIN`, which is what keeps it from being counted as this
 * tab's own work (and stops the two documents from bouncing an update forever).
 */
export function connectPeer(local: Y.Doc): Peer {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(local));

  const onLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    // What arrived from the peer is not something this tab wrote, so it does not
    // travel back out again.
    if (origin === REMOTE_SYNC_ORIGIN) return;
    Y.applyUpdate(peer, update, PEER_WRITE_ORIGIN);
  };
  const onPeerUpdate = (update: Uint8Array): void => {
    Y.applyUpdate(local, update, REMOTE_SYNC_ORIGIN);
  };

  local.on('update', onLocalUpdate);
  peer.on('update', onPeerUpdate);

  return {
    doc: peer,
    transact: (run: () => void) => peer.transact(run, PEER_WRITE_ORIGIN),
    destroy: () => {
      local.off('update', onLocalUpdate);
      peer.off('update', onPeerUpdate);
      peer.destroy();
    },
  };
}

/**
 * Hand `local` everything `from` holds, written the way story 4 writes a board that
 * was loaded from storage: an origin that is neither this tab's work nor a live
 * peer's change.
 */
export function applyLoadedBoard(local: Y.Doc, from: Y.Doc): void {
  Y.applyUpdate(local, Y.encodeStateAsUpdate(from), LOAD_ORIGIN);
}
