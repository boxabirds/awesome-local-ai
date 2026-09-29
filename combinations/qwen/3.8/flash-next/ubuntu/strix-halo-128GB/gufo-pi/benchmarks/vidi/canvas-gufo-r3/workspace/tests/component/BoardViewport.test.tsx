import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, fireEvent, act, cleanup } from '@testing-library/react';
import { BoardViewport } from '@client/canvas/BoardViewport';
import { ZoomControls } from '@client/canvas/ZoomControls';
import { useCamera } from '@client/canvas/useCamera';
import { canZoomIn, canZoomOut, zoomPercent } from '@client/canvas/camera';
import { ZOOM_STEP_FACTOR, ZOOM_MIN, ZOOM_MAX } from '@shared/config';

const VIEWPORT = { width: 1280, height: 800 };

// Full board: viewport + controls as siblings (mirrors App.tsx)
function TestBoard() {
  const state = useCamera(VIEWPORT);
  const { camera } = state;

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        state.zoomStep('in');
      } else if (e.key === '-') {
        e.preventDefault();
        state.zoomStep('out');
      } else if (e.key === '0') {
        e.preventDefault();
        state.reset();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.zoomStep, state.reset]);

  return (
    <div style={{ width: '1280px', height: '800px' }}>
      <BoardViewport
        camera={camera}
        beginPan={state.beginPan}
        panMove={state.panMove}
        endPan={state.endPan}
        wheel={state.wheel}
        gestureZoom={state.gestureZoom}
      />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => state.zoomStep('in')}
        onZoomOut={() => state.zoomStep('out')}
        onReset={state.reset}
      />
      <div data-testid="navigated">{state.hasNavigated ? 'yes' : 'no'}</div>
    </div>
  );
}

function dispatchWheel(el: Element, opts: { deltaX?: number; deltaY?: number; ctrlKey?: boolean; clientX?: number; clientY?: number }): boolean {
  const e = new WheelEvent('wheel', {
    deltaX: opts.deltaX ?? 0,
    deltaY: opts.deltaY ?? 0,
    ctrlKey: opts.ctrlKey ?? false,
    clientX: opts.clientX ?? 640,
    clientY: opts.clientY ?? 400,
    bubbles: true,
    cancelable: true,
  });
  act(() => { el.dispatchEvent(e); });
  return e.defaultPrevented;
}

