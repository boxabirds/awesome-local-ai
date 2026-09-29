import { SELF, env } from 'cloudflare:test';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
} from '@shared/protocol';
import { snapshot, StickySnapshot } from '@shared/board-model';
import type { Env } from '../../../src/worker/env';
import type { BoardRoom } from '../../../src/worker/board-room';

// Origin marker for updates applied from the wire, so our own sends don't echo.
const REMOTE = Symbol('remote');

export interface ReceivedMessage {
  outer: number;
  syncSubtype?: number;
  bytes: Uint8Array;
}

/**
 * A real Y.Doc speaking the y-websocket sync protocol over a WebSocket obtained
 * from a SELF.fetch upgrade response — identical framing to the browser provider.
 */
export class YTestClient {
  readonly doc = new Y.Doc();
  readonly received: ReceivedMessage[] = [];
  updateCount = 0;
  awarenessCount = 0;
  closed: { code: number } | null = null;
  private socket: WebSocket;
  private opened: Promise<void>;

  constructor(socket: WebSocket) {
    this.socket = socket;
    this.opened = new Promise<void>((resolve) => {
      if (socket.readyState === WebSocket.OPEN) return resolve();
      socket.addEventListener('open', () => resolve(), { once: true });
    });
    this.socket.addEventListener('message', (event) => this.onMessage(event.data));
    this.socket.addEventListener('close', (event) => {
      this.closed = { code: (event as CloseEvent).code };
    });
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE) this.sendUpdate(update);
    });
  }

  /** Wait for the socket to be open, then kick off sync with SyncStep1. */
  async connect(): Promise<void> {
    await this.opened;
    this.sendSyncStep1();
  }

  async waitForOpen(): Promise<void> {
    await this.opened;
  }

  private sendSyncStep1() {
    this.writeSync((enc) => syncProtocol.writeSyncStep1(enc, this.doc));
  }

  sendUpdate(update: Uint8Array) {
    this.writeSync((enc) => syncProtocol.writeUpdate(enc, update));
  }

  private writeSync(fn: (enc: encoding.Encoder) => void) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    fn(enc);
    this.rawSend(encoding.toUint8Array(enc));
  }

  sendAwareness(payload: Uint8Array) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(enc, payload);
    this.rawSend(encoding.toUint8Array(enc));
  }

  sendQueryAwareness() {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_QUERY_AWARENESS);
    this.rawSend(encoding.toUint8Array(enc));
  }

  /** Send arbitrary bytes verbatim (used for malformed-traffic tests). */
  rawSend(bytes: Uint8Array) {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(bytes);
    }
  }

  /** Send a UTF-8 text frame (the room must reject these as invalid). */
  sendTextFrame(text: string) {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(text);
    }
  }

  private onMessage(data: unknown) {
    const bytes = toBytes(data);
    // Inspect with one decoder, feed another so readSyncMessage starts correctly.
    const inspect = decoding.createDecoder(bytes);
    const outer = decoding.readVarUint(inspect);
    let syncSubtype: number | undefined;
    if (outer === MESSAGE_SYNC) syncSubtype = decoding.readVarUint(inspect);
    this.received.push({ outer, syncSubtype, bytes });
    if (outer === MESSAGE_SYNC && syncSubtype === 2) this.updateCount++;
    if (outer === MESSAGE_AWARENESS) this.awarenessCount++;

    if (outer === MESSAGE_SYNC) {
      const dec = decoding.createDecoder(bytes);
      decoding.readVarUint(dec); // consume MESSAGE_SYNC
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(dec, reply, this.doc, REMOTE);
      if (encoding.length(reply) > 1) this.rawSend(encoding.toUint8Array(reply));
    }
    // awareness / query-awareness: nothing to apply in these tests.
  }

  close(code?: number) {
    try {
      this.socket.close(code);
    } catch {
      /* already closed */
    }
  }

  /** Abruptly drop the socket (used for the dead-socket error path TC-31). */
  destroy() {
    try {
      this.socket.close();
    } catch {
      /* ignore */
    }
  }

  snapshot(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }
}

function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  throw new Error(`unexpected websocket payload: ${typeof data}`);
}

/** Ensure a board exists by calling the initialize RPC before opening a socket. */
async function ensureBoard(boardId: string): Promise<void> {
  const doEnv = env as unknown as Env;
  const id = doEnv.BOARD_ROOM.idFromName(boardId);
  const stub = doEnv.BOARD_ROOM.get(id) as DurableObjectStub<BoardRoom>;
  await stub.initialize();
}

/** Open a websocket to the room for `boardId` through the worker entry. */
export async function openRoomClient(boardId: string): Promise<YTestClient> {
  await ensureBoard(boardId);
  const res = await SELF.fetch(`http://localhost/api/rooms/${boardId}`, {
    headers: { Upgrade: 'websocket', 'Connection': 'Upgrade' },
  });
  if (res.status !== 101 || !res.webSocket) {
    throw new Error(`expected 101 upgrade, got ${res.status}`);
  }
  const client = new YTestClient(res.webSocket);
  // workerd: the client half must be accepted before it starts flowing.
  res.webSocket.accept();
  await client.connect();
  return client;
}

/** Poll a predicate until true or the timeout elapses; throws with a message. */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 4000,
  message = 'condition not met',
): Promise<void> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (predicate()) return;
    if (Date.now() - start > timeoutMs) throw new Error(message);
    await new Promise((r) => setTimeout(r, 5));
  }
}

export function snapshotsMatch(
  a: readonly StickySnapshot[],
  b: readonly StickySnapshot[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (snapKey(a[i]) !== snapKey(b[i])) return false;
  }
  return true;
}

export function snapKey(n: StickySnapshot): string {
  return `${n.id}|${n.x}|${n.y}|${n.color}|${n.text}|${n.z}`;
}
