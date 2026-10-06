import * as Y from "yjs";
import { LOAD_ORIGIN, LOCAL_ORIGIN, initDoc } from "../../../src/shared/board-model";

/**
 * A simulated remote peer for the story 8 unit tests (`tests/unit/helpers`).
 *
 * Two **real** `Y.Doc`s exchanging real Yjs updates. Nothing about Yjs is faked:
 * the only stand-in is the transport, and it stands in faithfully — a change the
 * peer makes arrives on the local document with the *provider* as its origin,
 * exactly as `y-websocket` applies it in the browser (see
 * `src/client/sync/connectBoard.ts`), which is the property story 8's undo
 * history is defined by (`trackedOrigins = {LOCAL_ORIGIN}`: whatever is not this
 * tab's own transaction is invisible to it).
 *
 * `applyLoadUpdate` is the other origin story 8 must ignore: story 4's
 * `LOAD_ORIGIN`, with which a board's stored snapshot and log are applied.
 */

/** What a remote change looks like from inside this tab. */
export const REMOTE_ORIGIN: unique symbol = Symbol("test-remote-provider");

export interface Peer {
  /** The peer's own document. */
  readonly doc: Y.Doc;
  /**
   * Makes a change on the peer's document — through the real board model, so it
   * is tagged like any other client's edit — and lets it arrive here as a remote
   * change.
   */
  change(mutate: (doc: Y.Doc) => void): void;
  destroy(): void;
}

/**
 * Connects a second document to `local`: every transaction each side makes with
 * its *own* origin is handed to the other side with `REMOTE_ORIGIN`, which is
 * what a provider does and what stops the two docs from echoing each other back
 * and forth.
 */
export function createPeer(local: Y.Doc): Peer {
  const peer = new Y.Doc();
  initDoc(peer);

  const onLocal = (update: Uint8Array, origin: unknown): void => {
    if (origin !== LOCAL_ORIGIN) return;
    Y.applyUpdate(peer, update, REMOTE_ORIGIN);
  };
  const onPeer = (update: Uint8Array, origin: unknown): void => {
    if (origin !== LOCAL_ORIGIN) return;
    Y.applyUpdate(local, update, REMOTE_ORIGIN);
  };

  local.on("update", onLocal);
  peer.on("update", onPeer);

  // A real provider hands each side what the other is missing, relative to what
  // it already has; that exchange is bidirectional, and it matters: an update
  // whose structs start at clock 1 reaches a document that has never seen this
  // client at clock 0, and Yjs turns what it cannot place into garbage.
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(local), REMOTE_ORIGIN);
  Y.applyUpdate(local, Y.encodeStateAsUpdate(peer), REMOTE_ORIGIN);

  let destroyed = false;
  return {
    doc: peer,
    change(mutate: (doc: Y.Doc) => void): void {
      peer.transact(() => mutate(peer), LOCAL_ORIGIN);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      local.off("update", onLocal);
      peer.off("update", onPeer);
      peer.destroy();
    },
  };
}

/**
 * Applies changes with story 4's `LOAD_ORIGIN` — the way a board is filled in
 * when it is opened, not the way it is edited: a scratch document starts from
 * this board's state, is mutated, and what it added is applied here with the
 * load origin.
 */
export function applyLoadUpdate(local: Y.Doc, mutate: (doc: Y.Doc) => void): void {
  const scratch = new Y.Doc();
  try {
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(local));
    scratch.transact(() => mutate(scratch), LOAD_ORIGIN);
    Y.applyUpdate(local, Y.encodeStateAsUpdate(scratch), LOAD_ORIGIN);
  } finally {
    scratch.destroy();
  }
}
