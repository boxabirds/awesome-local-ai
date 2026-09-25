/**
 * Test clients for the integration projects (design "Fixtures").
 *
 * A `TestPeer` is a real `Y.Doc` plus a real WebSocket that speaks the same
 * framing the browser provider uses: binary frames, `[type][body]`, sync
 * messages through `y-protocols/sync`. Nothing about the wire is stubbed - if
 * the room's relay is wrong, these clients see it.
 *
 * Sockets come from upgrade responses obtained through `SELF.fetch` (or a
 * Durable Object stub), so the request travels the whole production path:
 * Worker entry, namespace lookup, `BoardRoom.fetch`, `accept()`.
 *
 * Two workerd details are worth knowing before changing this file:
 *
 *  - the socket handed back in an upgrade response is a *server-role* socket,
 *    so it has to be `accept()`ed before it will carry messages;
 *  - messages the room sends before that accept are queued, not dropped, which
 *    is why the room's opening SyncStep1 is still observed.
 */
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { MESSAGE_AWARENESS, MESSAGE_SYNC, SYNC_UPDATE, decodeMessage } from '../../../src/shared/protocol';
import { snapshot } from '../../../src/shared/board-model';
import type { BoardRoom } from '../../../src/worker/board-room';

/** One frame as delivered to the test client, kept for assertions. */
export interface Frame {
  /** `'sync'`, `'awareness'`, `'query-awareness'`, `'invalid'` or `'text'`. */
  kind: string;
  /** Raw bytes of the whole frame. */
  bytes: Uint8Array;
}

/** How long a `settle`/`waitFor` may take before a test gives up. */
const WAIT_TIMEOUT_MS = 8_000;

/** How long traffic has to be silent before a `settle` counts as finished. */
const QUIET_MS = 150;

/** True for a `[0][2][len][bytes]` SyncUpdate frame (a SyncStep2 is not one). */
export function isUpdateFrame(frame: Frame): boolean {
  return frame.kind === 'sync' && frame.bytes[0] === MESSAGE_SYNC && frame.bytes[1] === SYNC_UPDATE;
}

/** The board a document holds, as text, for comparing two replicas. */
export function boardOf(doc: Y.Doc): string {
  return JSON.stringify(snapshot(doc));
}

/** True when every document shows the same board. */
export function boardsAgree(peers: readonly TestPeer[]): boolean {
  if (peers.length < 2) return true;
  const first = boardOf(peers[0]!.doc);
  return peers.every((peer) => boardOf(peer.doc) === first);
}

/** Wait until `check()` holds, or fail with the condition that never held. */
export async function waitFor(
  check: () => boolean,
  description: string,
  timeoutMs = WAIT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Wait for the traffic to stop.
 *
 * A room answers a SyncStep1, relays updates and reacts to closes on the
 * runtime's I/O loop, so one tick is not enough to know a test has seen
 * everything. Silence for {@link QUIET_MS} across every peer is the observable
 * end of a round of traffic, and it is what the frame-count assertions need.
 */
export async function settle(peers: readonly TestPeer[]): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let quietSince = Date.now();
  let seen = peers.map((peer) => peer.frames.length);
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const now = peers.map((peer) => peer.frames.length);
    if (now.some((count, index) => count !== seen[index])) {
      seen = now;
      quietSince = Date.now();
      continue;
    }
    if (Date.now() - quietSince >= QUIET_MS) return;
    if (Date.now() > deadline) throw new Error('traffic did not settle');
  }
}

/**
 * Make a board exist, the way clicking *Create a board* does.
 *
 * From story 5 on, opening a socket at an id is no longer enough to get a
 * board: an unknown id is refused, because a mistyped link must not look like a
 * blank board. These tests are about what happens *inside* a room, so they ask
 * for the board first and then connect, which is the order a real board has in
 * the world.
 */
export async function createTestBoard(boardId: string): Promise<void> {
  const namespace = env.BOARD_ROOM;
  const stub = namespace.get(namespace.idFromName(boardId));
  await (stub as unknown as { initialize(): Promise<string> }).initialize();
}

/** The room's own board, read inside the object (for "unchanged"/"empty"). */
export async function roomBoard(boardId: string): Promise<string> {
  const namespace = env.BOARD_ROOM;
  const stub = namespace.get(namespace.idFromName(boardId));
  return runInDurableObject(stub as never, (room: BoardRoom) => boardOf(room.doc));
}

/** How many sockets the room currently holds. */
export async function roomSocketCount(boardId: string): Promise<number> {
  const namespace = env.BOARD_ROOM;
  const stub = namespace.get(namespace.idFromName(boardId));
  return runInDurableObject(stub as never, (room: BoardRoom) => room.socketCount());
}

/**
 * What each socket the room is holding says about who is here.
 *
 * Presence lives on the sockets rather than in a field on the instance precisely so
 * that it survives the room being torn down, and the only way to test *that* is to
 * read where the answer is kept: `deserializeAttachment` on the sockets the room
 * holds, which is the same call the departure handler makes.
 *
 * Entries come back in the order the sockets were accepted, which is the order the
 * test connected its peers, so a test can name *whose* record it is looking at
 * instead of only that somebody's exists. Attribution matters: a room that charged
 * a socket for presence it had merely carried would remove the wrong people when
 * that socket left.
 */
