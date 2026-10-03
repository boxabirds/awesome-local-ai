/**
 * A WebSocket that lets a test decide what the room does.
 *
 * The app's read-only state is not a flag it sets for itself: it is what
 * `useBoardDoc` concludes when the room closes the socket with the code that means
 * "this board could not be read from storage". So a test that wants a board nobody
 * can edit drives the real path — stub the constructor, then close the socket the
 * way the room does (`LOAD_FAILED_CLOSE_CODE`) — rather than reaching into the app
 * for a knob that does not exist.
 */
import { act } from '@testing-library/react';
import { vi } from 'vitest';

/** The close code the room uses for "this board could not be read from storage". */
export const LOAD_FAILED_CLOSE_CODE = 4500;

export interface FakeSocket {
  /** Close the socket the way the room does when the object will not load. */
  refuseLoad(): Promise<void>;
}

/**
 * Replace `WebSocket` for the current test.
 *
 * Call `vi.unstubAllGlobals()` afterwards (or let the fixture's own `afterEach` do
 * it), or the next test in the file will find a board that never really connects.
 */
export function installFakeWebSocket(): FakeSocket {
  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    static instances: FakeWebSocket[] = [];
    binaryType = 'arraybuffer';
    readyState = 1;
    onopen: (() => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;

    constructor(
      readonly url: string,
      readonly protocols?: string | string[],
    ) {
      FakeWebSocket.instances.push(this);
    }

    send(): void {
      // Nothing arrives: this board never syncs, which is the point.
    }

    close(): void {
      this.readyState = 3;
    }
  }
  vi.stubGlobal('WebSocket', FakeWebSocket);

  return {
    refuseLoad: async () => {
      const socket = FakeWebSocket.instances[0];
      if (!socket) throw new Error('the board never tried to connect');
      await act(async () => {
        socket.onclose?.({ code: LOAD_FAILED_CLOSE_CODE });
      });
    },
  };
}
