import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import { useCamera } from '../../src/client/canvas/useCamera';
import { canZoomIn, canZoomOut, zoomPercent } from '../../src/client/canvas/camera';

// Helper component that wraps BoardViewport with useCamera
function TestBoard() {
  const { camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomStep, reset } = useCamera({
    width: 1280,
    height: 800,
  });

  return (
    <div>
      <BoardViewport
        camera={camera}
        beginPan={beginPan}
        panMove={panMove}
        endPan={endPan}
        wheel={wheel}
        zoomStep={zoomStep}
        reset={reset}
      />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  // Mock pointer capture methods not available in jsdom
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function createPointerEvent(type: string, x: number, y: number, options: Record<string, unknown> = {}): Event {
  const event = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'isPrimary', { value: true });
  Object.assign(event, options);
  return event;
}

describe('BoardViewport component tests', () => {
  // TC-13: pointerdown/move(200,100)/up: world layer transform matches camera
  it('TC-13: drag moves the world layer', () => {
    render(<TestBoard />);
    const viewport = screen.getByTestId('board-viewport');
    const worldLayer = screen.getByTestId('world-layer');

    const initialTransform = worldLayer.style.transform;
    expect(initialTransform).toContain('scale(1)');

    act(() => {
      viewport.dispatchEvent(createPointerEvent('pointerdown', 100, 100));
    });

    act(() => {
      viewport.dispatchEvent(createPointerEvent('pointermove', 300, 200));
    });

    act(() => {
      vi.runOnlyPendingTimers();
    });

    act(() => {
      viewport.dispatchEvent(createPointerEvent('pointerup', 300, 200));
    });

    const finalTransform = worldLayer.style.transform;
    expect(finalTransform).not.toBe(initialTransform);
  });

  // TC-14: pointercancel mid-drag: camera frozen at cancel
  it('TC-14: pointercancel freezes camera', () => {
    render(<TestBoard />);
    const viewport = screen.getByTestId('board-viewport');
    const worldLayer = screen.getByTestId('world-layer');

    act(() => {
      viewport.dispatchEvent(createPointerEvent('pointerdown', 100, 100));
    });

    act(() => {
      viewport.dispatchEvent(createPointerEvent('pointermove', 200, 150));
    });

    act(() => {
      vi.runOnlyPendingTimers();
    });

    const transformAtCancel = worldLayer.style.transform;

    act(() => {
      viewport.dispatchEvent(createPointerEvent('pointercancel', 200, 150));
    });

    act(() => {
      viewport.dispatchEvent(createPointerEvent('pointermove', 400, 300));
    });

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(worldLayer.style.transform).toBe(transformAtCancel);
  });

  // TC-15: plain wheel deltaY +100: camera y increases by 100/zoom
  it('TC-15: plain wheel pans the board', () => {
    render(<TestBoard />);
    const viewport = screen.getByTestId('board-viewport');
    const worldLayer = screen.getByTestId('world-layer');

    const beforeTransform = worldLayer.style.transform;

    const wheelEvent = new WheelEvent('wheel', {
      deltaX: 0,
      deltaY: 100,
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      viewport.dispatchEvent(wheelEvent);
    });

    expect(wheelEvent.defaultPrevented).toBe(true);
    expect(worldLayer.style.transform).not.toBe(beforeTransform);
  });

  // TC-16: Ctrl wheel deltaY -100 at (300,200): zoom increases
  it('TC-16: Ctrl wheel zooms the board', () => {
    render(<TestBoard />);
    const viewport = screen.getByTestId('board-viewport');
    const zoomLabel = screen.getByTestId('zoom-label');

    expect(zoomLabel.textContent).toBe('100%');

    const wheelEvent = new WheelEvent('wheel', {
      deltaX: 0,
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      clientX: 300,
      clientY: 200,
    });

    act(() => {
      viewport.dispatchEvent(wheelEvent);
    });

    expect(wheelEvent.defaultPrevented).toBe(true);
    expect(zoomLabel.textContent).not.toBe('100%');
  });

  // TC-17: synthetic gesturechange scale 2: zoom doubles
  it('TC-17: gesturechange zooms the board', () => {
    render(<TestBoard />);
    const viewport = screen.getByTestId('board-viewport');
    const zoomLabel = screen.getByTestId('zoom-label');

    expect(zoomLabel.textContent).toBe('100%');

    act(() => {
      const startEvent = new Event('gesturestart', { bubbles: true, cancelable: true });
      viewport.dispatchEvent(startEvent);
    });

    act(() => {
      const changeEvent = new Event('gesturechange', { bubbles: true, cancelable: true });
      Object.defineProperty(changeEvent, 'scale', { value: 2 });
      viewport.dispatchEvent(changeEvent);
    });

    expect(zoomLabel.textContent).not.toBe('100%');
  });

  // TC-18: Ctrl+=, Ctrl+-, Ctrl+0: zoom in, zoom out, reset
  it('TC-18: keyboard shortcuts work', () => {
    render(<TestBoard />);
    const zoomLabel = screen.getByTestId('zoom-label');

    expect(zoomLabel.textContent).toBe('100%');

    act(() => {
      const keyEvent = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(keyEvent);
    });
    expect(zoomLabel.textContent).toBe('125%');

    act(() => {
      const keyEvent = new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(keyEvent);
    });
    expect(zoomLabel.textContent).toBe('100%');

    act(() => {
      const keyEvent = new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(keyEvent);
    });
    expect(zoomLabel.textContent).toBe('100%');
  });

  // TC-29: click without move: camera unchanged, hint not dismissed
  it('TC-29: click without movement does not change camera or dismiss hint', () => {
    render(<TestBoard />);
    const viewport = screen.getByTestId('board-viewport');
    const worldLayer = screen.getByTestId('world-layer');

    const beforeTransform = worldLayer.style.transform;

    act(() => {
      viewport.dispatchEvent(createPointerEvent('pointerdown', 100, 100));
    });
    act(() => {
      viewport.dispatchEvent(createPointerEvent('pointerup', 100, 100));
    });

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(worldLayer.style.transform).toBe(beforeTransform);
    expect(screen.getByTestId('navigation-hint')).toBeTruthy();
  });

  // TC-30: Ctrl wheel over zoom control: board camera unchanged
  it('TC-30: Ctrl wheel over zoom controls does not zoom the board', () => {
    render(<TestBoard />);
    const zoomControls = screen.getByTestId('zoom-controls');
    const worldLayer = screen.getByTestId('world-layer');

    const beforeTransform = worldLayer.style.transform;

    const wheelEvent = new WheelEvent('wheel', {
      deltaX: 0,
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      zoomControls.dispatchEvent(wheelEvent);
    });

    expect(worldLayer.style.transform).toBe(beforeTransform);
  });
});
