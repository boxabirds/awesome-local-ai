/**
 * A second person at the board, without a browser.
 *
 * `TestClient` is the integration test's participant: a real `Y.Doc` behind a real
 * WebSocket to the real Worker, speaking the same frames `y-websocket` speaks —
 * SyncStep1 on open, `y-protocols/sync` updates, length-prefixed awareness — so a
 * test that passes here exercises the same wire format as a browser.
 *
 * Open one with `join()`:
 *
 * ```ts
 * const a = await join(boardId);
 * const b = await join(boardId);
 * createSticky(a.doc, { x: 10, y: 20 });
 * await b.waitForUpdates(1);
 * expect(b.snapshot()).toEqual(a.snapshot());
 * ```
 *
 * A client is a plain object rather than a harness: `doc` is public so tests drive
 * it with the real `src/shared/board-model.ts` mutators, and `received` is public
 * so a test can count what actually crossed the wire instead of inferring it from
 * the document.
 */

import { SELF } from 'cloudflare:test';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  frameBytes
} from '../../../src/shared/protocol';
import { initDoc, snapshot, type StickySnapshot } from '../../../src/shared/board-model';

/** How long a wait for the room is patient enough before a test calls it a failure. */
const DEFAULT_TIMEOUT_MS = 5000;

/** One frame the client received, typed. `syncType` is the byte inside a sync frame. */
export interface ReceivedFrame {
  /** `MESSAGE_SYNC`, `MESSAGE_AWARENESS`, … or -1 for a frame that did not decode. */
  readonly type: number;
  /** For sync frames: 0 SyncStep1, 1 SyncStep2, 2 update. Otherwise -1. */
  readonly syncType: number;
  readonly payload: Uint8Array;
}

/** What `join` can be told. */
export interface JoinOptions {
  /** Use this document instead of making one (a test that already has content). */
  doc?: Y.Doc;
  /** Do not send SyncStep1 on open — for testing a client that never asks. */
  silent?: boolean;
}

