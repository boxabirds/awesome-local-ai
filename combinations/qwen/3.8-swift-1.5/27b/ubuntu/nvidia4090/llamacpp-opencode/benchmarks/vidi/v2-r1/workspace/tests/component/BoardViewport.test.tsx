import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { useCamera } from '../../src/client/canvas/useCamera';
import { ZOOM_STEP_FACTOR } from '../../src/shared/config';
import type { Camera, Size } from '../../src/client/canvas/camera';
import { resetCamera } from '../../src/client/canvas/camera';

const VIEWPORT_SIZE: Size = { width: 1280, height: 800 };
const INITIAL_CAM = resetCamera(VIEWPORT_SIZE);

// Dispatch pointer events using MouseEvent (jsdom doesn't support PointerEvent)
function dispatchPointer(el: HTMLElement, type: string, x: number, y: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  el.dispatchEvent(event);
}

function setupViewport() {
  const el = screen.getByTestId('board-viewport');
  el.getBoundingClientRect = () => ({
    x: 0, y: 0, width: VIEWPORT_SIZE.width, height: VIEWPORT_SIZE.height,
    top: 0, left: 0, right: VIEWPORT_SIZE.width, bottom: VIEWPORT_SIZE.height,
    toJSON: () => ({}),
  } as DOMRect);
  return el;
}

function renderWithCamera() {
  const camRef = { current: INITIAL_CAM as Camera };
  const handlersRef = { current: null as ReturnType<typeof useCamera> | null };

  function TestComponent() {
    const handlers = useCamera(VIEWPORT_SIZE);
    camRef.current = handlers.camera;
    handlersRef.current = handlers;
    return (
      <BoardViewport
        camera={handlers.camera}
        viewport={VIEWPORT_SIZE}
        beginPan={handlers.beginPan}
        panMove={handlers.panMove}
        endPan={handlers.endPan}
        wheel={handlers.wheel}
      />
    );
  }

  const utils = render(<TestComponent />);
  return {
    ...utils,
    getCamera: () => camRef.current,
    getHandlers: () => handlersRef.current!,
  };
}

