/**
 * Integration test client: a real Y.Doc speaking y-protocols over a real WebSocket obtained
 * from the Worker's upgrade response — the same framing as the browser's WebsocketProvider
 * (SyncStep1 on open, SyncStep2 in reply to the server's SyncStep1, updates as they happen).
 */
import { SELF } from 'cloudflare:test';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { vi } from 'vitest';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { MESSAGE_AWARENESS, MESSAGE_SYNC } from '../../src/shared/protocol';

export const ORIGIN = 'http://vidi6.test';
/** Origin of updates applied from the server, so they are never sent back. */
export const REMOTE_ORIGIN = Symbol('remote');
const HTTP_SWITCHING_PROTOCOLS = 101;
const WAIT_TIMEOUT_MS = 5000;
const WAIT_INTERVAL_MS = 5;

export type Received =
  | { type: 'sync'; syncType: number; bytes: Uint8Array }
  | { type: 'awareness'; bytes: Uint8Array }
  | { type: 'other'; bytes: Uint8Array };

export interface TestClient {
  doc: Y.Doc;
  ws: WebSocket;
  /** Every frame received, in order. */
  received: Received[];
  /** Resolves when the first SyncStep2 from the server has been applied. */
  synced: Promise<void>;
  /** Resolves with the close code when the server closes this socket. */
  closed: Promise<number>;
  isOpen(): boolean;
  /** Queue local updates instead of sending them (to create truly concurrent edits). */
  hold(): void;
  /** Send every queued update, in order, and resume live sending. */
  release(): void;
  sendRaw(data: ArrayBuffer | ArrayBufferView | string): void;
  /**
   * Round trip: sends SyncStep1 and waits for the SyncStep2 reply. The room handles one
   * socket's frames in order, so anything it sent this client earlier has arrived by then.
   */
  barrier(): Promise<void>;
  /** Number of document update frames (sync type update) received so far. */
  updateCount(): number;
  close(): void;
}

function toBytes(write: (e: encoding.Encoder) => void): Uint8Array {
  const e = encoding.createEncoder();
  write(e);
  return encoding.toUint8Array(e);
}

export async function upgrade(boardId: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/rooms/${boardId}`, { headers: { Upgrade: 'websocket' } });
}

export async function connect(boardId: string, doc: Y.Doc = new Y.Doc()): Promise<TestClient> {
  const res = await upgrade(boardId);
  if (res.status !== HTTP_SWITCHING_PROTOCOLS || !res.webSocket) {
    throw new Error(`upgrade failed: ${res.status}`);
  }
  const ws = res.webSocket;
  ws.binaryType = 'arraybuffer';
  ws.accept();

  const received: Received[] = [];
  let held: Uint8Array[] | null = null;
  let open = true;
  let resolveSynced!: () => void;
  const synced = new Promise<void>((r) => {
    resolveSynced = r;
  });
  let resolveClosed!: (code: number) => void;
  const closed = new Promise<number>((r) => {
    resolveClosed = r;
  });
  const step2Waiters: (() => void)[] = [];

  const send = (bytes: Uint8Array) => {
    if (held) held.push(bytes);
    else if (open) ws.send(bytes);
  };

  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN) return;
    send(
      toBytes((e) => {
        encoding.writeVarUint(e, MESSAGE_SYNC);
        syncProtocol.writeUpdate(e, update);
      }),
    );
  };
  doc.on('update', onUpdate);

  ws.addEventListener('message', (event: MessageEvent) => {
    if (typeof event.data === 'string') {
      received.push({ type: 'other', bytes: new TextEncoder().encode(event.data) });
      return;
    }
    const bytes = new Uint8Array(event.data as ArrayBuffer);
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_AWARENESS) {
      received.push({ type: 'awareness', bytes });
      return;
    }
    if (type !== MESSAGE_SYNC) {
      received.push({ type: 'other', bytes });
      return;
    }
    const syncType = decoding.readVarUint(decoder);
    received.push({ type: 'sync', syncType, bytes });
    if (syncType === syncProtocol.messageYjsSyncStep1) {
      const sv = decoding.readVarUint8Array(decoder);
      ws.send(
        toBytes((e) => {
          encoding.writeVarUint(e, MESSAGE_SYNC);
          encoding.writeVarUint(e, syncProtocol.messageYjsSyncStep2);
          encoding.writeVarUint8Array(e, Y.encodeStateAsUpdate(doc, sv));
        }),
      );
      return;
    }
    Y.applyUpdate(doc, decoding.readVarUint8Array(decoder), REMOTE_ORIGIN);
    if (syncType === syncProtocol.messageYjsSyncStep2) {
      resolveSynced();
      step2Waiters.splice(0).forEach((w) => w());
    }
  });
  ws.addEventListener('close', (event: CloseEvent) => {
    open = false;
    doc.off('update', onUpdate);
    resolveClosed(event.code);
  });

  const sendStep1 = () =>
    ws.send(
      toBytes((e) => {
        encoding.writeVarUint(e, MESSAGE_SYNC);
        syncProtocol.writeSyncStep1(e, doc);
      }),
    );
  sendStep1();

  return {
    doc,
    ws,
    received,
    synced,
    closed,
    isOpen: () => open,
    hold() {
      held ??= [];
    },
    release() {
      const queue = held ?? [];
      held = null;
      queue.forEach(send);
    },
    sendRaw(data) {
      ws.send(data as ArrayBuffer);
    },
    barrier() {
      return new Promise<void>((resolve) => {
        step2Waiters.push(resolve);
        sendStep1();
      });
    },
    updateCount: () =>
      received.filter((m) => m.type === 'sync' && m.syncType === syncProtocol.messageYjsUpdate).length,
    close() {
      if (!open) return;
      open = false;
      doc.off('update', onUpdate);
      ws.close();
    },
  };
}

/** Connects and waits for the initial sync. */
export async function join(boardId: string, doc?: Y.Doc): Promise<TestClient> {
  const client = await connect(boardId, doc);
  await client.synced;
  return client;
}

/** Polls until `check` stops throwing. */
export function eventually<T>(check: () => T, timeout = WAIT_TIMEOUT_MS): Promise<T> {
  return vi.waitFor(check, { timeout, interval: WAIT_INTERVAL_MS });
}

/** Whole-document comparison that includes the notes' text, colours, positions and meta. */
export function docJson(doc: Y.Doc): unknown {
  return { objects: doc.getMap('objects').toJSON(), meta: doc.getMap('meta').toJSON() };
}
