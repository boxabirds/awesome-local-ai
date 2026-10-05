/**
 * A WebSocket that never leaves the test.
 *
 * Some page tests have to take the app all the way to a board — the whole route, the asking, the
 * board arriving — and at that point the app opens the board's connection, which in jsdom means
 * jsdom dialling a server that is not there. Nothing in those tests is about the connection: the
 * stories that are about it hand the board a connector of their own and never get near this. So the
 * socket here accepts the call, remembers the address it was dialled at, and then says nothing, ever
 * — which is also, incidentally, exactly what a server that is having a bad minute looks like, and a
 * better stand-in than one that pretends the board is live.
 */
import { vi } from 'vitest';

export class SilentSocket {
  /** Every socket dialled since the last reset, with the address it was dialled at. */
  static readonly dialed: SilentSocket[] = [];

  binaryType = 'arraybuffer';
  readonly readyState = 0;
  readonly url: string;
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    SilentSocket.dialed.push(this);
  }

  addEventListener(): void {}

  removeEventListener(): void {}

  send(): void {}

  close(): void {
    // The provider asks to stop talking; nothing is listening, and it does not report a close. The
    // socket stays where it was: a board page that is being torn down has no more use for it than it
    // had for the answer that never came.
  }
}

/** Put the socket out of the test's way. Call it before rendering anything that connects. */
export function silenceWebSockets(): void {
  vi.stubGlobal('WebSocket', SilentSocket);
}

/** The board addresses the app has tried to connect to. */
export function dialedRoomUrls(): string[] {
  return SilentSocket.dialed.map((socket) => socket.url);
}
