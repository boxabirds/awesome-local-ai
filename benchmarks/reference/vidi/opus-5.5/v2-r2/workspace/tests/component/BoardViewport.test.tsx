import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { resetCamera } from '../../src/client/canvas/camera';
import { NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import { GRID_SPACING_WORLD, WHEEL_ZOOM_SENSITIVITY, ZOOM_MAX, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import { currentCamera, flushFrame, pointer, renderApp, renderedCamera } from './helpers';

const JSDOM_VIEWPORT = { width: window.innerWidth, height: window.innerHeight };

describe('viewport.input', () => {
  it('starts centred on the origin at 100% with the dot grid attached to the board', () => {
    const { world, viewport } = renderApp();
    expect(renderedCamera(world())).toEqual(resetCamera(JSDOM_VIEWPORT));
    expect(viewport().style.backgroundSize).toBe(`${GRID_SPACING_WORLD}px ${GRID_SPACING_WORLD}px`);
    expect(world().style.transformOrigin).toBe('0 0');
    expect(screen.getByTestId('origin-marker')).toBeTruthy();
  });

  it('TC-13 drag pans by exactly the pointer movement; Idle → Panning → Idle', () => {
    const { world, viewport } = renderApp();
    const start = currentCamera();
    expect(viewport().dataset.state).toBe('idle');
    pointer(viewport(), 'down', 400, 300);
    flushFrame();
    expect(viewport().dataset.state).toBe('panning');
    expect(viewport().className).toContain('is-panning');
    pointer(viewport(), 'move', 500, 350);
    pointer(viewport(), 'move', 600, 400);
    flushFrame();
    pointer(viewport(), 'up', 600, 400);
    flushFrame();
    expect(viewport().dataset.state).toBe('idle');
    const cam = renderedCamera(world());
    expect(cam).toEqual({ x: start.x - 200, y: start.y - 100, zoom: 1 });
    expect(cam).toEqual(currentCamera());
  });

  it('TC-14 pointercancel ends the drag and keeps the camera from the moment of cancel', () => {
    const { world, viewport } = renderApp();
    const start = currentCamera();
    pointer(viewport(), 'down', 100, 100);
    pointer(viewport(), 'move', 150, 120);
    pointer(viewport(), 'cancel', 150, 120);
    flushFrame();
    const atCancel = { x: start.x - 50, y: start.y - 20, zoom: 1 };
    expect(renderedCamera(world())).toEqual(atCancel);
    expect(viewport().dataset.state).toBe('idle');
    pointer(viewport(), 'move', 400, 400);
    flushFrame();
    expect(renderedCamera(world())).toEqual(atCancel);
  });

  it('lostpointercapture also ends the drag', () => {
    const { world, viewport } = renderApp();
    pointer(viewport(), 'down', 100, 100);
    fireEvent.lostPointerCapture(viewport(), { pointerId: 1 });
    pointer(viewport(), 'move', 300, 300);
    flushFrame();
    expect(renderedCamera(world())).toEqual(resetCamera(JSDOM_VIEWPORT));
  });

  it('TC-15 plain wheel pans in the scroll direction and prevents page scroll', () => {
    const { world, viewport } = renderApp();
    const start = currentCamera();
    const notPrevented = fireEvent.wheel(viewport(), { deltaY: 100, clientX: 10, clientY: 10 });
    expect(notPrevented).toBe(false);
    flushFrame();
    expect(renderedCamera(world()).y).toBe(start.y + 100 / start.zoom);
    fireEvent.wheel(viewport(), { deltaX: 40, clientX: 10, clientY: 10 });
    flushFrame();
    expect(renderedCamera(world()).x).toBe(start.x + 40 / start.zoom);
  });

  it('converts line-mode wheel deltas to pixels', () => {
    const { world, viewport } = renderApp();
    const start = currentCamera();
    fireEvent.wheel(viewport(), { deltaY: 3, deltaMode: 1 });
    flushFrame();
    expect(renderedCamera(world()).y).toBeGreaterThan(start.y + 3);
  });

  it('TC-16 Ctrl wheel zooms in around the pointer and prevents page zoom', () => {
    const { world, viewport } = renderApp();
    const start = currentCamera();
    const p = { x: 300, y: 200 };
    const worldBefore = { x: p.x / start.zoom + start.x, y: p.y / start.zoom + start.y };
    const notPrevented = fireEvent.wheel(viewport(), { deltaY: -100, ctrlKey: true, clientX: p.x, clientY: p.y });
    expect(notPrevented).toBe(false);
    flushFrame();
    const cam = renderedCamera(world());
    expect(cam.zoom).toBeCloseTo(Math.exp(100 * WHEEL_ZOOM_SENSITIVITY), 9);
    expect(p.x / cam.zoom + cam.x).toBeCloseTo(worldBefore.x, 6);
    expect(p.y / cam.zoom + cam.y).toBeCloseTo(worldBefore.y, 6);
  });

  it('Cmd (meta) wheel also zooms', () => {
    const { world, viewport } = renderApp();
    fireEvent.wheel(viewport(), { deltaY: 100, metaKey: true, clientX: 50, clientY: 50 });
    flushFrame();
    expect(renderedCamera(world()).zoom).toBeLessThan(1);
  });

  it('TC-17 Safari gesturechange zooms by the scale ratio and is prevented', () => {
    const { world, viewport } = renderApp();
    const gesture = (type: string, scale: number) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(e, { scale, clientX: 300, clientY: 200 });
      viewport().dispatchEvent(e);
      return e;
    };
    expect(gesture('gesturestart', 1).defaultPrevented).toBe(true);
    const change = gesture('gesturechange', 2);
    expect(change.defaultPrevented).toBe(true);
    flushFrame();
    expect(renderedCamera(world()).zoom).toBe(2);
    gesture('gesturechange', 8); // ratio 4 → clamped
    flushFrame();
    expect(renderedCamera(world()).zoom).toBe(ZOOM_MAX);
  });

  it('TC-18 Ctrl + = / - / 0 step zoom and reset, each prevented', () => {
    const { world, viewport } = renderApp();
    // Pan away first so reset has something to undo.
    fireEvent.wheel(viewport(), { deltaX: 500, deltaY: 300 });
    flushFrame();
    expect(fireEvent.keyDown(window, { key: '=', code: 'Equal', ctrlKey: true })).toBe(false);
    flushFrame();
    expect(renderedCamera(world()).zoom).toBe(ZOOM_STEP_FACTOR);
    expect(fireEvent.keyDown(window, { key: '-', code: 'Minus', ctrlKey: true })).toBe(false);
    flushFrame();
    expect(renderedCamera(world()).zoom).toBe(1);
    expect(fireEvent.keyDown(window, { key: '0', code: 'Digit0', metaKey: true })).toBe(false);
    flushFrame();
    expect(renderedCamera(world())).toEqual(resetCamera(JSDOM_VIEWPORT));
  });

  it('ignores the shortcut keys without Ctrl/Cmd', () => {
    renderApp();
    expect(fireEvent.keyDown(window, { key: '=', code: 'Equal' })).toBe(true);
  });

  it('TC-29 a click without moving leaves the camera unchanged and keeps the hint', () => {
    const { world, viewport } = renderApp();
    const before = renderedCamera(world());
    pointer(viewport(), 'down', 200, 200);
    pointer(viewport(), 'up', 200, 200);
    flushFrame();
    expect(renderedCamera(world())).toEqual(before);
    expect(screen.getByText(NAVIGATION_HINT_TEXT)).toBeTruthy();
  });

  it('TC-30 Ctrl wheel over the zoom control does not zoom the board or suppress the browser default', () => {
    const { world } = renderApp();
    const before = renderedCamera(world());
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    const notPrevented = fireEvent.wheel(zoomIn, { deltaY: -100, ctrlKey: true });
    expect(notPrevented).toBe(true);
    flushFrame();
    expect(renderedCamera(world())).toEqual(before);
  });

  it('a pointerdown on content inside the world layer does not start a pan', () => {
    const { viewport } = renderApp();
    const marker = screen.getByTestId('origin-marker');
    pointer(marker, 'down', 10, 10);
    flushFrame();
    expect(viewport().dataset.state).toBe('idle');
  });
});
