// Story 3: BoardRoom Durable Object (anchor: sync.room).
//
// A plain WebSocket relay per board. Deliberately NOT y-websocket's server
// (no auth, no Awareness store, no hibernation): the doc is rebuilt by the
// clients' sync exchange every time the room starts empty, so a restarted
// room is repopulated by the first reconnecting client's step2 — no storage
// persistence is required in this story (live.restart).
//
// Rules:
// - accept: add the socket, lazily create the doc, send our SyncStep1.
// - sync frames: processed with y-protocols; any response goes only to the
//   sender; doc updates are broadcast to every OTHER socket (the sender's
//   socket is the update's origin, so it never echoes back to itself).
// - awareness frames: relayed verbatim to ALL sockets including the sender —
//   the y-websocket client's watchdog requires this (a solo user must keep
//   receiving their own awareness updates, which update every ~15s).
// - query-awareness frames: ignored in this story (presence UI is story 6).
// - a frame decodeMessage marks invalid closes the SENDER's socket with
//   CLOSE_UNSUPPORTED_DATA (1003); other sockets are unaffected. The
//   y-websocket client treats 1003 as transient and reconnects with a full
//   resync.
//
// Sockets that fail to accept a send are dropped immediately, so a dead
// peer can never throw out of a broadcast.

import { DurableObject } from 'cloudflare:workers';
import { createDecoder } from 'lib0/decoding';
import {
  createEncoder,
  length,
  toUint8Array,
  writeVarUint,
  writeVarUint8Array,
} from 'lib0/encoding';
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
} from '../shared/protocol';

/** Worker bindings (see wrangler.jsonc). */
export interface Env {
  BOARD_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export class BoardRoom extends DurableObject<Env> {
  private sockets = new Set<WebSocket>();
  private doc: Y.Doc | null = null;

  async fetch(req: Request): Promise<Response> {
    const upgrade = req.headers.get('Upgrade');
    if (upgrade === null || !upgrade.toLowerCase().includes('websocket')) {
      return new Response('Upgrade Required', { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // New workers-types API: accept() opens the socket in place (returns void).
    server.accept();
    // Deliver binary frames as ArrayBuffer. The WebSocket spec default is
    // 'blob', and wrangler dev honors that (the workerd test pool hands
    // over ArrayBuffers by default); pin it so both runtimes match.
    server.binaryType = 'arraybuffer';
    this.addSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Lazily create the board doc; its update handler is the broadcast path. */
  private docOrInit(): Y.Doc {
    if (this.doc === null) {
      const doc = new Y.Doc();
      doc.on('update', (update, origin) => {
        this.broadcastUpdate(update, origin as WebSocket | null);
      });
      this.doc = doc;
    }
    return this.doc;
  }

  private addSocket(ws: WebSocket): void {
    this.sockets.add(ws);
    // Our state vector tells a fresh client exactly what to request.
    const enc = createEncoder();
    writeVarUint(enc, MESSAGE_SYNC);
    writeSyncStep1(enc, this.docOrInit());
    this.send(ws, toUint8Array(enc).buffer as ArrayBuffer);
    ws.addEventListener('message', (ev: MessageEvent) => {
      this.onMessage(ws, ev.data as ArrayBuffer | string);
    });
    const drop = (): void => {
      this.sockets.delete(ws);
      // Complete the close handshake: in this workerd build the peer stays
      // CLOSING until we close our side too.
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
        try {
          ws.close();
        } catch {
          // already closed
        }
      }
    };
    ws.addEventListener('close', drop);
    ws.addEventListener('error', drop);
  }

  private onMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      // Malformed frame: drop this socket; the others keep working.
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }
    if (decoded.kind === 'query-awareness') {
      return; // ignored in this story
    }
    if (decoded.kind === 'awareness') {
      // Verbatim relay to everyone, INCLUDING the sender (watchdog): the
      // frame is the type byte plus the untouched payload (decoded.payload
      // runs from right after the type byte to the end of the frame).
      const frame = new Uint8Array(decoded.payload.length + 1);
      frame[0] = MESSAGE_AWARENESS;
      frame.set(decoded.payload, 1);
      this.sendAll(frame.buffer as ArrayBuffer);
      return;
    }
    // sync
    const dec = createDecoder(decoded.payload);
    const enc = createEncoder();
    writeVarUint(enc, MESSAGE_SYNC);
    try {
      // readSyncStep2 swallows applyUpdate errors unless given an error
      // handler: rethrow here so the catch closes the socket.
      readSyncMessage(dec, enc, this.docOrInit(), ws, (error) => {
        throw error;
      });
    } catch {
      // Framing was valid but the doc rejects the update: same close code.
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }
    // A response (if any) goes only to the sender; the doc's update handler
    // takes care of broadcasting to the others (excluding `ws`).
    if (length(enc) > 1) {
      this.send(ws, toUint8Array(enc).buffer as ArrayBuffer);
    }
  }

  /** Frame a doc update as a sync update and send it to all but `origin`. */
  private broadcastUpdate(update: Uint8Array, origin: WebSocket | null): void {
    const enc = createEncoder();
    writeVarUint(enc, MESSAGE_SYNC);
    writeUpdate(enc, update);
    this.sendAll(toUint8Array(enc).buffer as ArrayBuffer, origin);
  }

  private send(ws: WebSocket, frame: ArrayBuffer): void {
    if (!this.sockets.has(ws)) return;
    if (ws.readyState !== WebSocket.OPEN) {
      this.sockets.delete(ws);
      return;
    }
    try {
      ws.send(frame);
    } catch {
      this.sockets.delete(ws);
    }
  }

  private sendAll(frame: ArrayBuffer, except: WebSocket | null = null): void {
    for (const ws of this.sockets) {
      if (ws === except) continue;
      if (ws.readyState !== WebSocket.OPEN) {
        this.sockets.delete(ws);
        continue;
      }
      try {
        ws.send(frame);
      } catch {
        this.sockets.delete(ws);
      }
    }
  }
}
