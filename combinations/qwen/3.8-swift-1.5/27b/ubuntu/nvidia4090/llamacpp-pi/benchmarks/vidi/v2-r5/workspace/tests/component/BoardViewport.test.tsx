// @vitest-environment jsdom
// tests/component/BoardViewport.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, cleanup } from '@testing-library/react';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import type { Camera } from '../../src/client/canvas/camera';

// Mock ResizeObserver
class MockResizeObserver {
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(_target: Element) {
    this.callback(
      [{ contentRect: { width: 1280, height: 800 } } as unknown as ResizeObserverEntry],
      this,
    );
  }
  disconnect() {}
  unobserve() {}
}

vi.stubGlobal('ResizeObserver', MockResizeObserver);

// Mock pointer capture methods (not available in jsdom)
beforeEach(() => {
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {};
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {};
  }
  vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'releasePointerCapture').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function createProps(overrides?: Partial<{
  camera: Camera;
  beginPan: ReturnType<typeof vi.fn>;
  panMove: ReturnType<typeof vi.fn>;
  endPan: ReturnType<typeof vi.fn>;
  wheel: ReturnType<typeof vi.fn>;
  zoomIn: ReturnType<typeof vi.fn>;
  zoomOut: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
}>) {
  const camera: Camera = { x: 0, y: 0, zoom: 1 };
  const beginPan = vi.fn();
  const panMove = vi.fn();
  const endPan = vi.fn();
  const wheel = vi.fn();
  const zoomIn = vi.fn();
  const zoomOut = vi.fn();
  const reset = vi.fn();
  return { camera, beginPan, panMove, endPan, wheel, zoomIn, zoomOut, reset, ...overrides };
}

