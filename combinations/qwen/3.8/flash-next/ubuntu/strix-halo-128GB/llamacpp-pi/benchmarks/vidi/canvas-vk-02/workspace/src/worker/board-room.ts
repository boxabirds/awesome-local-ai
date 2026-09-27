/**
 * BoardRoom: one Durable Object per board, persisted (design "persist.room").
 *
 * The object holds the board's `Y.Doc` in memory, and every change it accepts is
 * written to its own SQLite-backed storage *before* anybody else is told about
 * it:
 *
 * - an update that cannot be stored is not broadcast, and the room stops being
 *   usable: every socket is closed with 1011 and the document is discarded, so
 *   nobody is left looking at a board that was never saved;
 * - a change that cannot be read closes only the socket that sent it (1003), and
 *   reaches neither storage nor the other people;
 * - the first contact after the object was created or evicted reads the board
 *   back — one snapshot plus the rows above it — before the socket is answered,
 *   and a board whose bytes cannot be made into a document is refused with
 *   `CLOSE_BOARD_LOAD_FAILED` rather than served empty.
 *
 * Merging is Yjs CRDT semantics: concurrent text inserts are all kept, concurrent
 * writes to `x`/`y`/`color` converge to one deterministic winner, and a deleted
 * note cannot be resurrected by concurrent edits inside it.
 *
 * Sockets are accepted with `ctx.acceptWebSocket`, the hibernation API: the room
 * is not kept in memory by a connection, `ctx.getWebSockets()` is the source of
 * truth for who is here, and what the room needs to know about a socket — its
 * last awareness update and when the room last wrote to it — travels with the
 * socket as an attachment rather than living in a `Map` that eviction would
 * take. Per-socket state is therefore read with `attachmentOf` and written with
 * `remember`; both are total, because a socket woken from hibernation may be
 * seen for the first time with no attachment at all.
 */

import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { modifyAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';

import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  awarenessMessage,
  awarenessUpdateOf,
  decodeMessage,
  frameMessage,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN, type LoadResult } from './board-store';
import type { Env } from './index';
import {
  nextRoomState,
  observableState,
  type RoomEvent,
  type RoomLifecycle,
  type RoomState,
} from './room-state';

/**
 * A y-websocket client gives up on a connection it has heard nothing about for
 * 30 seconds, so a room whose people are idle has to say something. The node
 * y-websocket server does the same thing with a timer of its own: send an empty
 * awareness update to any socket that has not been written to recently. It is a
 * no-op to apply and keeps a healthy tab from being mistaken for a dead one.
 *
 * The timer runs only while somebody is connected: an empty board is what has to
 * cost no compute, and a board with people in it is already awake.
 */
const KEEP_ALIVE_CHECK_MS = 5_000;
const KEEP_ALIVE_AFTER_MS = 12_500;

/**
 * What travels with a socket. Awareness is held as base64 because an attachment
 * has to survive the runtime writing it down, and presence updates are small
 * enough that the encoding is not worth worrying about.
 */
interface SocketAttachment {
  awareness: string | null;
  lastWriteAt: number;
}

export class BoardRoom extends DurableObject<Env> {
  /** Where this room is in its lifecycle; see `room-state.ts`. */
  private lifecycle: RoomLifecycle = 'loading';

  /** When the last load attempt failed, for the retry interval. */
  private loadFailedAt = 0;

  /** The board in memory, or `null` when this room holds nothing. */
  private document: Y.Doc | null = null;

  /** Storage for this board's document, bound to the board id this object owns. */
  private readonly board: BoardStore;

