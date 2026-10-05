/**
 * Integration test client for the room protocol (task 5 / 6).
 *
 * A `RoomClient` is a real `Y.Doc` speaking `y-protocols` over the `WebSocket`
 * handed back by a `SELF.fetch` upgrade response — the same framing the browser
 * provider uses, so the server is tested against a faithful peer rather than a
 * hand-rolled one.
 */
import { env, SELF } from 'cloudflare:test';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';

import { stickies, type StickySnapshot } from '../../src/shared/board-model';
import { isValidBoardId } from '../../src/shared/board-id';
import {
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  type Decoded,
} from '../../src/shared/protocol';

/** A frame the room sent us, classified by its outer type (and inner sync rank). */
export interface ReceivedFrame {
  /** `MESSAGE_SYNC` / `MESSAGE_AWARENESS`, or `null` for a frame we could not decode. */
  readonly type: number | null;
  /** For sync frames: the `y-protocols` rank (step1 / step2 / update). */
  readonly syncRank: number | null;
  readonly bytes: Uint8Array;
}

export interface RoomClientOptions {
  /** Do not send anything on open and do not react to messages (a rude client). */
  readonly silent?: boolean;
  /** Apply this Yjs update to the local doc before connecting (a returning editor). */
  readonly seed?: Uint8Array;
  /** Awareness state announced on open. */
  readonly awarenessState?: Record<string, unknown>;
}

export class RoomClient {
  readonly doc = new Y.Doc();
  readonly boardId: string;
  readonly awareness: awarenessProtocol.Awareness;
  readonly frames: ReceivedFrame[] = [];
  ws: WebSocket | null = null;
  synced = false;
  closeCode: number | null = null;
  closeReason = '';
  /** Set when the socket reports an error; used to fail waiting helpers loudly. */
  socketFailed = false;
  private destroyed = false;

  private readonly options: RoomClientOptions;
  private closeWaiters: (() => void)[] = [];

  private constructor(boardId: string, options: RoomClientOptions) {
    this.boardId = boardId;
    this.options = options;
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalStateField('user', { name: 'tester' });
  }

  /** Open the socket, then behave like the browser provider unless told not to. */
  static async connect(boardId: string, options: RoomClientOptions = {}): Promise<RoomClient> {
    const client = new RoomClient(boardId, options);
    if (options.seed) Y.applyUpdate(client.doc, options.seed);
    // A board must exist before it can be joined (story 5): connecting no longer
    // creates one implicitly (share.not_found). These tests open boards by id, so
    // ensure it exists first — the same thing a browser does opening a link a POST
    // created. Memoised so repeated joins (and the routing tests that count
    // `idFromName`) see the one lookup the socket itself performs.
    await ensureBoard(boardId);
    const response = await SELF.fetch(`http://whiteboard.local/api/rooms/${boardId}`, {
      headers: { upgrade: 'websocket' },
    });
    if (response.status !== 101 || !response.webSocket) {
      throw new Error(`expected a protocol switch, got HTTP ${response.status}`);
    }
    const ws = response.webSocket;
    client.ws = ws;
    ws.binaryType = 'arraybuffer';
    // We are the *client* of this socket, so it has to be accepted before it
    // starts moving bytes (events can only fire after the current task).
    ws.accept();
    ws.addEventListener('message', (event) => {
      const data = event.data;
      client.frames.push(classify(typeof data === 'string' ? encodeText(data) : new Uint8Array(data as ArrayBuffer)));
      if (client.options.silent) return;
      const handled = client.handle(typeof data === 'string' ? encodeText(data) : new Uint8Array(data as ArrayBuffer));
      if (handled) {
        const reply = encoding.toUint8Array(handled);
        client.sendBytes(reply);
      }
    });
    ws.addEventListener('close', (event) => {
      client.closeCode = (event as CloseEvent).code;
      client.closeReason = (event as CloseEvent).reason ?? '';
      for (const waiter of client.closeWaiters.splice(0)) waiter();
    });
    ws.addEventListener('error', () => {
      client.socketFailed = true;
    });

    if (options.silent) return client;

    if (options.awarenessState) {
      for (const [key, value] of Object.entries(options.awarenessState)) {
        client.awareness.setLocalStateField(key, value);
      }
    }
    client.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === client) return;
      client.sendUpdate(update);
    });
    client.awareness.on(
      'update',
      (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        if (origin === client) return;
        client.sendAwareness(changes.added.concat(changes.updated, changes.removed));
      },
    );

    client.sendSyncStep1();
    client.sendAwareness([client.doc.clientID]);
    await client.waitFor(() => client.synced, 'initial sync');
    return client;
  }

  /** The board state this client currently holds. */
  get notes(): readonly StickySnapshot[] {
    return stickies(this.doc);
  }

  sendSyncStep1(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.sendBytes(encoding.toUint8Array(encoder));
  }

  sendUpdate(update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.sendBytes(encoding.toUint8Array(encoder));
  }

  sendAwareness(clientIds: number[]): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, clientIds),
    );
    this.sendBytes(encoding.toUint8Array(encoder));
  }

  sendBytes(bytes: Uint8Array): void {
    if (this.destroyed) return;
    if (!this.ws) throw new Error('client is not connected');
    this.sent.push(bytes);
    this.ws.send(bytes);
  }

  /** A non-binary frame: the protocol never produces one (TC-15). */
  sendText(text: string): void {
    if (this.destroyed) return;
    if (!this.ws) throw new Error('client is not connected');
    this.ws.send(text);
  }

  /** Frames we sent, for assertions like "relayed verbatim" (TC-16). */
  readonly sent: Uint8Array[] = [];

  /** All sync frames with the given `y-protocols` rank that the room sent us. */
  syncFramesWithRank(rank: number): ReceivedFrame[] {
    return this.frames.filter((f) => f.type === MESSAGE_SYNC && f.syncRank === rank);
  }

  awarenessFrames(): ReceivedFrame[] {
    return this.frames.filter((f) => f.type === MESSAGE_AWARENESS);
  }

  /** Wait for the room to close our connection (TC-14 to TC-17). */
  async waitForClose(timeoutMs = 3000): Promise<{ code: number | null; reason: string }> {
    if (this.closeCode === null) {
      if (this.socketFailed) throw new Error('socket errored before closing');
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for close')), timeoutMs);
        this.closeWaiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return { code: this.closeCode, reason: this.closeReason };
  }

  close(): void {
    this.ws?.close();
  }

  /** Go offline like the provider does: announce the removal, then hang up. */
  async destroy(): Promise<void> {
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'offline');
    this.destroyed = true;
    this.ws?.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    this.doc.destroy();
  }

  /** Poll `condition` until it holds, or fail with `what` after `timeoutMs`. */
  async waitFor(condition: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (condition()) return;
      if (this.socketFailed) throw new Error(`socket errored while waiting for ${what}`);
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  /** Wait until `other`'s writes are visible here. */
  async seesNoteCount(count: number, timeoutMs = 3000): Promise<void> {
    await this.waitFor(() => this.notes.length === count, `${count} notes`, timeoutMs);
  }

  /** True when a frame identical to `bytes` was received. */
  receivedExactly(bytes: Uint8Array): boolean {
    return this.frames.some((f) => sameBytes(f.bytes, bytes));
  }

  private handle(frame: Uint8Array): encoding.Encoder | null {
    const decoder = decoding.createDecoder(frame);
    const type = decoding.readVarUint(decoder);
    if (type !== MESSAGE_SYNC) return null;
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    const rank = syncProtocol.readSyncMessage(decoder, reply, this.doc, this);
    if (rank === syncProtocol.messageYjsSyncStep2 && !this.synced) this.synced = true;
    return encoding.length(reply) > 1 ? reply : null;
  }
}

