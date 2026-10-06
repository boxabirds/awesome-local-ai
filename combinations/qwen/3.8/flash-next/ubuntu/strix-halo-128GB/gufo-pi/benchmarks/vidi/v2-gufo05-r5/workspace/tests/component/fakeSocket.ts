/**
 * A scripted WebSocket for the component tests.
 *
 * jsdom has no server to talk to, so the connection itself is played by the test: it decides
 * when the wire opens, what arrives from the room and when the link dies. Everything above it
 * is real - the actual `WebsocketProvider`, the real y-protocols handshake, a real `Y.Doc` -
 * so the status mapping is exercised against a provider that behaves like the one in the
 * browser, including the SyncStep1 it sends as soon as the socket opens.
 */
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import type * as Y from 'yjs';
import { MESSAGE_SYNC } from '../../src/shared/protocol';

/**
 * Wraps a sync message into a frame the way the protocol does it: the frame type, then the
 * message itself. A sync frame carries no length prefix.
 */
export function syncFrameOf(message: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeUint8Array(encoder, message);
  return encoding.toUint8Array(encoder);
}

/** The type byte a frame starts with (0 sync, 1 awareness, 3 query). */
export function frameType(bytes: Uint8Array): number {
  return decoding.readVarUint(decoding.createDecoder(bytes));
}

export class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static #all: FakeSocket[] = [];

  /** Every socket created so far, oldest first: the newest one is the current attempt. */
  static get instances(): FakeSocket[] {
    return FakeSocket.#all;
  }

  /** The socket the provider is using right now. */
  static get latest(): FakeSocket {
    const socket = FakeSocket.#all[FakeSocket.#all.length - 1];
    if (!socket) throw new Error('no socket was created: the provider never tried to connect');
    return socket;
  }

  /** Number of connection attempts, so a test can say "no further attempt was made". */
  static get attempts(): number {
    return FakeSocket.#all.length;
  }

  static reset(): void {
    FakeSocket.#all = [];
  }

  /** Events a real socket delivers to `addEventListener` handlers as well as to `onX`. */
  static readonly EVENT_TYPES = ['open', 'message', 'close', 'error'] as const;

  readonly url: string;
  readyState = FakeSocket.CONNECTING;
  binaryType: string = 'arraybuffer';
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  /** Everything the provider wrote to the wire, oldest first. */
  readonly sent: Uint8Array[] = [];

  readonly #listeners = new Map<string, Set<(event: never) => void>>();

  constructor(url: string, _protocols?: string | string[]) {
    this.url = url;
    FakeSocket.#all.push(this);
  }

  /**
   * The part of `EventTarget` a socket consumer uses: `connectBoard` wraps the socket class and
   * watches `message` and `close` through listeners, while the provider itself uses `onX`.
   */
  addEventListener(type: string, listener: (event: never) => void): void {
    if (!FakeSocket.EVENT_TYPES.includes(type as (typeof FakeSocket.EVENT_TYPES)[number])) return;
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: never) => void): void {
    this.#listeners.get(type)?.delete(listener);
  }

  #emit(type: 'open' | 'message' | 'close' | 'error', event: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) {
      (listener as (event: unknown) => void)(event);
    }
    if (type === 'open') this.onopen?.(event);
    if (type === 'message') this.onmessage?.(event as { data: ArrayBuffer });
    if (type === 'close') this.onclose?.(event as { code: number; reason: string });
    if (type === 'error') this.onerror?.(event);
  }

  send(data: ArrayBuffer | Uint8Array): void {
    this.sent.push(data instanceof Uint8Array ? data : new Uint8Array(data));
  }

  /** The wire goes up: the provider immediately sends its SyncStep1. */
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.#emit('open', {});
  }

  /** Bytes from the room to the provider. */
  receive(frame: Uint8Array): void {
    const copy = new ArrayBuffer(frame.length);
    new Uint8Array(copy).set(frame);
    this.#emit('message', { data: copy });
  }

  /** The link dies (a dropped connection, not something either side said). */
  close(code = 1006, reason = ''): void {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.#emit('close', { code, reason });
  }

  /**
   * Answers the SyncStep1 this socket sent with a SyncStep2 built from `room` by the real
   * y-protocols code, exactly as the BoardRoom does: the provider ends up holding the room's
   * content and reports itself synced.
   */
  syncWith(room: Y.Doc): void {
    // the most recent sync frame: as soon as the wire is up the provider also sends its
    // awareness state, which is not what a room answers
    const request = [...this.sent].reverse().find((sent) => frameType(sent) === MESSAGE_SYNC);
    if (!request)
      throw new Error('the provider sent no sync frame: it never opened the connection');
    const decoder = decoding.createDecoder(request);
    decoding.readVarUint(decoder); // the frame type; the sync message follows
    const reply = encoding.createEncoder();
    syncProtocol.readSyncMessage(decoder, reply, room, null);
    this.receive(syncFrameOf(encoding.toUint8Array(reply)));
  }
}

/** Casts the scripted socket to the type the provider's polyfill option asks for. */
export const fakeWebSocket = FakeSocket as unknown as typeof WebSocket;