  /** The idle-socket timer; running only while somebody is connected. */
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    // `state.storage` rather than `this.storage`: in this runtime the instance
    // property is not filled in until the constructor has returned, and the read
    // below happens inside it.
    this.board = new BoardStore(state.storage);
    // Nothing is served before the board has been read, and nothing can slip in
    // alongside the read: `blockConcurrencyWhile` holds the object until the
    // first `fetch`/message is handled, which is also what makes `document` a
    // fact rather than a promise everywhere below.
    //
    // The read itself is synchronous — Durable Object SQL is — so this is about
    // the guarantee the runtime makes to us, not about waiting.
    this.ctx.blockConcurrencyWhile(() => {
      this.#loadBoard();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const state = this.#stateForConnection();
    if (state === 'load-failed') {
      // Accepted and closed with a code of its own, so the browser can tell
      // "this board cannot be opened" from "the network is bad".
      this.ctx.acceptWebSocket(server);
      server.close(CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
      return new Response(null, { status: 101, webSocket: client });
    }
    if (state === 'storage-failed') {
      this.ctx.acceptWebSocket(server);
      server.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      return new Response(null, { status: 101, webSocket: client });
    }

    remember(server, { awareness: null, lastWriteAt: Date.now() });
    this.ctx.acceptWebSocket(server);

    // Ask the newcomer for its state: it answers with a SyncStep2 carrying
    // everything this room does not have, which is how a board that was edited
    // while its room was failing to store is completed rather than lost.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc());
    this.write(server, encoding.toUint8Array(encoder));
    this.startKeepAlive();

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(webSocket: WebSocket, message: string | ArrayBuffer): void {
    const state = this.#stateForConnection();
    if (state === 'load-failed') {
      webSocket.close(CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
      return;
    }
    if (state === 'storage-failed') {
      webSocket.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      return;
    }

    const decoded = decodeMessage(message);
    switch (decoded.kind) {
      case 'sync':
        this.applySync(webSocket, decoded.payload);
        return;
      case 'awareness':
        this.relayAwareness(webSocket, decoded.payload);
        return;
      case 'query-awareness':
        this.answerAwarenessQuery(webSocket);
        return;
      case 'invalid':
        this.closeUnsupported(webSocket);
        return;
    }
  }

  webSocketClose(webSocket: WebSocket): void {
    this.forgetResource(webSocket);
  }

  webSocketError(webSocket: WebSocket): void {
    this.forgetResource(webSocket);
  }

  /**
   * The lifecycle state a connection is answered with, having done whatever
   * waking up requires: read the board if this room is holding nothing, and
   * retry a board that failed to load only once `LOAD_RETRY_MIN_INTERVAL_MS`
   * have passed.
   *
   * A room that failed on *storage* rather than on its bytes is reset the same
   * way — its document is already gone — because the point of closing everybody
   * with 1011 is that a reconnecting client can put the board back. Its
   * backoff is what keeps that from being a loop.
   */
  #stateForConnection(): RoomState {
    if (this.document !== null) return observableState(this.lifecycle);
    if (this.lifecycle === 'load-failed') {
      this.#move({ type: 'retry-load', elapsedMs: Date.now() - this.loadFailedAt });
      if (this.lifecycle === 'load-failed') return 'load-failed';
    }
    if (this.lifecycle === 'storage-failed') this.#move({ type: 'reload' });
    if (this.lifecycle === 'ready') {
      // A room that says it is serving while holding no document: nothing in
      // this class does that, and answering `ready` from an empty room would
      // hand out a board nobody had read. Go round by hibernation, which is the
      // legal way back to `loading`.
      this.#move({ type: 'idle' });
    }
    if (this.lifecycle === 'hibernated') this.#move({ type: 'wake' });
    if (this.lifecycle === 'loading') this.#loadBoard();
    return observableState(this.lifecycle);
  }

  /**
   * Read the board from storage into a document, and record what happened.
   * Called with the lifecycle already in `loading`: the constructor for the
   * first read of an instance, `#stateForConnection` for every read after one
   * that left the room holding nothing.
   */
  #loadBoard(): void {
    const doc = new Y.Doc();
    // The sending socket is the transaction origin, which is how a broadcast
    // knows whom to leave out: nobody sees their own edit come back.
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.onUpdate(update, origin);
    });

    let result: LoadResult;
    try {
      result = this.board.load(doc);
    } catch (error) {
      // `BoardStore.load` reports its own failures; getting here means the
      // storage layer itself is the problem, which is a storage failure.
      this.document = null;
      this.#move({ type: 'load-failed' });
      this.loadFailedAt = Date.now();
      this.#log('load-threw', { error: describeError(error) });
      return;
    }

    if (!result.ok) {
      // Refuse to serve an empty board: the people on it would watch their work
      // disappear and call it the app's fault.
      this.document = null;
      this.#move({ type: 'load-failed' });
      this.loadFailedAt = Date.now();
      this.#log('load-failed', { reason: result.reason, error: result.error ?? '' });
      return;
    }

    this.document = doc;
    this.#move({ type: result.quarantined > 0 ? 'load-quarantined' : 'load-ok' });
  }

  /** The board's document, which exists whenever the room is serving. */
  private doc(): Y.Doc {
    if (this.document === null) {
      // Unreachable: every entry point loads first. Throwing here would be a
      // bug in the lifecycle, and a bug that cannot store anything is better
      // announced than silently written to a document nobody will keep.
      throw new Error('board room served without a document');
    }
    return this.document;
  }

  /**
   * One change was applied to the document: store it, then tell everybody else.
   *
   * The order is the whole design — a socket never sees a change that is not in
   * storage yet, so a board that looked like somebody's edit and then vanished
   * cannot happen. A write that throws discards the document and closes the
   * room, because the alternative is a room that keeps serving changes it has
   * quietly dropped.
   */
  private onUpdate(update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN) return;
    if (this.document === null) return;

