/**
 * A test client for one board: a real `Y.Doc` speaking the real `y-protocols`
 * framing over a real WebSocket that came out of a `SELF.fetch` upgrade response.
 *
 * The framing is the same one the browser's `WebsocketProvider` uses — the same
 * lib0 encoders, the same message types, the same opening move on connect — so a
 * test that passes here is the room behaving the way a browser will experience it.
 * Nothing is mocked: the only difference from the browser is that the socket comes
 * from the runtime instead of from `new WebSocket()`, and that this client does not
 * push its own presence at the board (tests say so explicitly when they want it).
 */
import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { SELF } from 'cloudflare:test';
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';

import { newBoardId } from '../../src/shared/board-id';
import { LOCAL_ORIGIN, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import {
  decodeMessage,
  encodeAwarenessMessage,
  encodeQueryAwarenessMessage,
  MESSAGE_SYNC,
  type Decoded,
} from '../../src/shared/protocol';

/** How long any wait for the board may take before the test gives up. */
const WAIT_TIMEOUT_MS = 5_000;

/** How long the board must have been silent for a sync to count as finished. */
const QUIET_MS = 50;

/** Poll interval while waiting. */
const POLL_MS = 5;

/** The sync step that asks a client what it has, read off a payload's front. */
const SYNC_STEP_1 = 0;

/** One frame as the client saw it, with the framing already read off. */
export interface Received {
  /** What arrived: a document frame, presence, a close, or junk. */
  readonly kind: 'sync' | 'awareness' | 'query-awareness' | 'close' | 'invalid';
  /** For a document frame: 0 = the board asks what we have, 1 = a document update. */
  readonly syncType?: number;
  /** The frame body, without its type byte. */
  readonly payload?: Uint8Array;
  /** For a close: the code and the reason the board gave. */
  readonly code?: number;
  readonly reason?: string;
}

function upgradeHeaders(): Record<string, string> {
  return {
    Upgrade: 'websocket',
    Connection: 'Upgrade',
    'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
    'Sec-WebSocket-Version': '13',
  };
}

export class TestClient {
  /** This person's document: what their screen would be drawn from. */
  readonly doc: Y.Doc;
  /** The presence of everybody on the board, as this client was told it. */
  readonly awareness: Awareness;
  readonly socket: WebSocket;
  /** Every frame seen, in order, since connecting or the last `clearLog`. */
  readonly received: Received[] = [];
  /** The close code this client saw, or undefined while it is still connected. */
  closeCode: number | undefined;
  closeReason: string | undefined;
  /** When the last frame arrived, for the quiet-period check that ends a sync. */
  #lastFrameAt = 0;
  /** Whether the board has asked for this client's state at least once. */
  #greeted = false;
  /** The board this client is on, so it can come back to it. */
  readonly boardId: string;
  /** The listener this client keeps on the document, so it can be removed. */
  private readonly onLocalUpdate: (update: Uint8Array, origin: unknown) => void;

  private constructor(socket: WebSocket, doc: Y.Doc, boardId: string) {
    this.socket = socket;
    this.doc = doc;
    this.boardId = boardId;
    this.awareness = new Awareness(doc);
    socket.binaryType = 'arraybuffer';
    // A socket handed back by the runtime arrives not yet accepted; sending on it
    // before this throws. Browsers do not have the step, their socket is accepted
    // by the page.
    (socket as unknown as { accept?: () => void }).accept?.();

    // A local change goes out as one sync/update frame, exactly as the browser
    // provider does it: `origin === this` marks a change the board gave us, and
    // that is never sent back.
    this.onLocalUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      socket.send(encoding.toUint8Array(encoder));
    };
    doc.on('update', this.onLocalUpdate);

    socket.addEventListener('message', (event: MessageEvent) => {
      this.#onFrame(event.data as ArrayBuffer | string);
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      this.closeCode = event.code;
      this.closeReason = event.reason;
      this.received.push({ kind: 'close', code: event.code, reason: event.reason });
    });

    // The same opening move as the browser provider: ask the board for its state.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    socket.send(encoding.toUint8Array(encoder));
  }

  /**
   * Opens a connection to `/api/rooms/<boardId>` through the real Worker and
   * returns the client with the upgrade response, so a test can assert on both.
   */
  static async connect(
    boardId: string,
    doc = new Y.Doc(),
  ): Promise<{ client: TestClient; response: Response }> {
    const response = await SELF.fetch(`https://example.com/api/rooms/${boardId}`, {
      headers: upgradeHeaders(),
    });
    const socket = response.webSocket;
    if (!socket) throw new Error(`the board sent no websocket (status ${response.status})`);
    const client = new TestClient(socket, doc, boardId);
    return { client, response };
  }

  /** A client on a board of its own, already past the initial sync. */
  static async onNewBoard(): Promise<TestClient> {
    const { client } = await TestClient.connect(newBoardId());
    await client.waitForSync();
    return client;
  }

  /**
   * Drops this connection and opens a new one to the same board with the same
   * document, which is what a page does when its connection comes back: the
   * document is still there, the socket is new, and the sync starts again.
   */
  async reconnect(): Promise<TestClient> {
    this.close();
    const { client } = await TestClient.connect(this.boardId, this.doc);
    return client;
  }

  /**
   * Waits for the initial exchange to finish. The board greets a new connection
   * by asking what it has, and this client answers; the sync is over once both
   * have spoken and the board has sent nothing more for QUIET_MS, which is how a
   * client with no reply outstanding can tell it is up to date.
   */
  async waitForSync(): Promise<void> {
    await this.waitUntil(
      () => this.#greeted && Date.now() - this.#lastFrameAt >= QUIET_MS,
      'the initial sync',
    );
  }

  /** Waits until the board has sent at least `count` frames to this client. */
  async waitForMessages(count: number): Promise<void> {
    await this.waitUntil(() => this.received.length >= count, `${count} frames from the board`);
  }

  /**
   * Waits until the board has sent this client nothing for `ms`. This is how a
   * test says "and nothing else came": a client with no reply outstanding can
   * only tell that the board is quiet, which is the same way a browser knows.
   */
  async quiet(ms = QUIET_MS): Promise<void> {
    await this.waitUntil(() => Date.now() - this.#lastFrameAt >= ms, 'the board to go quiet');
  }

  /** Asks the board for its state again, as a client does when it reconnects. */
  resync(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.socket.send(encoding.toUint8Array(encoder));
  }

  /**
   * Puts a presence field on this client and sends it once, the way a client with
   * a cursor does. Returns the update bytes that went on the wire, so a test can
   * compare what the board relayed with what was sent.
   */
  sendPresence(fields: Record<string, unknown>): Uint8Array {
    this.awareness.setLocalState({ ...this.awareness.getLocalState(), ...fields });
    const update = encodeAwarenessUpdate(this.awareness, [this.doc.clientID]);
    this.sendAwareness(update);
    return update;
  }

  /** Waits until the client's own document looks like that. */
  async waitForDoc(check: (doc: Y.Doc) => boolean): Promise<void> {
    await this.waitUntil(() => check(this.doc), 'the document to change');
  }

  /** Resolves with the close code once the board has closed this connection. */
  async waitForClose(): Promise<number> {
    await this.waitUntil(() => this.closeCode !== undefined, 'the connection to close');
    return this.closeCode as number;
  }

  /**
   * How long until `check` is true of this client's document, in milliseconds —
   * the time a change on the board took to reach this screen.
   */
  async timeUntil(check: (doc: Y.Doc) => boolean): Promise<number> {
    const started = performance.now();
    await this.waitUntil(() => check(this.doc), 'the change to arrive');
    return performance.now() - started;
  }

  /** Forgets the frames seen so far and returns them. */
  clearLog(): Received[] {
    const seen = this.received.splice(0, this.received.length);
    this.#greeted = false;
    return seen;
  }

  /** This client's board, as its screen would show it. */
  snapshot(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  /** Frames of the given kind received so far. */
  kinds(): string[] {
    return this.received.filter((entry) => entry.kind !== 'close').map((entry) => entry.kind);
  }

  /** Sends bytes exactly as given, for the malformed-traffic cases. */
  sendRaw(data: ArrayBuffer | Uint8Array | string): void {
    this.socket.send(data as ArrayBuffer | Uint8Array);
  }

  /** Sends a presence update, as a client with a cursor would. */
  sendAwareness(payload: Uint8Array): void {
    this.sendRaw(encodeAwarenessMessage(payload).buffer as ArrayBuffer);
  }

  /** Asks the board who else is here; the board ignores this in story 3. */
  sendQueryAwareness(): void {
    this.sendRaw(encodeQueryAwarenessMessage().buffer as ArrayBuffer);
  }

  /** A local change: something this person did, which then goes to the board. */
  local(change: (doc: Y.Doc) => void): void {
    this.doc.transact(() => change(this.doc), LOCAL_ORIGIN);
  }

  close(code = 1000, reason = 'bye'): void {
    this.doc.off('update', this.onLocalUpdate);
    this.socket.close(code, reason);
  }

  /** Detaches this client from the board and forgets its document. */
  async dispose(): Promise<void> {
    this.close();
    this.awareness.destroy();
    this.doc.destroy();
  }

  private async waitUntil(check: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    for (;;) {
      if (check()) return;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  /** Reads one frame, and answers sync frames the way the client protocol does. */
  #onFrame(data: ArrayBuffer | string): void {
    this.#lastFrameAt = Date.now();
    const message: Decoded = decodeMessage(data);

    if (message.kind === 'invalid') {
      this.received.push({ kind: 'invalid' });
      return;
    }
    if (message.kind === 'query-awareness') {
      this.received.push({ kind: 'query-awareness' });
      return;
    }
    if (message.kind === 'awareness') {
      this.received.push({ kind: 'awareness', payload: message.payload });
      try {
        applyAwarenessUpdate(this.awareness, message.payload, this);
      } catch {
        // Presence that cannot be read is not this client's problem; the room's
        // own tests are about what arrived.
      }
      return;
    }

    const syncType = peekSyncType(message.payload);
    this.received.push({ kind: 'sync', syncType, payload: message.payload });
    if (syncType === SYNC_STEP_1) this.#greeted = true;

    const decoder = decoding.createDecoder(message.payload);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    try {
      syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
    } catch {
      return;
    }
    if (encoding.length(encoder) > 1) {
      this.socket.send(encoding.toUint8Array(encoder));
    }
  }
}

/** The message type of a sync payload, without consuming it. */
function peekSyncType(payload: Uint8Array): number | undefined {
  try {
    return decoding.readVarUint(decoding.createDecoder(payload));
  } catch {
    return undefined;
  }
}
