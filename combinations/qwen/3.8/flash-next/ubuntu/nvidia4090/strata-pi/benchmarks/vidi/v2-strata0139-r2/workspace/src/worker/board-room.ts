/**
 * BoardRoom — one Durable Object per board (`sync.room`).
 *
 * The room is a *relay*, not a server with its own opinions:
 *
 * - it holds the board's `Y.Doc` in memory (story 4 persists it);
 * - every document update it applies is forwarded to every other socket
 *   immediately, so a change reaches the other screens within
 *   LIVE_UPDATE_LATENCY_BUDGET_MS and the sender never gets an echo;
 * - on accept it sends its own SyncStep1, so a client reconnecting to a
 *   restarted room repopulates it with the state the room has lost;
 * - awareness bytes are relayed verbatim to *all* sockets, sender included,
 *   which is what keeps idle clients' y-websocket watchdog from closing an
 *   otherwise quiet connection. Interpreting presence is story 6.
 *
 * WebSockets are accepted with the non-hibernating `server.accept()` on
 * purpose: until story 4 the document exists only in this object's memory, and
 * hibernation could evict the object (and with it the board) while sockets are
 * still open. An open, accepted socket keeps the instance alive.
 */

import { DurableObject } from "cloudflare:workers";
import * as Y from "yjs";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from "../shared/protocol";
import type { Env } from "./index";

/** `WebSocket.OPEN`. */
const SOCKET_OPEN = 1;

export class BoardRoom extends DurableObject<Env> {
  /**
   * The board's document, created on the first accepted socket and discarded
   * when the runtime evicts this instance. Public so tests can inspect the
   * room's own state (`runInDurableObject`).
   */
  doc: Y.Doc | null = null;

  private readonly sockets = new Set<WebSocket>();

  /** WebSocket upgrade only; anything else is answered with 426. */
  fetch(request: Request): Response {
    if (!isUpgradeRequest(request)) {
      return new Response("Upgrade Required", { status: 426 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    const socket = server;
    socket.accept();
    this.join(socket);

    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- sockets ------------------------------------------------------------

  private join(socket: WebSocket): void {
    this.sockets.add(socket);

    socket.addEventListener("message", (event: MessageEvent) => {
      this.onMessage(socket, event.data as ArrayBuffer | string);
    });
    socket.addEventListener("close", () => this.leave(socket));
    socket.addEventListener("error", () => this.leave(socket));

    // Ask the newcomer for its state: a room that lost its document (restart,
    // eviction, or simply this board's first connection) is repopulated by the
    // SyncStep2 this request provokes.
    this.send(socket, this.syncFrame((encoder) => syncProtocol.writeSyncStep1(encoder, this.document())));
  }

  private leave(socket: WebSocket): void {
    this.sockets.delete(socket);
  }

  /** A frame the room understood badly: close *this* socket, spare the rest. */
  private reject(socket: WebSocket, reason: string): void {
    this.leave(socket);
    try {
      socket.close(CLOSE_UNSUPPORTED_DATA, reason.slice(0, 120));
    } catch {
      // Already closing; the socket is out of the set either way.
    }
  }

  private onMessage(socket: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);

    switch (decoded.kind) {
      case "sync":
        this.onSync(socket, decoded.payload);
        return;
      case "awareness":
        // Verbatim, including back to the sender.
        this.broadcast(this.awarenessFrame(decoded.payload), null);
        return;
      case "query-awareness":
        // No awareness state is stored in this story (presence is story 6).
        return;
      case "invalid":
        this.reject(socket, decoded.reason);
        return;
    }
  }

  // ---- y-protocols sync ---------------------------------------------------

  private onSync(socket: WebSocket, body: Uint8Array): void {
    const doc = this.document();
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    const decoder = decoding.createDecoder(body);

    // `readSyncMessage` reports a body Yjs cannot apply through this handler
    // instead of throwing: that one socket is closed, the room is untouched.
    let rejected = false;
    const onError = (error: Error): void => {
      rejected = true;
      this.reject(socket, error.message);
    };

    try {
      // `socket` is the transaction origin: the update listener uses it to
      // skip the sender, so nobody receives their own change back.
      syncProtocol.readSyncMessage(decoder, encoder, doc, socket, onError);
    } catch (error) {
      // A body that is not a sync message at all (an unknown sync step).
      this.reject(socket, error instanceof Error ? error.message : "invalid sync message");
      return;
    }

    // `length > 1` means readSyncMessage wrote an actual reply.
    if (!rejected && encoding.length(encoder) > 1) this.send(socket, encoding.toUint8Array(encoder));
  }

  private document(): Y.Doc {
    if (this.doc === null) {
      const doc = new Y.Doc();
      doc.on("update", (update: Uint8Array, origin: unknown) => {
        this.broadcast(this.syncFrame((encoder) => syncProtocol.writeUpdate(encoder, update)), origin);
      });
      this.doc = doc;
    }
    return this.doc;
  }

  // ---- framing ------------------------------------------------------------

  private syncFrame(write: (encoder: encoding.Encoder) => void): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    write(encoder);
    return encoding.toUint8Array(encoder);
  }

  private awarenessFrame(body: Uint8Array): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeUint8Array(encoder, body);
    return encoding.toUint8Array(encoder);
  }

  /**
   * Sends to every open socket except `except` (compare by identity; `null`
   * sends to all). A socket that cannot be written to is dropped from the set
   * so one dead peer can never break the room for the others.
   */
  private broadcast(bytes: Uint8Array, except: unknown): void {
    for (const socket of Array.from(this.sockets)) {
      if (socket === except) continue;
      this.send(socket, bytes);
    }
  }

  private send(socket: WebSocket, bytes: Uint8Array): void {
    if (socket.readyState !== SOCKET_OPEN) {
      this.leave(socket);
      return;
    }
    try {
      socket.send(bytes);
    } catch {
      this.leave(socket);
    }
  }
}

function isUpgradeRequest(request: Request): boolean {
  return (request.headers.get("Upgrade") ?? "").toLowerCase() === "websocket";
}
