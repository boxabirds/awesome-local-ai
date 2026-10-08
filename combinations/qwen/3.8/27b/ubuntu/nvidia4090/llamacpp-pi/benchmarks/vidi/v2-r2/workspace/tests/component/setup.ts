import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom's default window is 1024x768; the component tests' camera fixture is
// the 1280x800 design viewport, so pin the window size before any render.
Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => 1280 });
Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => 800 });

type ProviderStatus = 'connecting' | 'connected' | 'disconnected';

/** A fake y-websocket provider a test can drive (see ConnectionStatus tests). */
export interface MockWebsocketProvider {
  emitStatus(status: ProviderStatus): void;
  emitSync(sync: boolean): void;
  /** Fire a socket close with the given close code (or null for a local close). */
  emitConnectionClose(code: number | null): void;
  destroyed: boolean;
}

// Every provider instance created during component tests, in creation
// order; the latest one belongs to the most recently rendered board.
// (vi.hoisted consts cannot be exported directly, hence the alias.)
const hoistedMock = vi.hoisted(
  () => ({
    providers: [] as {
      emitStatus(s: string): void;
      emitSync(s: boolean): void;
      emitConnectionClose(c: number | null): void;
      destroyed: boolean;
    }[],
  }),
);
export const mockProviders: MockWebsocketProvider[] = hoistedMock.providers;

// Unmount the previous test's tree and forget its providers.
afterEach(() => {
  cleanup();
  mockProviders.length = 0;
});

// Component tests never talk to a real room: replace the y-websocket
// provider with a fake that records itself in `mockProviders` so tests
// can drive status/sync events deterministically (the badge's state
// mapping is also tested standalone, see ConnectionStatus.test.tsx).
vi.mock('y-websocket', () => ({
  WebsocketProvider: class {
    private statusHandlers: ((event: { status: ProviderStatus }) => void)[] = [];
    private syncHandlers: ((sync: boolean) => void)[] = [];
    private closeHandlers: ((event: { code: number } | null) => void)[] = [];
    destroyed = false;

    constructor(..._args: unknown[]) {
      // The instance itself is the drive handle (see MockWebsocketProvider).
      mockProviders.push(this as unknown as MockWebsocketProvider);
    }

    on(event: 'status' | 'sync' | 'connection-close', handler: unknown): void {
      if (event === 'status') {
        this.statusHandlers.push(handler as never);
      } else if (event === 'sync') {
        this.syncHandlers.push(handler as never);
      } else {
        this.closeHandlers.push(handler as never);
      }
    }

    destroy(): void {
      this.destroyed = true;
    }

    emitStatus(status: ProviderStatus): void {
      for (const h of this.statusHandlers) {
        h({ status });
      }
    }

    emitSync(sync: boolean): void {
      for (const h of this.syncHandlers) {
        h(sync);
      }
    }

    emitConnectionClose(code: number | null): void {
      for (const h of this.closeHandlers) {
        h(code === null ? null : { code });
      }
    }
  },
}));

// jsdom does not implement PointerEvent; provide a minimal one over
// MouseEvent so Testing Library's pointer events carry clientX/Y/button.
if (typeof globalThis.PointerEvent !== 'function') {
  const MouseEventBase = globalThis.MouseEvent as unknown as new (
    type: string,
    init?: MouseEventInit,
  ) => MouseEvent;
  class PointerEventPolyfill extends MouseEventBase {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

// jsdom does not provide requestAnimationFrame/cancelAnimationFrame unless
// pretendToBeVisual is set; provide a timer-based fallback so camera update
// batching works in tests. Under vi.useFakeTimers() the underlying
// setTimeout is faked too, so timers can be advanced deterministically.
if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    return setTimeout(() => callback(Date.now()), 16) as unknown as number;
  };
}
if (typeof globalThis.cancelAnimationFrame !== 'function') {
  globalThis.cancelAnimationFrame = (id: number): void => {
    clearTimeout(id);
  };
}