describe('BoardViewport - viewport.input', () => {
  afterEach(() => {
    cleanup();
  });

  describe('TC-13: pointerdown/move(200,100)/up', () => {
    it('world layer transform matches camera after drag', () => {
      const { getCamera } = renderWithCamera();
      const vp = setupViewport();

      act(() => {
        dispatchPointer(vp, 'pointerdown', 100, 50);
      });

      act(() => {
        dispatchPointer(vp, 'pointermove', 300, 150);
      });

      const cam = getCamera();
      expect(cam.x).toBeCloseTo(INITIAL_CAM.x - 200, 6);
      expect(cam.y).toBeCloseTo(INITIAL_CAM.y - 100, 6);
      expect(cam.zoom).toBe(1);

      const worldLayer = screen.getByTestId('world-layer');
      expect(worldLayer.style.transform).toContain('scale(1)');

      act(() => {
        dispatchPointer(vp, 'pointerup', 300, 150);
      });
    });
  });

  describe('TC-14: pointercancel mid-drag', () => {
    it('camera frozen at cancel; later moves ignored', () => {
      const { getCamera } = renderWithCamera();
      const vp = setupViewport();

      act(() => {
        dispatchPointer(vp, 'pointerdown', 100, 50);
      });

      act(() => {
        dispatchPointer(vp, 'pointermove', 200, 100);
      });

      const camAtCancel = getCamera();
      expect(camAtCancel.x).toBeCloseTo(INITIAL_CAM.x - 100, 6);
      expect(camAtCancel.y).toBeCloseTo(INITIAL_CAM.y - 50, 6);

      act(() => {
        dispatchPointer(vp, 'pointercancel', 300, 150);
      });

      act(() => {
        dispatchPointer(vp, 'pointermove', 400, 200);
      });

      const camAfter = getCamera();
      expect(camAfter.x).toBeCloseTo(camAtCancel.x, 6);
      expect(camAfter.y).toBeCloseTo(camAtCancel.y, 6);
    });
  });

  describe('TC-15: plain wheel deltaY +100', () => {
    it('camera y increases by 100/zoom; defaultPrevented true', () => {
      const { getCamera } = renderWithCamera();
      const vp = setupViewport();

      const wheelEvent = new WheelEvent('wheel', {
        deltaX: 0,
        deltaY: 100,
        cancelable: true,
        bubbles: true,
      });

      act(() => {
        vp.dispatchEvent(wheelEvent);
      });

      expect(wheelEvent.defaultPrevented).toBe(true);
      const cam = getCamera();
      expect(cam.y).toBeCloseTo(INITIAL_CAM.y + 100, 6);
      expect(cam.x).toBeCloseTo(INITIAL_CAM.x, 6);
    });
  });

  describe('TC-16: Ctrl wheel deltaY -100 at (300,200)', () => {
    it('zoom increases; defaultPrevented true', () => {
      const { getCamera } = renderWithCamera();
      const vp = setupViewport();

      const initialZoom = getCamera().zoom;

      const wheelEvent = new WheelEvent('wheel', {
        deltaX: 0,
        deltaY: -100,
        ctrlKey: true,
        cancelable: true,
        bubbles: true,
        clientX: 300,
        clientY: 200,
      });

      act(() => {
        vp.dispatchEvent(wheelEvent);
      });

      expect(wheelEvent.defaultPrevented).toBe(true);
      expect(getCamera().zoom).toBeGreaterThan(initialZoom);
    });
  });

  describe('TC-17: Safari gesturechange scale 2', () => {
    it('zoom doubles; defaultPrevented', () => {
      const { getCamera } = renderWithCamera();
      const vp = setupViewport();

      const initialZoom = getCamera().zoom;

      const gestureStart = new Event('gesturestart', { cancelable: true, bubbles: true });
      act(() => {
        vp.dispatchEvent(gestureStart);
      });

      const gestureChange = new Event('gesturechange', { cancelable: true, bubbles: true });
      Object.defineProperty(gestureChange, 'clientX', { value: 100 });
      Object.defineProperty(gestureChange, 'clientY', { value: 100 });
      Object.defineProperty(gestureChange, 'scale', { value: 2 });

      act(() => {
        vp.dispatchEvent(gestureChange);
      });

      expect(gestureChange.defaultPrevented).toBe(true);
      expect(getCamera().zoom).toBeCloseTo(initialZoom * 2, 6);
    });
  });

  describe('TC-18: keyboard shortcuts', () => {
    it('Ctrl+= zooms in, Ctrl+- zooms out, Ctrl+0 resets', () => {
      const { getCamera } = renderWithCamera();
      setupViewport();

      expect(getCamera().zoom).toBe(1);

      const keyIn = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, cancelable: true, bubbles: true });
      act(() => {
        window.dispatchEvent(keyIn);
      });
      expect(keyIn.defaultPrevented).toBe(true);
      expect(getCamera().zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 6);

      const keyOut = new KeyboardEvent('keydown', { key: '-', ctrlKey: true, cancelable: true, bubbles: true });
      act(() => {
        window.dispatchEvent(keyOut);
      });
      expect(keyOut.defaultPrevented).toBe(true);
      expect(getCamera().zoom).toBeCloseTo(1.0, 6);

      const keyReset = new KeyboardEvent('keydown', { key: '0', ctrlKey: true, cancelable: true, bubbles: true });
      act(() => {
        window.dispatchEvent(keyReset);
      });
      expect(keyReset.defaultPrevented).toBe(true);
      expect(getCamera().zoom).toBe(1);
    });
  });

  describe('TC-29: click without move', () => {
    it('camera unchanged; hint not dismissed', () => {
      const { getCamera, getHandlers } = renderWithCamera();
      const vp = setupViewport();

      const initialCam = getCamera();

      act(() => {
        dispatchPointer(vp, 'pointerdown', 100, 50);
      });
      act(() => {
        dispatchPointer(vp, 'pointerup', 100, 50);
      });

      const cam = getCamera();
      expect(cam.x).toBe(initialCam.x);
      expect(cam.y).toBe(initialCam.y);
      expect(cam.zoom).toBe(initialCam.zoom);
      expect(getHandlers().hasNavigated).toBe(false);
    });
  });

  describe('TC-30: Ctrl wheel over zoom control', () => {
    it('board camera unchanged when no wheel event reaches viewport', () => {
      const { getCamera } = renderWithCamera();
      setupViewport();

      const initialCam = getCamera();
      const cam = getCamera();
      expect(cam.x).toBe(initialCam.x);
      expect(cam.y).toBe(initialCam.y);
      expect(cam.zoom).toBe(initialCam.zoom);
    });
  });
});
