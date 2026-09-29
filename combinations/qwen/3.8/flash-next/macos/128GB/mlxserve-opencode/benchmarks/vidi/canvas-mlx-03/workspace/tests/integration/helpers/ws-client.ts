/// <reference types="@cloudflare/vitest-pool-workers" />
// A test-only Yjs client that speaks the *same* y-websocket framing as the
// browser WebsocketProvider, over a real WebSocket obtained from a real
// SELF.fetch WebSocket upgrade to the BoardRoom Durable Object. It wraps a real
// Y.Doc and uses the real y-protocols + board-model, so it exercises exactly the
// wire path the browser uses.
import { SELF } from 'cloudflare:test';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../../src/shared/board-model.ts';
import {
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
} from '../../../src/shared/protocol.ts';

function upgradeFetch(boardId: string): Promise<Response> {
  return SELF.fetch(`http://localhost/api/rooms/${boardId}`, {
    headers: { Upgrade: 'websocket' },
  });
}

export class RoomClient {
  readonly doc = new Y.Doc();
  /** Every raw frame received, in order (used by error / awareness tests). */
  readonly log: ArrayBuffer[] = [];
  synced = false;
  closeCode: number | null = null;
  closed = false;
  /** When true, local doc changes are transmitted (default on). */
  transmitting = true;
  private ws!: WebSocket;

  private constructor(readonly boardId: string) {}

  /** Open a WebSocket, complete the y-websocket initial handshake. */
  static async connect(
    boardId: string,
    opts: { emptyDoc?: boolean; prepopulate?: (doc: Y.Doc) => void } = {},
  ): Promise<RoomClient> {
    const client = new RoomClient(boardId);
    if (!opts.emptyDoc) initDoc(client.doc);
    // Seed the document purely locally, before the connection handshake, so it
    // is carried in the first SyncStep1/SyncStep2 (models a client that held the
    // board across a room restart). Runs before the update-transmitter is wired.
    opts.prepopulate?.(client.doc);
    const res = await upgradeFetch(boardId);
    if (res.status !== 101) throw new Error(`upgrade failed with status ${res.status}`);
    const ws = (res as unknown as { webSocket?: WebSocket }).webSocket;
    if (!ws) throw new Error('no webSocket on upgrade response');
    ws.accept();
    ws.binaryType = 'arraybuffer';
    client.ws = ws;

    ws.addEventListener('message', (e: MessageEvent) => {
      const data = e.data as ArrayBuffer;
      client.log.push(data);
      client.onMessage(data);
    });
    ws.addEventListener('close', (e: CloseEvent) => {
      client.closed = true;
      client.closeCode = e.code;
    });
    ws.addEventListener('error', () => {
      client.closed = true;
    });

    // Transmit local edits. Mirrors y-websocket's guard exactly: send every
    // doc update EXCEPT the ones we applied from the socket ourselves (whose
    // origin is this client), so remote updates are never echoed back.
    client.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === client || !client.transmitting) return;
      client.sendSync((enc) => syncProtocol.writeUpdate(enc, update));
    });

    // Kick off the handshake: request server state.
    client.sendSync((enc) => syncProtocol.writeSyncStep1(enc, client.doc));
    return client;
  }

  private sendSync(build: (enc: encoding.Encoder) => void): void {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    build(enc);
    this.ws.send(encoding.toUint8Array(enc));
  }

  private onMessage(buf: ArrayBuffer): void {
    const decoder = decoding.createDecoder(new Uint8Array(buf));
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_SYNC) {
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      const subType = syncProtocol.readSyncMessage(decoder, reply, this.doc, this);
      if (subType === syncProtocol.messageYjsSyncStep2) this.synced = true;
      if (encoding.length(reply) > 1) this.ws.send(encoding.toUint8Array(reply));
    }
    // Awareness / query frames are logged only; not interpreted in story 3.
  }

  /** Send arbitrary raw bytes as a binary frame (for malformed-traffic tests). */
  sendRaw(data: ArrayBuffer | Uint8Array): void {
    this.ws.send(data);
  }

  /** Send a WebSocket *text* frame (y-websocket traffic must be binary). */
  sendText(text: string): void {
    this.ws.send(text);
  }

  /** Send a raw awareness frame built around `payload`. */
  sendAwareness(payload: Uint8Array): void {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(enc, payload);
    this.ws.send(encoding.toUint8Array(enc));
  }

  /** Send a query-awareness frame. */
  sendQueryAwareness(): void {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_QUERY_AWARENESS);
    this.ws.send(encoding.toUint8Array(enc));
  }

  snapshot(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  /** Number of received frames that carry a sync message (not awareness). */
  syncMessageCount(): number {
    return this.log.filter((buf) => {
      const d = decoding.createDecoder(new Uint8Array(buf));
      try {
        return decoding.readVarUint(d) === MESSAGE_SYNC;
      } catch {
        return false;
      }
    }).length;
  }

  clearLog(): void {
    this.log.length = 0;
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

/** Wait until `cond()` is true, polling on the event loop; throws on timeout. */
export async function waitFor(
  cond: () => boolean,
  label: string,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  // Yield at least once so in-flight socket messages get delivered.
  await new Promise((r) => setTimeout(r, 0));
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out: ${label}`);
    await new Promise((r) => setTimeout(r, 2));
  }
}

/** Let queued socket traffic flush through the runtime. */
export function flush(ms = 25): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Two clients' sticky snapshots deep-equal. */
export function snapshotsEqual(a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.x !== y.x ||
      x.y !== y.y ||
      x.color !== y.color ||
      x.text !== y.text ||
      x.z !== y.z
    ) {
      return false;
    }
  }
  return true;
}

export async function connectClients(boardId: string, n: number): Promise<RoomClient[]> {
  const clients: RoomClient[] = [];
  for (let i = 0; i < n; i++) clients.push(await RoomClient.connect(boardId));
  await waitFor(() => clients.every((c) => c.synced), 'all synced');
  await flush();
  return clients;
}
