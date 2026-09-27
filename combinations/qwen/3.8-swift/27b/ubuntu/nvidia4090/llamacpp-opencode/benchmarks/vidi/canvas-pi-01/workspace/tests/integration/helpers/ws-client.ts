// Real WebSocket client that speaks the y-websocket protocol against the live
// worker (the same framing as y-websocket's WebsocketProvider), used by the
// integration tests. It obtains its socket from `SELF.fetch` (workerd's
// in-isolate upgrade) and applies the sync + awareness protocols with
// y-protocols, so the tests drive the *real* DO with real protocol traffic.

import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { AWARENESS_HEARTBEAT_MS } from '../../../src/shared/config';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  encodeFrameMessage,
} from '../../../src/shared/protocol';
import type { StickySnapshot } from '../../../src/shared/board-model';
import { snapshot } from '../../../src/shared/board-model';

// Origin tag for updates that arrive from the room (never re-broadcast).
const REMOTE_ORIGIN = 'remote';

export interface RoomClientOptions {
  user?: string;
  /** Reuse an existing doc (e.g. a reconnecting client, spec TC-18). */
  doc?: Y.Doc;
}

export class RoomClient {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  readonly ws: WebSocket;
  /** Sync frames received from the room, in order (payload[0] is the type). */
  readonly receivedSync: Uint8Array[] = [];
  /** Awareness payloads received from the room, in order. */
  readonly receivedAwareness: Uint8Array[] = [];
  /** Resolves with the close code once the socket closes. */
  readonly closePromise: Promise<number>;
  private closed = false;
  private closeResolve: ((code: number) => void) | null = null;

  constructor(ws: WebSocket, user: string, doc?: Y.Doc) {
    this.doc = doc ?? new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.ws = ws;

    this.ws.addEventListener('message', (event) => this.onMessage(event.data));
    this.closePromise = new Promise<number>((resolve) => {
      this.closeResolve = resolve;
      this.ws.addEventListener('close', (event) => resolve(event.code));
    });

    // Send our state vector (SyncStep1) so the room replies with the updates
    // we lack (SyncStep2). Mirrors y-websocket's onopen behaviour; the socket
    // is already open (accepted) by the time the constructor runs, and workerd
    // does not fire an 'open' event, so we send directly.
    if (this.ws.readyState === WebSocket.OPEN) {
      const encoder = encoding.createEncoder();
      syncProtocol.writeSyncStep1(encoder, this.doc);
      this.ws.send(encodeFrameMessage(MESSAGE_SYNC, encoding.toUint8Array(encoder)));
    }

    // Broadcast local (non-remote) doc updates to the room, wrapped as a
    // y-protocols UPDATE sync message (type prefix + update).
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE_ORIGIN && this.ws.readyState === WebSocket.OPEN) {
        const encoder = encoding.createEncoder();
        syncProtocol.writeUpdate(encoder, update);
        this.ws.send(encodeFrameMessage(MESSAGE_SYNC, encoding.toUint8Array(encoder)));
      }
    });

    // Local awareness state (drives the room's presence awareness), and
    // broadcast local awareness changes to the room (as y-websocket does).
    this.awareness.on('update', (u: { added: number[]; updated: number[]; removed: number[] }) => {
      const changed = [...u.added, ...u.updated, ...u.removed];
      if (changed.length === 0 || this.ws.readyState !== WebSocket.OPEN) return;
      const payload = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed);
      this.ws.send(encodeFrameMessage(MESSAGE_AWARENESS, payload));
    });
    this.awareness.setLocalState({ user });

    // Awareness heartbeat (mirrors connectBoard): a periodic local-state
    // change keeps awareness frames flowing, which the room relays back so
    // idle sockets keep receiving traffic (spec TC-31).
    this.heartbeat = setInterval(() => {
      if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
      this.awareness.setLocalStateField('lastSeen', Date.now());
    }, AWARENESS_HEARTBEAT_MS);
  }

  private heartbeat: ReturnType<typeof setInterval> | undefined;

  private onMessage(data: unknown): void {
    if (typeof data === 'string') return; // binary protocol only
    const message = decodeMessage(data as ArrayBuffer);
    if (message.kind === 'sync') {
      this.receivedSync.push(message.payload);
      const decoder = decoding.createDecoder(message.payload);
      const encoder = encoding.createEncoder();
      syncProtocol.readSyncMessage(decoder, encoder, this.doc, REMOTE_ORIGIN);
      if (encoding.length(encoder) > 0) {
        this.ws.send(encodeFrameMessage(MESSAGE_SYNC, encoding.toUint8Array(encoder)));
      }
    } else if (message.kind === 'awareness') {
      this.receivedAwareness.push(message.payload);
      awarenessProtocol.applyAwarenessUpdate(this.awareness, message.payload, REMOTE_ORIGIN);
    }
  }

  /** Count of UPDATE sync frames (type 2) received from the room. */
  get updateMessageCount(): number {
    return this.receivedSync.filter((p) => p[0] === 2).length;
  }

  noteCount(): number {
    return snapshot(this.doc).length;
  }

  boardState(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  remoteUsers(): string[] {
    const out: string[] = [];
    for (const state of this.awareness.getStates().values()) {
      if (typeof state?.user === 'string') out.push(state.user);
    }
    return out;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat);
    this.awareness.destroy();
    try {
      this.ws.close();
    } catch {
      // already closed (e.g. the room closed it for unsupported data)
    }
    this.doc.destroy();
  }

  /** Wait for the socket to close and return the close code. */
  async waitForClose(timeoutMs = 4000): Promise<number> {
    return Promise.race([
      this.closePromise,
      new Promise<number>((_, reject) =>
        setTimeout(() => reject(new Error('timed out waiting for close')), timeoutMs),
      ),
    ]);
  }
}

/** Connect a live client to the room for `boardId` via the worker. */
export async function connectRoom(boardId: string, options: RoomClientOptions = {}): Promise<RoomClient> {
  // Story 5: rooms no longer create storage implicitly — initialize the
  // board first (what POST /api/boards does in the product), then connect.
  // initialize() never throws ('error' just means the room will handle the
  // board's state itself on connect — e.g. the failing-store test TC-26).
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  await runInDurableObject(stub, (room) => room.initialize());
  const res = await SELF.fetch(`http://localhost/api/rooms/${boardId}`, {
    headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
  });
  const socket = res.webSocket!;
  socket.accept();
  return new RoomClient(socket, options.user ?? 'client', options.doc);
}

/** Poll until `fn` returns truthy or the timeout elapses. */
export async function waitFor(
  fn: () => boolean,
  timeoutMs = 4000,
  label = 'condition',
): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
