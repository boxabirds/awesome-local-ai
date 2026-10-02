import { vi } from 'vitest';

let installed = false;

/**
 * Install the jsdom mocks the sticky-note component tests rely on:
 * PointerEvent, setPointerCapture/releasePointerCapture, and ResizeObserver.
 * Idempotent — safe to call from multiple test files.
 */
export function installComponentMocks(): void {
  if (installed) return;
  installed = true;

  if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === 'undefined') {
    class MockPointerEvent extends MouseEvent {
      pointerId: number;
      constructor(type: string, props: PointerEventInit & { pointerId?: number } = {}) {
        super(type, props);
        this.pointerId = props.pointerId ?? 0;
      }
    }
    vi.stubGlobal('PointerEvent', MockPointerEvent);
  }

  if (typeof HTMLElement.prototype.setPointerCapture !== 'function') {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      writable: true,
      value: function () {},
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      writable: true,
      value: function () {},
    });
  }

  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
    class MockResizeObserver {
      observe(_el: Element) {}
      unobserve(_el: Element) {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
  }

  // jsdom has no rAF; the rAF-throttled transform gesture needs it.
  if (typeof (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame === 'undefined') {
    const pending = new Map<number, number>();
    let nextId = 1;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextId++;
      pending.set(id, window.setTimeout(() => {
        pending.delete(id);
        cb(performance.now());
      }, 0));
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      const t = pending.get(id);
      if (t !== undefined) {
        clearTimeout(t);
        pending.delete(id);
      }
    });
  }
}
