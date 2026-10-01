import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * jsdom has no layout engine. The board viewport measures itself with
 * getBoundingClientRect + ResizeObserver, so tests drive a deterministic
 * 1280x800 laptop viewport: getBoundingClientRect always reports it, and the
 * ResizeObserver stub re-reports synchronously on observe (and on
 * triggerResize for resize scenarios).
 */
export const VIEWPORT_WIDTH = 1280;
export const VIEWPORT_HEIGHT = 800;

function fakeRect(): DOMRect {
  const rect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: VIEWPORT_WIDTH,
    bottom: VIEWPORT_HEIGHT,
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
  };
  return { ...rect, toJSON: () => rect } as DOMRect;
}

const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

Element.prototype.getBoundingClientRect = function () {
  return fakeRect();
};

export const resizeObservers: ResizeObserverStub[] = [];

class ResizeObserverStub {
  private readonly onResize: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.onResize = callback;
    resizeObservers.push(this);
  }

  observe(target: Element): void {
    this.onResize([makeEntry(target)], this as unknown as ResizeObserver);
  }

  unobserve(): void {}

  disconnect(): void {
    const index = resizeObservers.indexOf(this);
    if (index >= 0) resizeObservers.splice(index, 1);
  }

  triggerResize(target: Element): void {
    this.onResize([makeEntry(target)], this as unknown as ResizeObserver);
  }
}

function makeEntry(target: Element): ResizeObserverEntry {
  return {
    target,
    contentRect: target.getBoundingClientRect(),
    borderBoxSize: [],
    contentBoxSize: [],
    devicePixelContentBoxSize: [],
  } as ResizeObserverEntry;
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub);

/**
 * A component test renders a board, and a board connects to its room. Here the
 * room is not part of the question being asked — that is the integration tier,
 * on the real runtime, and the end-to-end tier, on a real browser — so the
 * socket is a stub that opens nothing. Without it every component test would
 * spend its time retrying a connection to a server that is not there.
 */
class StubWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = StubWebSocket.CONNECTING;
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    openedSockets.push(this);
  }

  send(data: unknown): void {
    sent.push(data);
  }

  close(): void {
    this.readyState = StubWebSocket.CLOSED;
  }

  addEventListener(): void {}

  removeEventListener(): void {}

  /** Pretend the room answered the join, so anything waiting on a sync proceeds. */
  open(): void {
    this.readyState = StubWebSocket.OPEN;
    this.onopen?.({});
  }
}

export const openedSockets: StubWebSocket[] = [];
export const sent: unknown[] = [];

vi.stubGlobal('WebSocket', StubWebSocket);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

afterAll(() => {
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});
