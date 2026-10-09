import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { MESSAGE_SYNC } from '../../../src/shared/protocol';

/**
 * jsdom has no WebSocket and `App` connects its document to a board room, so component
 * tests talk to this instead: a room that accepts, answers the first sync so the client
 * becomes `connected`, and can be told the cable has been pulled. It keeps nothing —
 * the document a component test asserts on is the one on the screen, which is exactly
 * what "the board stays editable while it is reconnecting" is about.
 */
class StubSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = StubSocket.CONNECTING;
  readonly OPEN = StubSocket.OPEN;
  readonly CLOSING = StubSocket.CLOSING;
  readonly CLOSED = StubSocket.CLOSED;

  binaryType = 'blob';
  readyState = StubSocket.CONNECTING;

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocols?: string | string[] | null,
  ) {
    sockets.push(this);
  }

  /** What the client wrote, which is how this room decides what to answer. */
  send(data: ArrayBuffer): void {
    if (this.readyState !== StubSocket.OPEN) return;
    this.answer(data);
  }

  close(): void {
    if (this.readyState === StubSocket.CLOSED) return;
    this.readyState = StubSocket.CLOSED;
    this.onclose?.({ code: 1006, reason: 'stub', wasClean: false } as CloseEvent);
  }

  addEventListener(): void {}

  removeEventListener(): void {}

  dispatchEvent(): boolean {
    return true;
  }

  /** The one thing a board room must answer: "where are you up to?" */
  private answer(data: ArrayBuffer): void {
    const decoder = decoding.createDecoder(new Uint8Array(data));
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
    if (decoding.readVarUint(decoder) !== syncProtocol.messageYjsSyncStep1) return;
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    syncProtocol.writeSyncStep2(reply, room);
    this.deliver(encoding.toUint8Array(reply));
  }

  private deliver(bytes: Uint8Array): void {
    const data = bytes.slice().buffer as ArrayBuffer;
    queueMicrotask(() => {
      if (this.readyState !== StubSocket.OPEN || !this.onmessage) return;
      this.onmessage({ data } as MessageEvent<ArrayBuffer>);
    });
  }
}

/** The board this room holds: empty, and empty forever. */
const room = new Y.Doc();

const sockets: StubSocket[] = [];

globalThis.WebSocket = StubSocket as unknown as typeof WebSocket;

/** Open every socket the app has made so far; the room answers their sync right after. */
export async function socketsLive(): Promise<void> {
  for (const socket of sockets) {
    if (socket.readyState !== StubSocket.CONNECTING) continue;
    socket.readyState = StubSocket.OPEN;
    socket.onopen?.({} as Event);
  }
  // The sync answers are queued as microtasks by `deliver`; this awaits them.
  await Promise.resolve();
  await Promise.resolve();
}

/** The connection dies on its own — an outage, not a `destroy()`. */
export function socketsDrop(): void {
  for (const socket of sockets) socket.close();
}

/**
 * The room closes the door itself, with a code: 4500 is 'this board could not be
 * loaded' (story 4), 1011 is a storage failure — both are stories the badge tells
 * differently, and the code is the only thing that tells them apart.
 */
export function socketsCloseWith(code: number, reason = 'stub'): void {
  for (const socket of sockets) {
    if (socket.readyState !== StubSocket.OPEN) continue;
    socket.readyState = StubSocket.CLOSED;
    socket.onclose?.({ code, reason, wasClean: true } as CloseEvent);
  }
}

/** How many sockets the app has opened, so a test can see it retrying or not. */
export function socketCount(): number {
  return sockets.length;
}

/** Forget the sockets of tests past, so counts mean what this test made. */
export function clearSockets(): void {
  sockets.length = 0;
}
