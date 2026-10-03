import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';

// Mock ResizeObserver
class MockResizeObserver {
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(_el: Element) {
    const entry = { contentRect: { width: 1280, height: 800 } } as any;
    this.callback([entry], this as any);
  }
  disconnect() {}
  unobserve() {}
}

vi.stubGlobal('ResizeObserver', MockResizeObserver);

// Mock pointer capture (not available in jsdom)
beforeEach(() => {
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = function (_id: number) {};
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = function (_id: number) {};
  }
  vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'releasePointerCapture').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function getViewport() {
  return screen.getByTestId('board-viewport');
}

function getWorldLayer() {
  return screen.getByTestId('world-layer');
}

function getZoomLabel() {
  return screen.getByTestId('zoom-label');
}

// Helper to dispatch pointer events with proper clientX/clientY in jsdom
function dispatchPointerEvent(
  el: HTMLElement,
  type: string,
  x: number,
  y: number,
  pointerId = 1,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'clientX', { value: x });
  Object.defineProperty(event, 'clientY', { value: y });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  el.dispatchEvent(event);
}

describe('BoardViewport - viewport.input', () => {
  it('TC-13: pointerdown/move(200,100)/up updates world layer transform', () => {
    render(<BoardViewport />);
    const viewport = getViewport();

    // Initial state: camera at origin, zoom 1
    const worldLayer = getWorldLayer();
    expect(worldLayer.style.transform).toBe('scale(1) translate(0px, 0px)');

    // Simulate drag: pointerdown at (100, 100), move to (300, 200)
    act(() => {
      dispatchPointerEvent(viewport, 'pointerdown', 100, 100);
    });
    act(() => {
      dispatchPointerEvent(viewport, 'pointermove', 300, 200);
    });
    act(() => {
      dispatchPointerEvent(viewport, 'pointerup', 300, 200);
    });

    // After dragging 200 right, 100 down: camera should be at (-200, -100)
    // World layer transform: translate(-(-200), -(-100)) = translate(200, 100)
    expect(worldLayer.style.transform).toBe('scale(1) translate(200px, 100px)');
  });

  it('TC-14: pointercancel mid-drag freezes camera; later moves ignored', () => {
    render(<BoardViewport />);
    const viewport = getViewport();

    act(() => {
      dispatchPointerEvent(viewport, 'pointerdown', 100, 100);
    });
    act(() => {
      dispatchPointerEvent(viewport, 'pointermove', 200, 150);
    });

    const worldLayer = getWorldLayer();
    const transformAtCancel = worldLayer.style.transform;
    expect(transformAtCancel).toBe('scale(1) translate(100px, 50px)');

    // Cancel
    act(() => {
      dispatchPointerEvent(viewport, 'pointercancel', 200, 150);
    });

    // Further moves should be ignored
    act(() => {
      dispatchPointerEvent(viewport, 'pointermove', 400, 300);
    });

    expect(worldLayer.style.transform).toBe(transformAtCancel);
  });

  it('TC-15: plain wheel deltaY +100 pans camera (content moves up); defaultPrevented', () => {
    render(<BoardViewport />);
    const viewport = getViewport();

    const wheelEvent = new WheelEvent('wheel', {
      deltaY: 100,
      deltaX: 0,
      bubbles: true,
      cancelable: true,
    });

    let defaultPrevented = false;
    act(() => {
      viewport.dispatchEvent(wheelEvent);
    });
    defaultPrevented = wheelEvent.defaultPrevented;

    // Scroll down (deltaY=+100): content moves up
    // Camera y increases by 100, so translate y = -100
    const worldLayer = getWorldLayer();
    expect(worldLayer.style.transform).toBe('scale(1) translate(0px, -100px)');
    expect(defaultPrevented).toBe(true);
  });

  it('TC-16: Ctrl wheel deltaY -100 at (300,200) zooms in; defaultPrevented', () => {
    render(<BoardViewport />);
    const viewport = getViewport();

    const wheelEvent = new WheelEvent('wheel', {
      deltaY: -100,
      deltaX: 0,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      clientX: 300,
      clientY: 200,
    });

    let defaultPrevented = false;
    act(() => {
      viewport.dispatchEvent(wheelEvent);
    });
    defaultPrevented = wheelEvent.defaultPrevented;

    // Zoom should increase from 1.0
    const zoomLabel = getZoomLabel();
    const percent = parseInt(zoomLabel.textContent!);
    expect(percent).toBeGreaterThan(100);
    expect(defaultPrevented).toBe(true);
  });

  it('TC-17: gesturechange scale 2 doubles zoom; defaultPrevented', () => {
    render(<BoardViewport />);
    const viewport = getViewport();

    // Fire gesturestart first
    const gestureStart = new Event('gesturestart', { bubbles: true, cancelable: true });
    act(() => {
      viewport.dispatchEvent(gestureStart);
    });

    // Fire gesturechange with scale 2
    const gestureChange = new Event('gesturechange', { bubbles: true, cancelable: true });
    Object.defineProperty(gestureChange, 'scale', { value: 2 });
    let defaultPrevented = false;
    act(() => {
      viewport.dispatchEvent(gestureChange);
    });
    defaultPrevented = gestureChange.defaultPrevented;

    // Zoom should be approximately 2.0 (200%)
    const zoomLabel = getZoomLabel();
    const percent = parseInt(zoomLabel.textContent!);
    expect(percent).toBe(200);
    expect(defaultPrevented).toBe(true);
  });

  it('TC-18: Ctrl+= zooms in, Ctrl+- zooms out, Ctrl+0 resets', () => {
    render(<BoardViewport />);

    // Ctrl+= → zoom in to 125%
    const keyEvent1 = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(keyEvent1);
    });
    let zoomLabel = getZoomLabel();
    expect(zoomLabel.textContent).toBe('125%');
    expect(keyEvent1.defaultPrevented).toBe(true);

    // Ctrl+- → zoom out to 100%
    const keyEvent2 = new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(keyEvent2);
    });
    zoomLabel = getZoomLabel();
    expect(zoomLabel.textContent).toBe('100%');
    expect(keyEvent2.defaultPrevented).toBe(true);

    // Ctrl+0 → reset
    const keyEvent3 = new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(keyEvent3);
    });
    zoomLabel = getZoomLabel();
    expect(zoomLabel.textContent).toBe('100%');
    expect(keyEvent3.defaultPrevented).toBe(true);
  });

  it('TC-29: click without move does not change camera or dismiss hint', () => {
    render(<BoardViewport />);
    const viewport = getViewport();

    // Hint should be visible
    expect(screen.getByTestId('navigation-hint')).toBeTruthy();

    // Click without moving
    act(() => {
      dispatchPointerEvent(viewport, 'pointerdown', 100, 100);
    });
    act(() => {
      dispatchPointerEvent(viewport, 'pointerup', 100, 100);
    });

    // Camera unchanged
    const worldLayer = getWorldLayer();
    expect(worldLayer.style.transform).toBe('scale(1) translate(0px, 0px)');

    // Hint still visible
    expect(screen.getByTestId('navigation-hint')).toBeTruthy();
  });

  it('TC-30: Ctrl wheel over zoom control does not zoom the board', () => {
    render(<BoardViewport />);
    const zoomControls = screen.getByTestId('zoom-controls');

    const wheelEvent = new WheelEvent('wheel', {
      deltaY: -100,
      deltaX: 0,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      clientX: 1200,
      clientY: 750,
    });

    act(() => {
      zoomControls.dispatchEvent(wheelEvent);
    });

    // Board camera should be unchanged
    const worldLayer = getWorldLayer();
    expect(worldLayer.style.transform).toBe('scale(1) translate(0px, 0px)');
  });
});
