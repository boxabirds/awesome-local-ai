// jsdom lacks pointer capture and ResizeObserver; provide minimal stubs.

Element.prototype.setPointerCapture = function setPointerCapture(_pointerId: number): void {};
Element.prototype.releasePointerCapture = function releasePointerCapture(_pointerId: number): void {};
Element.prototype.hasPointerCapture = function hasPointerCapture(_pointerId: number): boolean {
  return false;
};

class ResizeObserverMock {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    const rect = target.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : window.innerWidth;
    const height = rect.height > 0 ? rect.height : window.innerHeight;
    const entry = {
      target,
      contentRect: { ...rect, width, height }
    } as unknown as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }

  unobserve(_target: Element): void {}

  disconnect(): void {}
}

globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

// jsdom's WebSocket would attempt real network connections when a mounted
// component builds a WebsocketProvider. This stub keeps the transport inert:
// it never opens, so connection state stays "connecting" and tests that mock
// connectBoard are unaffected.
class WebSocketStub {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  url: string;
  binaryType = 'arraybuffer';
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return true;
  }
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
}

globalThis.WebSocket = WebSocketStub as unknown as typeof WebSocket;
