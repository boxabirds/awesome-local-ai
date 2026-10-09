import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import type { Env } from './index';

/** How often the room asks its sockets to report their awareness, to keep them alive. */
const KEEPALIVE_INTERVAL_MS = 10_000;

/**
 * One board's room: the board's `Y.Doc` in memory, plus the sockets of the people on
 * it.
 *
 * It is deliberately stateless beyond that. Nothing is counted (so nobody is refused
 * at `MAX_CONCURRENT_EDITORS`), nothing is stored (story 4 adds persistence), and
 * awareness is relayed without being interpreted (story 6 gives it meaning). The
 * document exists only while the object does — see the room lifecycle diagram in the
 * design — which is why every (re)connection starts with the room asking the client
 * for everything it has.
 *
 * Merging is `y-protocols`/Yjs semantics, and it is what the PRD asks for: concurrent
 * text inserts are all kept (`live.concurrent_text`), concurrent `Y.Map` sets resolve
 * to one value on every replica (`live.converge`), and an entry deleted while someone
 * was editing inside it stays deleted (`live.delete_during_edit`).
 */
export class BoardRoom extends DurableObject<Env> {
  private readonly sockets = new Set<WebSocket>();
  private doc: Y.Doc | null = null;
  private keepalive: ReturnType<typeof setInterval> | null = null;

  /**
   * WebSocket upgrade only. The Worker already rejected a malformed address and a
   * missing `Upgrade`, so a request reaching here is a client taking a seat.
   */
  fetch(request: Request): Response {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // Binary frames as ArrayBuffer, which is what `decodeMessage` reads; the runtime
    // default hands over a Blob instead.
    server.binaryType = 'arraybuffer';
    // The non-hibernating accept, on purpose: this story's document lives only in
    // memory, and hibernation would evict the object while its sockets stay open and
    // silently drop it. An open, accepted socket keeps the object alive. Story 4
    // switches to `ctx.acceptWebSocket` once the doc can be reloaded from storage.
    server.accept();
    this.attach(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** The room's document, created with the first person to join. */
  private document(): Y.Doc {
    if (this.doc === null) {
      const doc = new Y.Doc();
      // Every update one person sends is forwarded to the others as it happens: no
      // batching and no timers, which is what keeps a change inside
      // LIVE_UPDATE_LATENCY_BUDGET_MS on a normal connection (`live.propagate`).
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.broadcast(update, origin);
      });
      this.doc = doc;
    }
    return this.doc;
  }

  /** Wire one accepted socket up to the room and ask it for its state. */
  private attach(socket: WebSocket): void {
    this.sockets.add(socket);
    socket.addEventListener('message', (event: MessageEvent) => {
      this.receive(socket, event.data);
    });
    socket.addEventListener('close', () => {
      this.drop(socket);
    });
    socket.addEventListener('error', () => {
      this.drop(socket);
    });
    this.keepaliveOn();
    // SyncStep1 out, SyncStep2 back: a late joiner receives the board as it is
    // (`live.join_state`), and the first person to reconnect after a restart refills
    // the empty room with what they still have (`live.catch_up`, TC-18).
    this.send(socket, frame((encoder) => syncProtocol.writeSyncStep1(encoder, this.document())));
  }

  /** Handle one frame from one socket. */
  private receive(socket: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      // Only the sender is closed: everyone else keeps working (TC-15).
      this.close(socket, decoded.reason);
      return;
    }
    if (decoded.kind === 'awareness') {
      this.relay(data);
      return;
    }
    if (decoded.kind === 'query-awareness') {
      // There is no stored awareness in this story, so nobody can answer the query.
      return;
    }

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    try {
      // `readSyncMessage` applies the update (origin = this socket, so the broadcast
      // below skips it) and writes the reply the client still needs. Its own default
      // error handling logs a bad update and carries on; the room rethrows instead, so
      // the sender is closed and the room's document is never left half-updated (TC-15).
      syncProtocol.readSyncMessage(
        decoding.createDecoder(decoded.payload),
        encoder,
        this.document(),
        socket,
        (error: Error) => {
          throw error;
        },
      );
    } catch (error) {
      this.close(socket, `rejected sync message (${reasonOf(error)})`);
      return;
    }
    if (encoding.length(encoder) > 1) this.send(socket, encoding.toUint8Array(encoder));
  }

  /**
   * Forget one socket, and stop keeping the board alive once nobody is on it: a room
   * with no participants has nothing to say and should not hold the object open.
   */
  private drop(socket: WebSocket): void {
    this.sockets.delete(socket);
    if (this.sockets.size === 0 && this.keepalive !== null) {
      clearInterval(this.keepalive);
      this.keepalive = null;
    }
  }

  /**
   * `y-websocket` hangs up on a connection it has heard nothing from for 30 seconds,
   * and an idle board produces nothing by itself. So every `KEEPALIVE_INTERVAL_MS` the
   * room asks each socket to report its awareness; every client answers, and the answer
   * is relayed like any other awareness frame — traffic both ways, a few bytes a
   * second, and a board that has been left open all afternoon stays connected (TC-29).
   */
  private keepaliveOn(): void {
    if (this.keepalive !== null) return;
    this.keepalive = setInterval(() => {
      this.sendTo(new Uint8Array([MESSAGE_QUERY_AWARENESS]), [...this.sockets]);
    }, KEEPALIVE_INTERVAL_MS);
  }

  /**
   * Awareness goes out verbatim, to every socket including the sender: the room does not
   * know what awareness means (story 6 gives it meaning), so it does not get to
   * decide who should see it. Relaying the sender's own frame back is also what keeps an
   * idle client's watchdog fed (TC-29).
   */
  private relay(frameBytes: ArrayBuffer | string): void {
    if (typeof frameBytes === 'string') return;
    this.sendTo(new Uint8Array(frameBytes), [...this.sockets]);
  }

  /** The update one socket caused, to every other open socket (and never back). */
  private broadcast(update: Uint8Array, origin: unknown): void {
    const bytes = frame((encoder) => syncProtocol.writeUpdate(encoder, update));
    this.sendTo(
      bytes,
      [...this.sockets].filter((socket) => socket !== origin),
    );
  }

  /**
   * One send per recipient. A recipient that cannot be written to is simply gone (TC-31);
   * the room never throws because of it, and never stops serving the others.
   */
  private sendTo(bytes: Uint8Array, recipients: Iterable<WebSocket>): void {
    for (const socket of recipients) {
      if (socket.readyState !== WebSocket.OPEN) {
        this.drop(socket);
        continue;
      }
      try {
        // A copy per recipient: the runtime takes the buffer over when it sends it, so
        // the second recipient of the same array would be sent nothing at all.
        socket.send(new Uint8Array(bytes));
      } catch {
        this.drop(socket);
      }
    }
  }

  private send(socket: WebSocket, bytes: Uint8Array): void {
    this.sendTo(bytes, [socket]);
  }

  /** Close one misbehaving socket with the story's only close code. */
  private close(socket: WebSocket, reason: string): void {
    this.drop(socket);
    try {
      socket.close(CLOSE_UNSUPPORTED_DATA, reason.slice(0, 120));
    } catch {
      // Already closed: nothing else to do.
    }
  }
}

/** Wrap a y-protocols message in its y-websocket frame (`varUint(type) + payload`). */
function frame(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