    try {
      this.board.append(update);
    } catch (error) {
      this.#storageFailed(error);
      return;
    }
    this.broadcastUpdate(update, origin);

    try {
      this.#move({ type: 'compact-start' });
      if (this.board.compactIfNeeded(this.document)) {
        this.#log('compacted', {});
      }
      this.#move({ type: 'compact-done' });
    } catch (error) {
      // `compactIfNeeded` does not throw on a storage error it can roll back;
      // anything reaching here is a storage failure like any other.
      this.#move({ type: 'compact-failed' });
      this.#storageFailed(error);
    }
  }

  /**
   * Storage refused to answer. Everybody is closed with 1011 — the code a
   * browser reconnects on — and the document goes with them: the next
   * connection reads the board back from storage, and a client that was
   * holding a change the room refused to store sends it again on reconnect.
   */
  #storageFailed(error: unknown): void {
    this.#log('storage-failed', { error: describeError(error) });
    this.#move({ type: 'storage-error' });
    this.document = null;
    for (const socket of [...this.ctx.getWebSockets()]) {
      try {
        socket.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      } catch {
        // Already gone.
      }
    }
    this.stopKeepAlive();
  }

  /**
   * Apply one sync message and answer it. `readSyncMessage` handles all three
   * kinds — SyncStep1 is answered with what the room has, SyncStep2 and Update
   * are applied, and the document's update handler stores and relays to the
   * others.
   *
   * `readSyncMessage` swallows an `applyUpdate` failure by default, so the error
   * handler rethrows: a body that is not a Yjs update closes this socket instead
   * of being quietly dropped — and, because nothing was applied, nothing was
   * stored either.
   */
  private applySync(socket: WebSocket, payload: Uint8Array): void {
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    try {
      syncProtocol.readSyncMessage(
        decoding.createDecoder(payload),
        reply,
        this.doc(),
        socket,
        (error: Error) => {
          throw error;
        },
      );
    } catch {
      this.closeUnsupported(socket);
      return;
    }
    if (encoding.length(reply) > 1) this.write(socket, encoding.toUint8Array(reply));
  }

  /**
   * Relay a presence message to everybody else and remember the update inside it.
   * The payload is forwarded exactly as it arrived — the room edits nobody's
   * presence — and the stripped update is what gets remembered, because that is
   * what a removal has to be built from.
   */
  private relayAwareness(socket: WebSocket, payload: Uint8Array): void {
    const update = awarenessUpdateOf(payload);
    if (update === null) {
      this.closeUnsupported(socket);
      return;
    }
    if (isEmptyAwarenessUpdate(update)) {
      // A keep-alive, not news: nobody else needs it.
      return;
    }
    if (!isReadableAwarenessUpdate(update)) {
      // Length-prefixed, and nothing inside. This has to be the sender's
      // problem: the room reads what it remembers back later to build the
      // removal its disconnect needs, and a reader that throws in the middle of
      // a Durable Object handler stops every event the room has already been
      // handed, including other people's stored edits.
      this.closeUnsupported(socket);
      return;
    }
    remember(socket, { awareness: toBase64(update) });
    const bytes = frameMessage(MESSAGE_AWARENESS, payload);
    for (const target of [...this.ctx.getWebSockets()]) {
      if (target !== socket) this.write(target, bytes);
    }
  }

  /**
   * Answer a client's presence query with what the room knows about the others.
   * Presence belongs to the connection, so this is never a copy of the
   * requester's own state.
   */
  private answerAwarenessQuery(socket: WebSocket): void {
    for (const target of [...this.ctx.getWebSockets()]) {
      if (target === socket) continue;
      const awareness = attachmentOf(target).awareness;
      if (awareness === null) continue;
      this.write(socket, awarenessMessage(fromBase64(awareness)));
    }
  }

  /**
   * A connection is gone: tell everybody else so their presence does not claim
   * someone is still here. The removal keeps the clock the room last saw, which
   * is what makes clients drop it instead of ignoring it.
   *
   * When the last person leaves the document is discarded, which is what lets an
   * idle board cost nothing: whoever comes back reads it from storage, and the
   * state machine says the same thing the memory does.
   */
  private forgetResource(socket: WebSocket): void {
    const awareness = attachmentOf(socket).awareness;
    // The socket is already out of `getWebSockets()` by the time this runs.
    if (awareness !== null) {
      try {
        const removal = modifyAwarenessUpdate(fromBase64(awareness), () => null);
        const bytes = awarenessMessage(removal);
        for (const target of [...this.ctx.getWebSockets()]) this.write(target, bytes);
      } catch (error) {
        // Presence nobody can read is presence the room cannot announce the
        // absence of; clients drop it on their own clock. What it must not do is
        // take the rest of this handler with it — that is where the document is
        // released and the board stops costing anything.
        this.#log('awareness-removal-skipped', { error: describeError(error) });
      }
    }
    if (this.ctx.getWebSockets().length === 0) {
      this.stopKeepAlive();
      if (this.document !== null) {
        this.document = null;
        this.#move({ type: 'idle' });
      }
    }
  }

  /** Write to one socket, and note that it has heard from us. */
  private write(socket: WebSocket, bytes: Uint8Array): void {
    remember(socket, { lastWriteAt: Date.now() });
    try {
      socket.send(bytes);
    } catch {
      // A socket we cannot write to is of no further use, and `getWebSockets()`
      // will stop listing it once it is closed.
      try {
        socket.close(CLOSE_STORAGE_FAILURE, 'write failed');
      } catch {
        // Already gone.
      }
    }
  }

  /** Broadcast a document update, skipping whoever it came from. */
  private broadcastUpdate(update: Uint8Array, except: unknown): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const bytes = encoding.toUint8Array(encoder);
    for (const target of [...this.ctx.getWebSockets()]) {
      if (target === except) continue;
      this.write(target, bytes);
    }
  }

  private closeUnsupported(socket: WebSocket): void {
    try {
      socket.close(CLOSE_UNSUPPORTED_DATA, 'malformed message');
    } catch {
      // Already gone.
    }
    if (this.ctx.getWebSockets().length === 0) this.stopKeepAlive();
  }

  /** Keep idle-but-healthy sockets from timing out on a quiet room. */
  private startKeepAlive(): void {
    if (this.keepAliveTimer !== null) return;
    this.keepAliveTimer = setInterval(() => {
      const now = Date.now();
      for (const socket of [...this.ctx.getWebSockets()]) {
        if (now - attachmentOf(socket).lastWriteAt < KEEP_ALIVE_AFTER_MS) continue;
        // An awareness update with no clients in it: nothing to apply, and the
        // client hears a word from its room.
        this.write(socket, awarenessMessage(new Uint8Array([0])));
      }
    }, KEEP_ALIVE_CHECK_MS);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer === null) return;
    clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
  }

  /** Move the lifecycle along; `nextRoomState` is where the rules live. */
  #move(event: RoomEvent): void {
    this.lifecycle = nextRoomState(this.lifecycle, event);
  }

  #log(event: string, fields: Record<string, unknown>): void {
    console.error(JSON.stringify({ event: `board-room.${event}`, ...fields }));
  }
}