export async function roomPresence(boardId: string): Promise<Record<string, number>[]> {
  const namespace = env.BOARD_ROOM;
  const stub = namespace.get(namespace.idFromName(boardId));
  return runInDurableObject(stub as never, (room: BoardRoom) => room.presenceSnapshot());
}

/** A test client: one `Y.Doc`, one socket, one log of received frames. */
export class TestPeer {
  /** The document this client holds, editable with the real board-model calls. */
  readonly doc: Y.Doc;
  /**
   * This client's presence, real `Awareness` bound to its own document.
   *
   * The client id it publishes under is the document's, as it is in the browser.
   * Presence is asserted through this object - "A no longer holds B" - rather than
   * by counting frames, because a frame that arrives and is ignored is exactly the
   * bug worth catching.
   */
  readonly awareness: awarenessProtocol.Awareness;
  /** Every frame the room sent, in arrival order. */
  readonly frames: Frame[] = [];
  /**
   * Every presence change this client saw, in order, with the ids that left.
   *
   * `change` fires for additions and updates too, so a test that wants "B went
   * away" looks at `removed` rather than at a count.
   */
  readonly presenceChanges: { added: number[]; updated: number[]; removed: number[] }[] = [];
  /**
   * Awareness frames that arrived and could not be read, with why.
   *
   * Counted rather than thrown, so "the bytes were carried" and "the client choked
   * on the bytes" are two separate facts a test can name.
   */
  readonly undecodable: { bytes: number; reason: string }[] = [];
  /** Close code seen on the socket, once it is closed. */
  closeCode: number | null = null;
  /** True once the socket has been closed from either side. */
  closed = false;

  #socket: WebSocket;
  #name: string;