export function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A frame the protocol cannot decode but that is structurally well formed. */
export function corruptUpdateFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

/** Board state in a form that is safe to compare between docs. */
export function boardState(client: RoomClient): string {
  return JSON.stringify(
    [...client.notes]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((n) => [n.id, n.x, n.y, n.z, n.color, n.text]),
  );
}

/** Wait until every client reports the same board state. */
export async function converge(clients: RoomClient[], timeoutMs = 15000): Promise<void> {
  const [first, ...rest] = clients;
  await first.waitFor(
    () => rest.every((c) => boardState(c) === boardState(first)),
    'clients to converge',
    timeoutMs,
  );
}

function classify(frame: Uint8Array): ReceivedFrame {
  try {
    const decoder = decoding.createDecoder(frame);
    const type = decoding.readVarUint(decoder);
    const syncRank =
      type === MESSAGE_SYNC ? decoding.readVarUint(decoder) : null;
    return { type, syncRank, bytes: frame };
  } catch {
    return { type: null, syncRank: null, bytes: frame };
  }
}

/** A board id that has never been seen before (boards are per-test isolated). */
/**
 * Make a board exist before a test joins it (story 5 removed implicit creation).
 * Memoised per id, so a test that opens a board many times triggers exactly one
 * `idFromName` for creation — and can measure the socket's own lookup separately.
 */
const ensuredBoards = new Set<string>();
export async function ensureBoard(boardId: string): Promise<void> {
  if (!isValidBoardId(boardId) || ensuredBoards.has(boardId)) return;
  await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).initialize();
  ensuredBoards.add(boardId);
}

export function freshBoardId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let id = '';
  for (let i = 0; i < 22; i++) id += alphabet[Math.floor(Math.random() * 64)];
  return id;
}

/** Connect `count` clients to the same room, all fully synced. */
export async function connectAll(boardId: string, count: number): Promise<RoomClient[]> {
  const clients: RoomClient[] = [];
  for (let i = 0; i < count; i++) clients.push(await RoomClient.connect(boardId));
  return clients;
}

export { MESSAGE_AWARENESS, MESSAGE_SYNC };
export type { Decoded };
