/**
 * jsdom shims for the browser APIs the board viewport uses.
 *
 * `ResizeObserverStub` reports a configurable size so component tests can
 * control the viewport dimensions and simulate a window resize.
 */

export interface StubSize {
  width: number;
  height: number;
}

export class ResizeObserverStub {
  static size: StubSize = { width: 1200, height: 800 };
  static instances: ResizeObserverStub[] = [];

  private readonly observed: Element[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }

  observe(target: Element): void {
    if (!this.observed.includes(target)) this.observed.push(target);
    this.report();
  }

  unobserve(target: Element): void {
    const index = this.observed.indexOf(target);
    if (index >= 0) this.observed.splice(index, 1);
  }

  disconnect(): void {
    this.observed.length = 0;
  }

  /** Push the current stub size to every live observer, as a browser would. */
  static resize(size: StubSize): void {
    ResizeObserverStub.size = size;
    for (const instance of ResizeObserverStub.instances) instance.report();
  }

  static reset(): void {
    ResizeObserverStub.instances = [];
    ResizeObserverStub.size = { width: 1200, height: 800 };
  }

  private report(): void {
    const entries = this.observed.map((target) => ({
      target,
      contentRect: {
        width: ResizeObserverStub.size.width,
        height: ResizeObserverStub.size.height,
        top: 0,
        left: 0,
        bottom: ResizeObserverStub.size.height,
        right: ResizeObserverStub.size.width,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      },
      contentBoxSize: [
        { inlineSize: ResizeObserverStub.size.width, blockSize: ResizeObserverStub.size.height },
      ],
      borderBoxSize: [],
      contentBoxSizeCompat: [],
      borderBoxSizeCompat: [],
      devicePixelContentBoxSize: [],
    })) as unknown as ResizeObserverEntry[];
    if (entries.length > 0) this.callback(entries, this as unknown as ResizeObserver);
  }
}

/**
 * A `WebSocket` that never opens.
 *
 * Story 3 starts a connection as soon as a board mounts, and the component
 * tests render whole boards; jsdom would open a real socket to a server that is
 * not there. This fake stays in `CONNECTING` forever instead, which is exactly
 * what a board in front of an unreachable server looks like — the state the
 * connection badge starts in (and the reason the component tests can assert on
 * it: see `tests/component/ConnectionStatus.test.tsx`).
 */
export class FakeSocket {
  static instances: FakeSocket[] = [];

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = 0;
  binaryType: string = 'arraybuffer';
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;

  /** Frames the app tried to send, in order. */
  readonly sent: Uint8Array[] = [];

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: Uint8Array): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = this.CLOSED;
  }

  addEventListener(): void {}

  removeEventListener(): void {}

  static reset(): void {
    FakeSocket.instances = [];
  }

  /** The socket story 3's provider opened first, if any. */
  static first(): FakeSocket | undefined {
    return FakeSocket.instances[0];
  }
}

/** Records `setPointerCapture` calls so tests can assert the drag captured. */
export const pointerCaptureRecorder = {
  capturedPointerIds: [] as number[],
  releasedPointerIds: [] as number[],
  reset(): void {
    this.capturedPointerIds = [];
    this.releasedPointerIds = [];
  },
};

export function installComponentTestShims(): void {
  ResizeObserverStub.reset();
  pointerCaptureRecorder.reset();
  FakeSocket.reset();

  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: ResizeObserverStub,
    configurable: true,
    writable: true,
  });

  Object.defineProperty(globalThis, 'WebSocket', {
    value: FakeSocket,
    configurable: true,
    writable: true,
  });

  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.setPointerCapture ??= (pointerId: number) => {
    pointerCaptureRecorder.capturedPointerIds.push(pointerId);
  };
  proto.releasePointerCapture ??= (pointerId: number) => {
    pointerCaptureRecorder.releasedPointerIds.push(pointerId);
  };
  proto.hasPointerCapture ??= (pointerId: number) =>
    pointerCaptureRecorder.capturedPointerIds.includes(pointerId);
}
