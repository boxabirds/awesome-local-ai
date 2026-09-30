import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// jsdom may lack PointerEvent; Testing Library falls back to a plain Event
// (dropping clientX/pointerId) unless the constructor exists.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

// jsdom has no canvas (and logs "not implemented" when asked for one): text
// measurement falls back to its character-count estimate.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

// jsdom has no DragEvent; without it Testing Library drops clientX/clientY from drag and drop events.
if (typeof window.DragEvent === 'undefined') {
  class DragEventPolyfill extends MouseEvent {
    dataTransfer: DataTransfer | null;
    constructor(type: string, init: DragEventInit = {}) {
      super(type, init);
      this.dataTransfer = init.dataTransfer ?? null;
    }
  }
  window.DragEvent = DragEventPolyfill as unknown as typeof DragEvent;
}