/** One frame of the wire protocol: a message type, then whatever writes. */
function frame(type: number, write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

/** The first byte of a sync payload, without consuming it. */
function syncTypeOf(payload: Uint8Array): number {
  try {
    return decoding.readVarUint(decoding.createDecoder(payload));
  } catch {
    return -1;
  }
}

/** Resolve `onDone` after `ms`, remembering to cancel it. */
function later(ms: number, onDone: () => void): () => void {
  const timer = setTimeout(onDone, ms);
  return () => clearTimeout(timer);
}

/**
 * A client of one board's room. Everything async waits for something a real
 * participant would notice: the handshake, the first sync, an update arriving, the
 * socket closing.
 */
export class TestClient {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  /** Every frame received, oldest first. */
  readonly received: ReceivedFrame[] = [];
  /** Awareness payloads received, exactly as they came in. */
  readonly awarenessFrames: Uint8Array[] = [];
  /** Sends that the socket refused (a test asserts this stays at zero). */
  sendFailures = 0;
  /** Frames the socket accepted. */
  framesSent = 0;
  /** Yjs refused to apply something the room sent — the message, not swallowed. */
  readonly applyErrors: string[] = [];

  #socket: WebSocket;
  #synced = false;
  #closeInfo: { code: number; reason: string } | null = null;
  readonly #syncWaiters: (() => void)[] = [];
  readonly #closeWaiters: ((info: { code: number; reason: string }) => void)[] = [];

  /** Internal: use `join`, which does the handshake. */
  static open(socket: WebSocket, doc: Y.Doc): TestClient {
    return new TestClient(socket, doc);
  }

  private constructor(socket: WebSocket, doc: Y.Doc) {
    this.#socket = socket;
    this.doc = doc;
    this.awareness = new awarenessProtocol.Awareness(doc);

    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // Ourselves: a remote update we just applied, not something to relay.
      if (origin === this) return;
      this.send(frame(MESSAGE_SYNC, (encoder) => syncProtocol.writeUpdate(encoder, update)));
    });

    socket.addEventListener('message', (event) => {
      void this.#onFrame(event.data);
    });
    socket.addEventListener('close', (event) => {
      const info = { code: event.code, reason: event.reason };
      this.#closeInfo = info;
      for (const waiter of this.#closeWaiters.splice(0)) waiter(info);
    });
    socket.addEventListener('error', () => {
      // A socket that errors without a close event still counts as closed here.
      if (this.#closeInfo === null) {
        this.#closeInfo = { code: 1006, reason: 'error' };
        for (const waiter of this.#closeWaiters.splice(0)) waiter(this.#closeInfo);
      }
    });
  }

  /** The board this client is on, from its own awareness client id. */
  get clientId(): number {
    return this.doc.clientID;
  }

  /** Is this socket closed (by us, by the room, or by the transport)? */
  get closed(): boolean {
    return this.#closeInfo !== null;
  }

  /** Has the initial exchange finished (SyncStep2 received)? */
  get synced(): boolean {
    return this.#synced;
  }

  /** How many update frames arrived — the traffic, not the resulting content. */
  get updateCount(): number {
    return this.received.filter((f) => f.type === MESSAGE_SYNC && f.syncType === syncProtocol.messageYjsUpdate).length;
  }

  /**
   * Send bytes as they are, without touching the document — malformed traffic, and
   * the ordinary case of a socket that closed under us. A client that cannot send
   * has nothing to say about it; the room decides what a frame means.
   */
  send(data: Uint8Array | string): void {
    this.framesSent += 1;
    try {
      this.#socket.send(data);
    } catch {
      // The socket is gone. Tests that care wait for the close event.
      this.sendFailures += 1;
    }
  }

  /**
   * A sync frame carrying `payload` verbatim — for traffic no client would ever
   * send. A sync payload is not length-prefixed: its first byte is the sync type.
   */
  sendSyncPayload(payload: Uint8Array): void {
    this.send(frame(MESSAGE_SYNC, (encoder) => encoding.writeUint8Array(encoder, payload)));
  }

  /** Send an awareness update for our own state, framed like `y-websocket` does. */
  sendAwareness(state: Record<string, unknown>): void {
    this.awareness.setLocalStateField('cursor', state);
    const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]);
    this.send(frame(MESSAGE_AWARENESS, (encoder) => encoding.writeVarUint8Array(encoder, update)));
  }

  /** Ask the room for everybody's awareness state. */
  sendQueryAwareness(): void {
    this.send(frame(MESSAGE_QUERY_AWARENESS, () => {}));
  }

  /** Wait until the room has answered our SyncStep1. */
  waitForSync(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    if (this.#synced) return Promise.resolve();
    return this.#waitFor((resolve) => this.#syncWaiters.push(resolve), timeoutMs, 'sync');
  }

  /**
   * Wait until nothing arrives on this socket for `stillMs`.
   *
   * Joining is not one exchange: the room greets the newcomer with SyncStep1, the
   * newcomer answers, and a reply from each side can still be on the wire. A test that
   * counts traffic has to let the greeting land first or it is measuring the greeting as
   * well as the change — and the wire can carry one change twice when it crosses a
   * handshake, because that is what Yjs merging is for. So "exactly one update" is only a
   * claim about a quiet wire (`NOTES.md`).
   */
  waitUntilQuiet(stillMs = 40, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    const started = Date.now();
    let seen = this.received.length;
    let quietFor = 0;
    return new Promise((resolve, reject) => {
      const tick = () => {
        if (this.received.length !== seen) {
          seen = this.received.length;
          quietFor = 0;
        } else {
          quietFor += 10;
        }
        if (quietFor >= stillMs) resolve();
        else if (Date.now() - started > timeoutMs) {
          reject(new Error(`timed out after ${timeoutMs}ms waiting for the wire to go quiet`));
        } else {
          setTimeout(tick, 10);
        }
      };
      tick();
    });
  }

  /** Wait until at least `count` update frames have arrived. */
  waitForUpdates(count: number, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    return TestClient.waitUntil(() => this.updateCount >= count, timeoutMs, `${count} update frame(s)`);
  }

  /** Wait until a predicate holds — the eventual-consistency assertion. */
  static waitUntil(
    predicate: () => boolean,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    what = 'condition'
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (predicate()) {
        resolve();
        return;
      }
      const cancelTimeout = later(timeoutMs, () => {
        stop();
        reject(new Error(`timed out after ${timeoutMs}ms waiting for ${what}`));
      });
      const timer = setInterval(() => {
        if (!predicate()) return;
        cancelTimeout();
        stop();
        resolve();
      }, 5);
      function stop(): void {
        clearInterval(timer);
      }
    });
  }

  /** Wait for this socket to be closed, by whoever. */
  waitForClose(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ code: number; reason: string }> {
    const existing = this.#closeInfo;
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const cancelTimeout = later(timeoutMs, () => reject(new Error(`timed out after ${timeoutMs}ms waiting for close`)));
      this.#closeWaiters.push((info) => {
        cancelTimeout();
        resolve(info);
      });
    });
  }

  /** What the board holds, through the same snapshot the renderer reads. */
  snapshot(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  /**
   * Close without waiting for anything. A participant that hangs up in the middle
   * of a broadcast is a thing the room has to survive, and the room only finds out
   * asynchronously — which is the point of calling this instead of `close`.
   */
  closeNow(): void {
    this.#socket.close();
  }

  /** Close from our side and wait for the room to notice. */
  async close(code?: number, reason?: string): Promise<void> {
    if (this.#closeInfo === null) this.#socket.close(code, reason);
    await this.waitForClose();
  }

  #waitFor<T>(subscribe: (resolve: () => void) => void, timeoutMs: number, what: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const cancelTimeout = later(timeoutMs, () => {
        reject(new Error(`timed out after ${timeoutMs}ms waiting for ${what}`));
      });
      subscribe(() => {
        cancelTimeout();
        resolve(undefined as T);
      });
    });
  }

  async #onFrame(data: unknown): Promise<void> {
    const bytes = await frameBytes(data);
    const decoded = decodeMessage(bytes ?? 'not a frame');
    if (decoded.kind === 'sync') {
      this.received.push({ type: MESSAGE_SYNC, syncType: syncTypeOf(decoded.payload), payload: decoded.payload });
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      // A reply we do not understand is the room's problem, not ours: the tests
      // assert on what the room sent, so swallow it and keep the socket open.
      const type = syncProtocol.readSyncMessage(
        decoding.createDecoder(decoded.payload),
        encoder,
        this.doc,
        this,
        (error: unknown) => {
          this.applyErrors.push(
            `${error instanceof Error ? error.message : String(error)} frame=${Array.from(decoded.payload.slice(0, 12)).join(',')}`
          );
        }
      );
      if (type === syncProtocol.messageYjsSyncStep2) {
        this.#synced = true;
        for (const waiter of this.#syncWaiters.splice(0)) waiter();
      }
      if (encoding.length(encoder) > 1) this.send(encoding.toUint8Array(encoder));
      return;
    }
    if (decoded.kind === 'awareness') {
      this.received.push({ type: MESSAGE_AWARENESS, syncType: -1, payload: decoded.payload });
      this.awarenessFrames.push(decoded.payload);
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoded.payload, this);
      return;
    }
    this.received.push({ type: -1, syncType: -1, payload: new Uint8Array() });
  }
}

