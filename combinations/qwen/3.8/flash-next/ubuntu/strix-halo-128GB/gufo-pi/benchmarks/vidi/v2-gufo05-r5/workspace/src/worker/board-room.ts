/**
 * One live board: its document in memory, and every browser tab editing it.
 *
 * The room speaks the y-websocket wire framing (`src/shared/protocol.ts`) with plain Yjs
 * clients and adds nothing of its own:
 *
 * - every frame is decoded, sync messages are applied to the room's `Y.Doc` and the
 *   resulting update is forwarded to every *other* socket on the board (no echo, no
 *   batching), so a change reaches the other screens as fast as the network allows;
 * - awareness frames are relayed verbatim to everyone including the sender. The room keeps
 *   no presence state; relaying keeps idle clients' connections warm. Interpreting
 *   awareness is story 6;
 * - a frame the room cannot understand (text, truncated, unknown type) or a payload Yjs
 *   rejects closes *that socket only*, with `CLOSE_UNSUPPORTED_DATA`. Other participants
 *   keep working and the document is untouched;
 * - nobody is counted: a 6th person on a board is connected exactly like the first.
 *
 * The document lives in memory only in this story. That is why the sockets are accepted
 * with the non-hibernating `accept()`: hibernation would evict the object while sockets
 * stay open and silently drop the board. Story 4 switches to hibernation once the document
 * can be reloaded from storage.
 *
 * A restart (deploy, eviction) still loses nothing while one tab stays open: on every
 * (re)connection the room sends SyncStep1, so the client answers with a SyncStep2 holding
 * everything the fresh room lacks, and the room repopulates itself.
 */
import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
  syncFrame,
  toFrameBytes,
  type IncomingFrame,
} from '../shared/protocol';
import type { Env } from './index';

/** A Yjs update as a sync message: the inner `update` type, then the bytes. */
function updateMessage(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

/**
 * The live room of a single board.
 *
 * Created by the runtime when the first socket for a board connects (`idFromName` in
 * `src/worker/index.ts` routes every address to its own object, which is what keeps
 * separate boards separate).
 */
export class BoardRoom extends DurableObject<Env> {
  /** Every open socket on this board, including sockets that just failed to send. */
  readonly #sockets = new Set<WebSocket>();

  /** The per-socket chain of frames still being handled, so order is kept. */
  readonly #queues = new WeakMap<WebSocket, Promise<void>>();

  /** The board's document, created on the first connection and never persisted yet. */
  #doc: Y.Doc | null = null;

  /** Accepts a WebSocket connection to this board and starts the initial sync. */
  async fetch(request: Request): Promise<Response> {
    if ((request.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') {
      // the Worker already rejects this; a direct call gets the same answer
      return new Response('426 Upgrade Required\n', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (!client || !server) throw new Error('WebSocketPair did not yield two sockets');

    // Listeners first: the client sends its SyncStep1 as soon as the socket is open.
    server.addEventListener('message', (event) => {
      // A frame can arrive as a Blob, so handling is asynchronous - and the handshake only
      // works if the frames of one socket are handled in the order they arrived.
      const previous = this.#queues.get(server) ?? Promise.resolve();
      this.#queues.set(
        server,
        previous
          .then(() => this.#handleMessage(server, event.data as IncomingFrame))
          .catch(() => this.#closeUnsupported(server, 'message could not be handled')),
      );
    });
    const forget = () => {
      this.#sockets.delete(server);
    };
    server.addEventListener('close', forget);
    server.addEventListener('error', forget);

    // Non-hibernating accept on purpose - see the file comment.
    server.accept();
    this.#sockets.add(server);

    // Ask the newcomer for its state. On a restarted room this is what makes the first
    // client re-send the whole document.
    this.#send(server, syncFrame(this.#syncStep1()));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** The room's document, created (and subscribed) on first use. */
  #document(): Y.Doc {
    if (this.#doc) return this.#doc;
    const doc = new Y.Doc();
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // every change goes to the rest of the board, never back to whoever sent it
      const frame = syncFrame(updateMessage(update));
      for (const socket of [...this.#sockets]) {
        if (socket === origin) continue;
        this.#send(socket, frame);
      }
    });
    this.#doc = doc;
    return doc;
  }

  #syncStep1(): Uint8Array {
    const encoder = encoding.createEncoder();
    syncProtocol.writeSyncStep1(encoder, this.#document());
    return encoding.toUint8Array(encoder);
  }

  /** Handles one frame from one socket. A bad frame closes that socket and nothing else. */
  async #handleMessage(socket: WebSocket, message: IncomingFrame): Promise<void> {
    const data = await toFrameBytes(message);
    const decoded = decodeMessage(data);
    switch (decoded.kind) {
      case 'sync': {
        const decoder = decoding.createDecoder(decoded.payload);
        const encoder = encoding.createEncoder();
        // y-protocols catches an update it cannot apply and reports it here instead of
        // throwing, so a broken payload has to be turned into a close by hand
        let rejected: unknown;
        try {
          // applies SyncStep2 / updates and turns a SyncStep1 into a SyncStep2 reply
          syncProtocol.readSyncMessage(
            decoder,
            encoder,
            this.#document(),
            socket,
            (error: Error) => {
              rejected = error;
            },
          );
        } catch (error) {
          rejected = error;
        }
        if (rejected) {
          this.#closeUnsupported(socket, 'invalid Yjs message');
          return;
        }
        const reply = encoding.toUint8Array(encoder);
        if (reply.length > 0) this.#send(socket, syncFrame(reply));
        return;
      }
      case 'awareness': {
        // relayed verbatim to everybody, sender included (see file comment)
        // (`kind === 'awareness'` already proves the frame was binary; the check only
        // tells TypeScript that `data` is not a string)
        if (typeof data === 'string') {
          this.#closeUnsupported(socket, 'text frames are not supported');
          return;
        }
        const frame = data;
        for (const other of [...this.#sockets]) this.#send(other, frame);
        return;
      }
      case 'query-awareness':
        return; // no awareness state is kept in this story
      case 'invalid':
        this.#closeUnsupported(socket, decoded.reason);
        return;
    }
  }

  /** Closes one socket with 1003; everybody else on the board is unaffected. */
  #closeUnsupported(socket: WebSocket, reason: string): void {
    this.#sockets.delete(socket);
    try {
      socket.close(CLOSE_UNSUPPORTED_DATA, reason.slice(0, 120));
    } catch {
      // the socket was already gone; the set no longer holds it
    }
  }

  /** Sends to one socket, dropping it from the room if the send fails. */
  #send(socket: WebSocket, data: Uint8Array): void {
    if (socket.readyState !== WebSocket.OPEN) {
      this.#sockets.delete(socket);
      return;
    }
    try {
      socket.send(data);
    } catch {
      this.#sockets.delete(socket);
    }
  }
}
