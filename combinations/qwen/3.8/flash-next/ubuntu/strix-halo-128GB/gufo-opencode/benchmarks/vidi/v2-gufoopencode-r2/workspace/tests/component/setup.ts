import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Story 5: component tests render <App/>; the board-level ones assert on the
// board synchronously after render, so route them to a fixed valid board id
// and resolve the existence check synchronously (a thenable whose callback
// fires inline — BoardPage consumes checkBoard with .then, so `ready` lands
// inside the initial act() and BoardScreen mounts during render()).
export const COMPONENT_BOARD_ID = 'componenttestboard0000'; // 22 chars, [a-z0-9]
window.history.replaceState(null, '', `/b/${COMPONENT_BOARD_ID}`);

vi.mock('../../src/client/api', () => ({
  createBoardRequest: () => Promise.resolve({ kind: 'failed' }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  checkBoard: (_id: string): any => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then: (resolve: (value: any) => void) => resolve({ kind: 'exists' }),
  }),
}));

// jsdom lacks ResizeObserver; simulate a fixed laptop viewport (1280x800),
// delivering the initial observation synchronously on observe().
class ResizeObserverMock {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    const rect = {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1280,
      bottom: 800,
      width: 1280,
      height: 800,
      toJSON: () => ({}),
    } as DOMRectReadOnly;
    const entry = {
      target,
      contentRect: rect,
      borderBoxSize: [{ inlineSize: 1280, blockSize: 800 }],
      contentBoxSize: [{ inlineSize: 1280, blockSize: 800 }],
    } as unknown as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }

  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

// Older jsdom has no PointerEvent; fall back to MouseEvent (clientX/Y/pointerId
// are assigned onto the instance by Testing Library).
if (typeof window.PointerEvent === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).PointerEvent = window.MouseEvent;
}

// Component tests never talk to a real server: the y-websocket provider
// constructed by App stays in 'connecting' forever against this stub, which
// is the connection state the board-level tests were written assuming.
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = 0;
  binaryType = 'arraybuffer';

  constructor(public readonly url: string) {}

  addEventListener(): void {}
  removeEventListener(): void {}
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
}

globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

// The text measurer probes getContext('2d'); without the canvas package jsdom
// logs a "Not implemented" jsdomError before returning null. The estimator
// fallback is exactly what those tests run against (TC-32 covers it in unit),
// so stub the probe directly to keep stderr clean.
HTMLCanvasElement.prototype.getContext = vi
  .fn()
  .mockReturnValue(null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