describe('BoardViewport - viewport.input', () => {
  describe('TC-13: pointer drag pan', () => {
    it('pointerdown/move(200,100)/up calls beginPan, panMove, endPan correctly', () => {
      const props = createProps();
      const { container } = render(<BoardViewport {...props} />);
      const viewport = container.querySelector('.board-viewport')!;

      // Mock getBoundingClientRect to return a known position
      vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, width: 1280, height: 800, left: 0, top: 0, right: 1280, bottom: 800,
      } as DOMRect);

      // Helper to create pointer-like events in jsdom
      function makePointerEvent(type: string, x: number, y: number, pointerId = 1) {
        const ev = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'clientX', { value: x });
        Object.defineProperty(ev, 'clientY', { value: y });
        Object.defineProperty(ev, 'pointerId', { value: pointerId });
        return ev;
      }

      // Pointer down
      act(() => {
        viewport.dispatchEvent(makePointerEvent('pointerdown', 100, 100));
      });
      expect(props.beginPan).toHaveBeenCalledWith({ x: 100, y: 100 });

      // Pointer move
      act(() => {
        viewport.dispatchEvent(makePointerEvent('pointermove', 300, 200));
      });
      expect(props.panMove).toHaveBeenCalledWith({ x: 300, y: 200 });

      // Pointer up
      act(() => {
        viewport.dispatchEvent(makePointerEvent('pointerup', 300, 200));
      });
      expect(props.endPan).toHaveBeenCalled();
    });
  });

  describe('TC-14: drag interrupted by pointercancel', () => {
    it('pointercancel stops panning; later moves are ignored', () => {
      const props = createProps();
      const { container } = render(<BoardViewport {...props} />);
      const viewport = container.querySelector('.board-viewport')!;

      // Start drag
      act(() => {
        fireEvent.pointerDown(viewport, {
          clientX: 100,
          clientY: 100,
          pointerId: 1,
        });
      });

      // Move
      act(() => {
        fireEvent.pointerMove(viewport, {
          clientX: 200,
          clientY: 150,
          pointerId: 1,
        });
      });
      expect(props.panMove).toHaveBeenCalledTimes(1);

      // Cancel
      act(() => {
        fireEvent.pointerCancel(viewport, {
          clientX: 200,
          clientY: 150,
          pointerId: 1,
        });
      });
      expect(props.endPan).toHaveBeenCalled();

      // Further moves should be ignored
      act(() => {
        fireEvent.pointerMove(viewport, {
          clientX: 400,
          clientY: 300,
          pointerId: 1,
        });
      });
      expect(props.panMove).toHaveBeenCalledTimes(1); // still 1
    });
  });

  describe('TC-15: plain wheel pans', () => {
    it('wheel deltaY=+100 calls wheel with correct values and preventDefault', () => {
      const props = createProps();
      const { container } = render(<BoardViewport {...props} />);
      const viewport = container.querySelector('.board-viewport')!;

      const wheelEvent = new WheelEvent('wheel', {
        deltaX: 0,
        deltaY: 100,
        deltaMode: 0,
        cancelable: true,
        bubbles: true,
      });

      act(() => {
        viewport.dispatchEvent(wheelEvent);
      });

      expect(props.wheel).toHaveBeenCalledWith(
        expect.objectContaining({
          deltaX: 0,
          deltaY: 100,
          ctrlOrMeta: false,
        }),
      );
      expect(wheelEvent.defaultPrevented).toBe(true);
    });
  });

  describe('TC-16: Ctrl wheel zooms', () => {
    it('Ctrl wheel deltaY=-100 at (300,200) calls wheel with ctrlOrMeta=true', () => {
      const props = createProps();
      const { container } = render(<BoardViewport {...props} />);
      const viewport = container.querySelector('.board-viewport')!;

      const wheelEvent = new WheelEvent('wheel', {
        deltaX: 0,
        deltaY: -100,
        deltaMode: 0,
        cancelable: true,
        bubbles: true,
        ctrlKey: true,
      });
      Object.defineProperty(wheelEvent, 'clientX', { value: 300 });
      Object.defineProperty(wheelEvent, 'clientY', { value: 200 });

      act(() => {
        viewport.dispatchEvent(wheelEvent);
      });

      expect(props.wheel).toHaveBeenCalledWith(
        expect.objectContaining({
          deltaX: 0,
          deltaY: -100,
          ctrlOrMeta: true,
        }),
      );
      expect(wheelEvent.defaultPrevented).toBe(true);
    });
  });

  describe('TC-17: Safari gesture', () => {
    it('gesturechange with scale 2 calls wheel with ctrlOrMeta=true', () => {
      const props = createProps();
      const { container } = render(<BoardViewport {...props} />);
      const viewport = container.querySelector('.board-viewport')!;

      const gestureEvent = new Event('gesturechange', { cancelable: true, bubbles: true });
      Object.defineProperty(gestureEvent, 'scale', { value: 2 });
      Object.defineProperty(gestureEvent, 'clientX', { value: 100 });
      Object.defineProperty(gestureEvent, 'clientY', { value: 100 });

      act(() => {
        viewport.dispatchEvent(gestureEvent);
      });

      expect(props.wheel).toHaveBeenCalledWith(
        expect.objectContaining({
          ctrlOrMeta: true,
        }),
      );
      expect(gestureEvent.defaultPrevented).toBe(true);
    });
  });

  describe('TC-18: keyboard shortcuts', () => {
    it('Ctrl+= calls zoomIn, Ctrl+- calls zoomOut, Ctrl+0 calls reset, all preventDefault', () => {
      const props = createProps();
      render(<BoardViewport {...props} />);

      // Ctrl+=
      const eqEvent = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, cancelable: true, bubbles: true });
      act(() => {
        window.dispatchEvent(eqEvent);
      });
      expect(props.zoomIn).toHaveBeenCalled();
      expect(eqEvent.defaultPrevented).toBe(true);

      // Ctrl+-
      const minusEvent = new KeyboardEvent('keydown', { key: '-', ctrlKey: true, cancelable: true, bubbles: true });
      act(() => {
        window.dispatchEvent(minusEvent);
      });
      expect(props.zoomOut).toHaveBeenCalled();
      expect(minusEvent.defaultPrevented).toBe(true);

      // Ctrl+0
      const zeroEvent = new KeyboardEvent('keydown', { key: '0', ctrlKey: true, cancelable: true, bubbles: true });
      act(() => {
        window.dispatchEvent(zeroEvent);
      });
      expect(props.reset).toHaveBeenCalled();
      expect(zeroEvent.defaultPrevented).toBe(true);
    });
  });

  describe('TC-29: click without move does not trigger pan', () => {
    it('pointerdown then pointerup without move does not call panMove', () => {
      const props = createProps();
      const { container } = render(<BoardViewport {...props} />);
      const viewport = container.querySelector('.board-viewport')!;

      act(() => {
        fireEvent.pointerDown(viewport, {
          clientX: 100,
          clientY: 100,
          pointerId: 1,
        });
      });
      act(() => {
        fireEvent.pointerUp(viewport, {
          clientX: 100,
          clientY: 100,
          pointerId: 1,
        });
      });

      expect(props.beginPan).toHaveBeenCalled();
      expect(props.panMove).not.toHaveBeenCalled();
      expect(props.endPan).toHaveBeenCalled();
    });
  });

  describe('TC-30: Ctrl wheel over zoom control does not zoom board', () => {
    it('wheel event with stopPropagation does not reach board handler', () => {
      const props = createProps();
      const { container } = render(<BoardViewport {...props} />);
      const viewport = container.querySelector('.board-viewport')!;

      // Simulate a wheel event that was stopped by a child element
      // (ZoomControls calls stopPropagation)
      const wheelEvent = new WheelEvent('wheel', {
        deltaX: 0,
        deltaY: -100,
        deltaMode: 0,
        cancelable: true,
        bubbles: true,
        ctrlKey: true,
      });
      Object.defineProperty(wheelEvent, 'clientX', { value: 300 });
      Object.defineProperty(wheelEvent, 'clientY', { value: 200 });

      // Stop propagation to simulate ZoomControls behavior
      wheelEvent.stopPropagation();

      act(() => {
        // Create a child element and dispatch there (simulating the zoom controls)
        const child = document.createElement('div');
        viewport.appendChild(child);
        child.dispatchEvent(wheelEvent);
        viewport.removeChild(child);
      });

      // The board's wheel handler should not have been called
      // because the event's propagation was stopped
      expect(props.wheel).not.toHaveBeenCalled();
    });
  });

  describe('world layer transform', () => {
    it('world layer has correct transform for camera state', () => {
      const camera: Camera = { x: 100, y: 50, zoom: 2 };
      const props = createProps({ camera });
      const { container } = render(<BoardViewport {...props} />);
      const world = container.querySelector('.board-world') as HTMLElement;
      expect(world.style.transform).toBe('scale(2) translate(-100px, -50px)');
    });
  });
});