describe('BoardViewport', () => {
  afterEach(cleanup);

  describe('TC-13: drag pans the board', () => {
    it('pointerdown/move(200,100)/up updates world layer transform', () => {
      const { getByTestId } = render(<TestBoard />);
      const viewport = getByTestId('board-viewport');
      const world = getByTestId('world-layer');

      expect(parseFloat(world.dataset.cameraX!)).toBeCloseTo(-640, 0);
      expect(parseFloat(world.dataset.cameraY!)).toBeCloseTo(-400, 0);

      fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 400, clientY: 300, button: 0 });
      fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 600, clientY: 400 });
      fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 600, clientY: 400 });

      const cx = parseFloat(world.dataset.cameraX!);
      const cy = parseFloat(world.dataset.cameraY!);
      expect(cx).toBeCloseTo(-840, 0);
      expect(cy).toBeCloseTo(-500, 0);
    });
  });

  describe('TC-14: pointercancel freezes camera', () => {
    it('camera stays at cancel position, later moves ignored', () => {
      const { getByTestId } = render(<TestBoard />);
      const viewport = getByTestId('board-viewport');
      const world = getByTestId('world-layer');

      fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 400, clientY: 300, button: 0 });
      fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 500, clientY: 350 });
      const cxAfterMove = parseFloat(world.dataset.cameraX!);
      const cyAfterMove = parseFloat(world.dataset.cameraY!);
      expect(cxAfterMove).toBeCloseTo(-740, 0);

      fireEvent.pointerCancel(viewport, { pointerId: 1 });

      fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 900, clientY: 900 });

      expect(parseFloat(world.dataset.cameraX!)).toBeCloseTo(cxAfterMove, 0);
      expect(parseFloat(world.dataset.cameraY!)).toBeCloseTo(cyAfterMove, 0);
    });
  });

  describe('TC-15: plain wheel pans', () => {
    it('wheel deltaY=+100 moves camera y by +100/zoom, defaultPrevented', () => {
      const { getByTestId } = render(<TestBoard />);
      const viewport = getByTestId('board-viewport');
      const world = getByTestId('world-layer');

      const initialY = parseFloat(world.dataset.cameraY!);

      const prevented = dispatchWheel(viewport, { deltaY: 100 });

      const newY = parseFloat(world.dataset.cameraY!);
      expect(newY).toBeCloseTo(initialY + 100, 0);
      expect(prevented).toBe(true);
    });
  });

  describe('TC-16: Ctrl wheel zooms', () => {
    it('wheel ctrlKey deltaY=-100 increases zoom, defaultPrevented', () => {
      const { getByTestId } = render(<TestBoard />);
      const viewport = getByTestId('board-viewport');
      const world = getByTestId('world-layer');

      const initialZoom = parseFloat(world.dataset.cameraZoom!);

      const prevented = dispatchWheel(viewport, { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 200 });

      const newZoom = parseFloat(world.dataset.cameraZoom!);
      expect(newZoom).toBeGreaterThan(initialZoom);
      expect(prevented).toBe(true);
    });
  });

  describe('TC-17: gesturechange zooms', () => {
    it('gesturechange scale=2 doubles zoom (clamped), defaultPrevented', () => {
      const { getByTestId } = render(<TestBoard />);
      const viewport = getByTestId('board-viewport');
      const world = getByTestId('world-layer');

      const initialZoom = parseFloat(world.dataset.cameraZoom!);

      act(() => {
        const gestureEvent = new Event('gesturechange', { bubbles: true, cancelable: true }) as any;
        gestureEvent.scale = 2;
        gestureEvent.clientX = 640;
        gestureEvent.clientY = 400;
        viewport.dispatchEvent(gestureEvent);
      });

      const newZoom = parseFloat(world.dataset.cameraZoom!);
      expect(newZoom).toBeCloseTo(initialZoom * 2, 6);
    });
  });

  describe('TC-18: keyboard shortcuts', () => {
    it('Ctrl+= zooms in, Ctrl+- zooms out, Ctrl+0 resets', () => {
      const { getByTestId } = render(<TestBoard />);
      const world = getByTestId('world-layer');

      // Zoom in
      const eqEvent = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true });
      act(() => { window.dispatchEvent(eqEvent); });
      expect(eqEvent.defaultPrevented).toBe(true);
      expect(parseFloat(world.dataset.cameraZoom!)).toBeCloseTo(ZOOM_STEP_FACTOR, 4);

      // Zoom out
      const minusEvent = new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true, cancelable: true });
      act(() => { window.dispatchEvent(minusEvent); });
      expect(minusEvent.defaultPrevented).toBe(true);
      expect(parseFloat(world.dataset.cameraZoom!)).toBeCloseTo(1, 4);

      // Reset
      const zeroEvent = new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true, cancelable: true });
      act(() => { window.dispatchEvent(zeroEvent); });
      expect(zeroEvent.defaultPrevented).toBe(true);
      expect(parseFloat(world.dataset.cameraZoom!)).toBe(1);
      expect(parseFloat(world.dataset.cameraX!)).toBeCloseTo(-640, 0);
    });
  });

  describe('TC-29: click without move', () => {
    it('camera unchanged and hint not dismissed', () => {
      const { getByTestId } = render(<TestBoard />);
      const viewport = getByTestId('board-viewport');
      const world = getByTestId('world-layer');
      const navigated = getByTestId('navigated');

      const initialX = world.dataset.cameraX;
      const initialY = world.dataset.cameraY;

      fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 400, clientY: 300, button: 0 });
      fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 400, clientY: 300 });

      expect(world.dataset.cameraX).toBe(initialX);
      expect(world.dataset.cameraY).toBe(initialY);
      expect(navigated.textContent).toBe('no');
    });
  });

  describe('TC-30: Ctrl wheel over zoom control does not zoom board', () => {
    it('board camera unchanged; browser default not suppressed over controls', () => {
      const { getByTestId } = render(<TestBoard />);
      const world = getByTestId('world-layer');
      const zoomControls = getByTestId('zoom-controls');

      const initialZoom = parseFloat(world.dataset.cameraZoom!);

      const prevented = dispatchWheel(zoomControls, { deltaY: -100, ctrlKey: true });

      expect(parseFloat(world.dataset.cameraZoom!)).toBe(initialZoom);
      // Controls are outside the board: browser default is not suppressed there (TC-30)
      expect(prevented).toBe(false);
    });
  });
});