/**
 * Whether these bytes are an awareness update the room can read.
 *
 * `awarenessUpdateOf` can only tell that a body is the right length, and the
 * room has to be able to read what it remembers: the removal a disconnect
 * announces is derived from the update it remembered when that socket last spoke.
 * Reading is therefore validated here, where a failure still has somebody to
 * blame.
 */
function isReadableAwarenessUpdate(update: Uint8Array): boolean {
  try {
    modifyAwarenessUpdate(update, () => null);
    return true;
  } catch {
    return false;
  }
}

/** An awareness update with no clients in it: a keep-alive, not news. */
function isEmptyAwarenessUpdate(update: Uint8Array): boolean {
  return update.byteLength === 0 || update[0] === 0;
}

/**
 * What the room knows about a socket. Never throws and never undefined: a socket
 * that has been hibernated and woken can arrive with no attachment at all.
 */
function attachmentOf(socket: WebSocket): SocketAttachment {
  let raw: unknown = null;
  try {
    raw = socket.deserializeAttachment();
  } catch {
    raw = null;
  }
  const value = raw as Partial<SocketAttachment> | null;
  return {
    awareness: typeof value?.awareness === 'string' ? value.awareness : null,
    lastWriteAt: typeof value?.lastWriteAt === 'number' ? value.lastWriteAt : 0,
  };
}

/**
 * Update what the room knows about a socket. Called after every write, which is
 * the cheapest way to be sure a hibernated socket carries its own clock.
 */
function remember(socket: WebSocket, patch: Partial<SocketAttachment>): void {
  const next = { ...attachmentOf(socket), ...patch };
  try {
    socket.serializeAttachment(next);
  } catch {
    // A socket that cannot carry its state is not worth closing over.
  }
}

function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let at = 0; at < bytes.byteLength; at += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(text);
}

function fromBase64(text: string): Uint8Array {
  const decoded = atob(text);
  const bytes = new Uint8Array(decoded.length);
  for (let at = 0; at < decoded.length; at++) bytes[at] = decoded.charCodeAt(at);
  return bytes;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