/**
 * Join a board: upgrade against the Worker, complete the handshake and return a
 * client that has finished its first sync unless `silent` is set.
 */
export async function join(boardId: string, options: JoinOptions = {}): Promise<TestClient> {
  const response = await SELF.fetch(`https://vidi6.example/api/rooms/${encodeURIComponent(boardId)}`, {
    headers: { Upgrade: 'websocket' }
  });
  if (response.status !== 101 || !response.webSocket) {
    throw new Error(`expected a 101 upgrade for board ${boardId}, got ${response.status}`);
  }
  const socket = response.webSocket;
  socket.accept();
  const doc = options.doc ?? new Y.Doc();
  initDoc(doc);
  const client = TestClient.open(socket, doc);
  if (!options.silent) {
    socket.send(frame(MESSAGE_SYNC, (encoder) => syncProtocol.writeSyncStep1(encoder, doc)));
    socket.send(frame(MESSAGE_QUERY_AWARENESS, () => {}));
    await client.waitForSync();
  }
  return client;
}

/** Join `count` clients to the same board, all synced. */
export async function joinAll(boardId: string, count: number): Promise<TestClient[]> {
  const clients: TestClient[] = [];
  for (let index = 0; index < count; index += 1) clients.push(await join(boardId));
  return clients;
}

/** Close every client, ignoring sockets that are already gone. */
export async function leaveAll(clients: readonly TestClient[]): Promise<void> {
  for (const client of clients) {
    try {
      await client.close();
    } catch {
      // Already closed: exactly what we wanted.
    }
  }
}

/** Wait for every client's snapshot to equal every other one's. */
export function waitForConvergence(clients: readonly TestClient[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
  return TestClient.waitUntil(
    () => {
      const first = JSON.stringify(clients[0]?.snapshot());
      return clients.every((client) => JSON.stringify(client.snapshot()) === first);
    },
    timeoutMs,
    'clients to converge'
  );
}
