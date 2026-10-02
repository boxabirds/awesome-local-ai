import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TestApp } from './TestApp';
import { ZOOM_STEP_FACTOR, ZOOM_MAX } from '../../src/shared/config';

function flushRaf() {
  act(() => {
    vi.advanceTimersByTime(16);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function getCamera(): { x: number; y: number; zoom: number } {
  return (window as any).__testCamera;
}

describe('BoardViewport', () => {
  describe('TC-13: pointer drag moves board', () => {
    it('pointerdown/move(200,100)/up changes world layer transform', () => {
      render(<TestApp />);
      flushRaf();

      const viewport = screen.getByTestId('board-viewport');
      const worldLayer = screen.getByTestId('world-layer');

      // Start pan
      fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 100, clientY: 100 });
      flushRaf();

      // Move by 200, 100
      fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 300, clientY: 200 });
      flushRaf();

      // End pan
      fireEvent.pointerUp(viewport, { pointerId: 1 });
      flushRaf();

      const cam = getCamera();
      // After moving 200,100 at zoom=1, camera should be at -200, -100
      expect(cam.x).toBeCloseTo(-200, 1);
      expect(cam.y).toBeCloseTo(-100, 1);

      // World layer transform should reflect camera
      const transform = worldLayer.style.transform;
      expect(transform).toContain('scale(1)');
      expect(transform).toContain('translate(200px, 100px)');
    });
  });

  describe('TC-14: pointercancel ends drag, later moves ignored', () => {
    it('camera frozen at cancel point, later moves ignored', () => {
      render(<TestApp />);
      flushRaf();

      const viewport = screen.getByTestId('board-viewport');

      fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 100, clientY: 100 });
      flushRaf();
      fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 200, clientY: 150 });
      flushRaf();

      const camAtCancel = { ...getCamera() };

      fireEvent.pointerCancel(viewport, { pointerId: 1 });
      flushRaf();

      // Further moves should not change camera
      fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 500, clientY: 500 });
      flushRaf();

      const camAfter = getCamera();
      expect(camAfter.x).toBeCloseTo(camAtCancel.x, 6);
      expect(camAfter.y).toBeCloseTo(camAtCancel.y, 6);
    });
  });

  describe('TC-15: plain wheel pans board', () => {
    it('wheel deltaY=+100 pans camera', () => {
      render(<TestApp />);
      flushRaf();

      const viewport = screen.getByTestId('board-viewport');

      // Need to dispatch a real wheel event since we use addEventListener with passive:false
      const wheelEvent = new WheelEvent('wheel', {
        deltaY: 100,
        deltaX: 0,
        bubbles: true,
        cancelable: true,
      });

      // Mock getBoundingClientRect
      viewport.getBoundingClientRect = vi.fn().mockReturnValue({
        left: 0, top: 0, right: 1280, bottom: 800, width: 1280, height: 800,
      });

      viewport.dispatchEvent(wheelEvent);
      flushRaf();

      const cam = getCamera();
      // Pan by (-0, -100) so camera.y increases by 100/zoom=100
      // Wait - panBy takes screenDx, screenDy. In wheel we call panBy(base, -deltaX, -deltaY)
      // So panBy(base, 0, -100) => camera.y = 0 - (-100)/1 = 100
      expect(cam.y).toBeCloseTo(100, 1);
      expect(wheelEvent.defaultPrevented).toBe(true);
    });
  });

  describe('TC-16: Ctrl+wheel zooms', () => {
    it('ctrl wheel deltaY=-100 increases zoom', () => {
      render(<TestApp />);
      flushRaf();

      const viewport = screen.getByTestId('board-viewport');
      viewport.getBoundingClientRect = vi.fn().mockReturnValue({
        left: 0, top: 0, right: 1280, bottom: 800, width: 1280, height: 800,
      });

      const wheelEvent = new WheelEvent('wheel', {
        deltaY: -100,
        deltaX: 0,
        ctrlKey: true,
        clientX: 300,
        clientY: 200,
        bubbles: true,
        cancelable: true,
      });

      viewport.dispatchEvent(wheelEvent);
      flushRaf();

      const cam = getCamera();
      expect(cam.zoom).toBeGreaterThan(1);
      expect(wheelEvent.defaultPrevented).toBe(true);
    });
  });

  describe('TC-17: Safari gesturechange doubles zoom', () => {
    it('gesturechange scale 2 doubles zoom', () => {
      render(<TestApp />);
      flushRaf();

      const viewport = screen.getByTestId('board-viewport');
      viewport.getBoundingClientRect = vi.fn().mockReturnValue({
        left: 0, top: 0, right: 1280, bottom: 800, width: 1280, height: 800,
      });

      const gestureEvent = new Event('gesturechange', { bubbles: true, cancelable: true });
      (gestureEvent as any).scale = 2;
      (gestureEvent as any).clientX = 640;
      (gestureEvent as any).clientY = 400;

      viewport.dispatchEvent(gestureEvent);
      flushRaf();

      const cam = getCamera();
      expect(cam.zoom).toBeCloseTo(2, 1);
      expect(gestureEvent.defaultPrevented).toBe(true);
    });
  });

  describe('TC-18: keyboard shortcuts', () => {
    it('Ctrl+= zooms in, Ctrl+- zooms out, Ctrl+0 resets', () => {
      render(<TestApp />);
      flushRaf();

      // Ctrl+=
      const kd1 = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(kd1);
      flushRaf();

      let cam = getCamera();
      expect(cam.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 4);
      expect(kd1.defaultPrevented).toBe(true);

      // Ctrl+-
      const kd2 = new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(kd2);
      flushRaf();

      cam = getCamera();
      expect(cam.zoom).toBeCloseTo(1, 10);
      expect(kd2.defaultPrevented).toBe(true);

      // Zoom in first to make reset visible
      const kd3 = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(kd3);
      flushRaf();

      // Ctrl+0
      const kd4 = new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(kd4);
      flushRaf();

      cam = getCamera();
      expect(cam.zoom).toBe(1);
      expect(kd4.defaultPrevented).toBe(true);
    });
  });

  describe('TC-29: click without move does not change camera or dismiss hint', () => {
    it('camera unchanged, hint still visible', () => {
      render(<TestApp />);
      flushRaf();

      const viewport = screen.getByTestId('board-viewport');
      const hint = screen.getByTestId('navigation-hint');
      expect(hint).toBeInTheDocument();

      const camBefore = { ...getCamera() };

      // Pointer down and up at same location (no move)
      fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 500, clientY: 500 });
      flushRaf();
      fireEvent.pointerUp(viewport, { pointerId: 1 });
      flushRaf();

      const camAfter = getCamera();
      expect(camAfter.x).toBe(camBefore.x);
      expect(camAfter.y).toBe(camBefore.y);
      expect(camAfter.zoom).toBe(camBefore.zoom);

      // Hint should still be visible
      expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();
    });
  });

  describe('TC-30: Ctrl+wheel over zoom controls does not zoom board', () => {
    it('board camera unchanged when wheeling over zoom controls', () => {
      render(<TestApp />);
      flushRaf();

      const zoomControls = screen.getByTestId('zoom-controls');
      const camBefore = { ...getCamera() };

      // Wheel event over zoom controls should not propagate to board
      const wheelEvent = new WheelEvent('wheel', {
        deltaY: -100,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });

      zoomControls.dispatchEvent(wheelEvent);
      flushRaf();

      const camAfter = getCamera();
      expect(camAfter.x).toBe(camBefore.x);
      expect(camAfter.y).toBe(camBefore.y);
      expect(camAfter.zoom).toBe(camBefore.zoom);
    });
  });
});
