import '@testing-library/jest-dom';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// Mock setPointerCapture and releasePointerCapture for jsdom
if (typeof Element !== 'undefined') {
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = function() {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = function() {};
  }
}

// Story 3: the App attaches a y-websocket provider. In component tests we do
// not want real sockets, so install a no-op WebSocket that never opens (the
// provider then idles in 'connecting' with no timers and no network).
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  binaryType = 'blob';
  onopen: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev?: unknown) => void) | null = null;
  constructor(url: string) {
    this.url = url;
  }
  send(_data: unknown): void {}
  close(_code?: number, _reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}
(globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;