  private constructor(name: string, socket: WebSocket, doc: Y.Doc) {
    this.#name = name;
    this.#socket = socket;
    this.doc = doc;
    this.awareness = new awarenessProtocol.Awareness(doc);
    this.awareness.on('change', (event: { added: number[]; updated: number[]; removed: number[] }) => {
      this.presenceChanges.push({
        added: [...event.added],
        updated: [...event.updated],
        removed: [...event.removed],
      });
    });
    // Whatever changes this document - typed here or sent by the room - is
    // forwarded, which is what the browser provider does. Updates whose origin
    // is this peer are its own work, so they are not sent back out.
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      this.sendUpdate(update);
    });
  }

  /** This client's name, for readable failures. */
  get name(): string {
    return this.#name;
  }

  /** The socket this peer talks through, for low-level assertions. */
  get socket(): WebSocket {
    return this.#socket;
  }

  /** Frames received so far that carry a document update. */
  updateCount(): number {
    return this.frames.filter(isUpdateFrame).length;
  }

  /** Whether this client still holds `clientId` as somebody who is here. */
  holdsPresence(clientId: number): boolean {
    return this.awareness.states.has(clientId);
  }

  /**
   * Open a client against a board through the real Worker entry.
   *
   * `doc` lets a test replay a board it built beforehand (the restart test);
   * by default the client starts empty, like a fresh tab.
   */
  static async connect(
    boardId: string,
    options: { name?: string; doc?: Y.Doc; path?: string } = {},
  ): Promise<TestPeer> {
    const path = options.path ?? `/api/rooms/${boardId}`;
    // A client never meets a board that does not exist, so neither do these
    // tests: ask for the board, then connect to it.
    await createTestBoard(boardId);
    return TestPeer.#open(options.name ?? 'peer', `https://board.example${path}`, (request) =>
      SELF.fetch(request),
      options.doc,
    );
  }

  /**
   * Open a client against a specific Durable Object instance, bypassing the
   * Worker. Used to talk to a *fresh* instance, which is how the restart
   * scenario is produced without waiting for a real eviction.
   */
  static async connectToInstance(
    instanceId: string,
    options: { name?: string; doc?: Y.Doc } = {},
  ): Promise<TestPeer> {
    const namespace = env.BOARD_ROOM;
    const stub = namespace.get(namespace.idFromString(instanceId));
    // Same rule one level down: a fresh instance has never been asked for its
    // board, so the board is asked for here before the socket is.
    await (stub as unknown as { initialize(): Promise<string> }).initialize();
    return TestPeer.#open(
      options.name ?? 'peer',
      'https://board.example/api/rooms/restart',
      (request) => stub.fetch(request),
      options.doc,
    );
  }

  static async #open(
    name: string,
    url: string,
    fetcher: (request: Request) => Promise<Response>,
    doc?: Y.Doc,
  ): Promise<TestPeer> {
    const request = new Request(url, {
      headers: {
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dE4q5P8zRb0oZ0uS0m0T0g==',
      },
    });
    const response = await fetcher(request);
    if (response.status !== 101) {
      throw new Error(`upgrade for ${url} answered ${response.status}`);
    }
    const socket = (response as Response & { webSocket?: WebSocket }).webSocket;
    if (socket === undefined) throw new Error(`upgrade for ${url} carried no websocket`);
    const peer = new TestPeer(name, socket, doc ?? new Y.Doc());
    await peer.#start();
    return peer;
  }

  /** Wire up the socket and perform the client side of the handshake. */
  async #start(): Promise<void> {
    const socket = this.#socket;
    try {
      socket.binaryType = 'arraybuffer';
    } catch {
      // Some socket roles fix the binary type; the message handler copes.
    }
    socket.addEventListener('message', (event: MessageEvent) => {
      this.#onFrame(event.data);
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      this.closed = true;
      this.closeCode = typeof event.code === 'number' ? event.code : null;
    });
    // Both halves of a `WebSocketPair` are server-role sockets in workerd: a
    // message is only delivered once the receiving half is accepted.
    const accept = (socket as WebSocket & { accept?: () => void }).accept;
    if (typeof accept === 'function') accept.call(socket);
    await this.#waitForOpen(socket);
    // The client asks for the board first, exactly like `WebsocketProvider`.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.send(encoding.toUint8Array(encoder));
  }

  /** Wait for the socket to leave CONNECTING, without a fake event loop. */
  #waitForOpen(socket: WebSocket): Promise<void> {
    if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => {
        reject(new Error(`${this.#name}: websocket error`));
      });
    });
  }

  /** Classify and handle one incoming frame. */
  #onFrame(data: ArrayBuffer | ArrayBufferView | string): void {
    const decoded = decodeMessage(data);
    this.frames.push({
      kind: typeof data === 'string' ? 'text' : decoded.kind,
      bytes: typeof data === 'string' ? new Uint8Array(0) : bytesOf(data),
    });
    if (typeof data === 'string') return;

    if (decoded.kind === 'awareness') {
      // Presence is *read* here, the way the browser provider reads it, into a real
      // `Awareness`. A relay that reached the socket and was dropped is the failure
      // a frame log cannot see.
      try {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoded.payload, this.#name);
      } catch (error) {
        // The room relays presence bytes it cannot read, so they arrive here, and
        // `applyAwarenessUpdate` throws on them. A real `WebsocketProvider` does not
        // guard that call, so the harness guards it: an exception thrown out of this
        // listener tears the test socket down, and the thing under test is what the
        // *room* did, not whether lib0 likes the bytes. The failure is still
        // recorded, so a test can insist that a frame was ignored rather than
        // applied.
        this.undecodable.push({
          bytes: bytesOf(data).byteLength,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (decoded.kind === 'query-awareness') {
      // The provider's answer to "who is here?": every state this client holds,
      // including its own, which is what `getStates()` returns and what the
      // provider sends. Nothing is sent when the client holds nobody, as in the
      // provider, whose handler only emits a reply with something in it.
      const clients = [...this.awareness.getStates().keys()];
      if (clients.length === 0) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients),
      );
      this.send(encoding.toUint8Array(encoder));
      return;
    }

    if (decoded.kind !== 'sync') return;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    const decoder = decoding.createDecoder(decoded.payload);
    try {
      syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
    } catch (error) {
      throw new Error(`${this.#name}: cannot read sync message: ${String(error)}`);
    }
    if (encoding.length(encoder) > 1) this.send(encoding.toUint8Array(encoder));
  }

  /** Send one document update as a SyncUpdate frame. */
  sendUpdate(update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  }

  /** Send raw awareness bytes, framed the way y-websocket frames them. */
  sendAwareness(bytes: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, bytes);
    this.send(encoding.toUint8Array(encoder));
  }

  /**
   * Announce this client's own presence, as a publishing client does: one state,
   * one entry, sent as its own frame. `null` is the farewell a client sends when
   * it decides it is gone.
   */
  publishPresence(state: Record<string, unknown> | null): void {
    this.awareness.setLocalState(state);
    this.sendAwareness(
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]),
    );
  }

  /**
   * Send every state this client holds, as it does when answering a query.
   *
   * Two shapes matter and this can produce only one of them, so the other is built
   * by hand where it is needed: an answer about a *person* carries whoever that
   * client has seen, and a room that files it as the forwarder's own presence will
   * remove those people when the forwarder leaves.
   */
  relayPresence(): void {
    const clients = [...this.awareness.getStates().keys()];
    if (clients.length === 0) return;
    this.sendAwareness(awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients));
  }

  /** Send bytes straight to the room, bypassing every client behaviour. */
  send(bytes: Uint8Array): void {
    if (this.#socket.readyState !== WebSocket.OPEN) return;
    this.#socket.send(bytes);
  }

  /** Send a text frame, which this protocol does not have. */
  sendText(text: string): void {
    if (this.#socket.readyState !== WebSocket.OPEN) return;
    this.#socket.send(text);
  }

  /** Close the client side of the connection. */
  close(code?: number, reason?: string): void {
    try {
      if (code === undefined) this.#socket.close();
      else this.#socket.close(code, reason);
    } catch {
      // Already gone, which is the outcome the caller wanted.
    }
  }
}

/** Copy a frame's bytes out, so a later buffer reuse cannot change them. */
function bytesOf(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  }
  return new Uint8Array(new Uint8Array(data));
}
