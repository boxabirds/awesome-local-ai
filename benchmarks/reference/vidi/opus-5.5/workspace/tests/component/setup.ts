import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

/** Board area size used by component tests (jsdom has no layout). */
export const TEST_VIEWPORT = { width: 1280, height: 800 } as const;

/**
 * The app connects to its board room over a WebSocket. Component tests have no server: this
 * socket never opens, so the board stays "Connecting…" and fully usable locally.
 */
class OfflineWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = OfflineWebSocket.CONNECTING;
  binaryType = 'arraybuffer';
  onopen: unknown = null;
  onmessage: unknown = null;
  onclose: unknown = null;
  onerror: unknown = null;
  constructor(readonly url: string) {
    super();
  }
  send(): void {}
  close(): void {
    this.readyState = OfflineWebSocket.CLOSED;
  }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', OfflineWebSocket);
  // jsdom has no canvas (it logs "not implemented"); text measurement uses its estimate (story 9).
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: TEST_VIEWPORT.width,
        height: TEST_VIEWPORT.height,
        right: TEST_VIEWPORT.width,
        bottom: TEST_VIEWPORT.height,
        toJSON: () => ({}),
      }) as DOMRect,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
