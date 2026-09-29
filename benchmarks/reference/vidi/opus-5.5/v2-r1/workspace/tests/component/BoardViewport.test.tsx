import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import { WHEEL_ZOOM_SENSITIVITY, ZOOM_MAX, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import {
  cameraFromDom,
  dispatchKey,
  dispatchWheel,
  initialCamera,
  nextFrame,
  renderBoard,
  useFakeFrames,
} from './helpers';

beforeEach(() => useFakeFrames());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('viewport.input', () => {
  it('starts at 100% with the origin centred', () => {
    renderBoard();
    expect(cameraFromDom()).toEqual(initialCamera());
  });

  it('TC-13 drag moves the world layer by the pointer delta; Idle → Panning → Idle', () => {
    const { viewport } = renderBoard();
    const start = initialCamera();
    expect(viewport.dataset.state).toBe('idle');
    fireEvent.pointerDown(viewport, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    expect(viewport.dataset.state).toBe('panning');
    expect(viewport.className).toContain('is-panning');
    fireEvent.pointerMove(viewport, { clientX: 300, clientY: 200, pointerId: 1 });
    nextFrame();
    fireEvent.pointerUp(viewport, { clientX: 300, clientY: 200, pointerId: 1 });
    expect(viewport.dataset.state).toBe('idle');
    const cam = cameraFromDom();
    expect(cam).toEqual({ x: start.x - 200, y: start.y - 100, zoom: 1 });
    expect(screen.getByTestId('world-layer').style.transform).toBe(
      `scale(1) translate(${-cam.x}px, ${-cam.y}px)`,
    );
  });

  it('several moves within one frame compose into one render', () => {
    const { viewport } = renderBoard();
    const start = initialCamera();
    fireEvent.pointerDown(viewport, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    fireEvent.pointerMove(viewport, { clientX: 50, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(viewport, { clientX: 200, clientY: 100, pointerId: 1 });
    expect(cameraFromDom()).toEqual(start);
    nextFrame();
    expect(cameraFromDom()).toEqual({ x: start.x - 200, y: start.y - 100, zoom: 1 });
  });

  it('TC-14 pointercancel ends the drag and later moves are ignored', () => {
    const { viewport } = renderBoard();
    const start = initialCamera();
    fireEvent.pointerDown(viewport, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    fireEvent.pointerMove(viewport, { clientX: 40, clientY: 30, pointerId: 1 });
    fireEvent.pointerCancel(viewport, { pointerId: 1 });
    expect(viewport.dataset.state).toBe('idle');
    fireEvent.pointerMove(viewport, { clientX: 400, clientY: 300, pointerId: 1 });
    nextFrame();
    expect(cameraFromDom()).toEqual({ x: start.x - 40, y: start.y - 30, zoom: 1 });
  });

  it('lostpointercapture ends the drag', () => {
    const { viewport } = renderBoard();
    fireEvent.pointerDown(viewport, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    fireEvent.lostPointerCapture(viewport, { pointerId: 1 });
    expect(viewport.dataset.state).toBe('idle');
  });

  it('TC-15 plain wheel pans by the scroll delta and prevents the default', () => {
    const { viewport } = renderBoard();
    const start = initialCamera();
    const event = dispatchWheel(viewport, { deltaY: 100 });
    nextFrame();
    expect(event.defaultPrevented).toBe(true);
    const cam = cameraFromDom();
    expect(cam.y).toBe(start.y + 100 / start.zoom);
    expect(cam.x).toBe(start.x);
  });

  it('plain horizontal wheel pans horizontally; line deltas are converted to pixels', () => {
    const { viewport } = renderBoard();
    const start = initialCamera();
    dispatchWheel(viewport, { deltaX: 3, deltaMode: WheelEvent.DOM_DELTA_LINE });
    nextFrame();
    expect(cameraFromDom().x).toBeGreaterThan(start.x + 3);
  });

  it('TC-16 Ctrl wheel zooms in around the pointer and prevents the default', () => {
    const { viewport } = renderBoard();
    const event = dispatchWheel(viewport, {
      deltaY: -100,
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });
    nextFrame();
    expect(event.defaultPrevented).toBe(true);
    const cam = cameraFromDom();
    expect(cam.zoom).toBeCloseTo(Math.exp(100 * WHEEL_ZOOM_SENSITIVITY), 10);
    const start = initialCamera();
    // World point under (300,200) is unchanged.
    expect(300 / cam.zoom + cam.x).toBeCloseTo(300 + start.x, 6);
    expect(200 / cam.zoom + cam.y).toBeCloseTo(200 + start.y, 6);
  });

  it('Meta (Cmd) wheel also zooms', () => {
    const { viewport } = renderBoard();
    dispatchWheel(viewport, { deltaY: 100, metaKey: true });
    nextFrame();
    expect(cameraFromDom().zoom).toBeLessThan(1);
  });

  it('TC-17 Safari gesturechange zooms by the scale ratio and prevents the default', () => {
    const { viewport } = renderBoard();
    const start = new Event('gesturestart', { bubbles: true, cancelable: true });
    act(() => {
      viewport.dispatchEvent(start);
    });
    const change = Object.assign(new Event('gesturechange', { bubbles: true, cancelable: true }), {
      scale: 2,
      clientX: 100,
      clientY: 100,
    });
    act(() => {
      viewport.dispatchEvent(change);
    });
    nextFrame();
    expect(start.defaultPrevented).toBe(true);
    expect(change.defaultPrevented).toBe(true);
    expect(cameraFromDom().zoom).toBe(Math.min(2, ZOOM_MAX));
    // Cumulative scale 4 → ratio 2 relative to the previous event.
    const change2 = Object.assign(new Event('gesturechange', { bubbles: true, cancelable: true }), {
      scale: 4,
      clientX: 100,
      clientY: 100,
    });
    act(() => {
      viewport.dispatchEvent(change2);
    });
    nextFrame();
    expect(cameraFromDom().zoom).toBe(Math.min(4, ZOOM_MAX));
  });

  it('TC-18 Ctrl+= , Ctrl+- , Ctrl+0 step, step back and reset, preventing the default', () => {
    const { viewport } = renderBoard();
    const start = initialCamera();
    fireEvent.pointerDown(viewport, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    fireEvent.pointerMove(viewport, { clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(viewport, { pointerId: 1 });
    nextFrame();

    const plus = dispatchKey({ key: '=', ctrlKey: true });
    nextFrame();
    expect(plus.defaultPrevented).toBe(true);
    expect(cameraFromDom().zoom).toBe(ZOOM_STEP_FACTOR);

    const minus = dispatchKey({ key: '-', ctrlKey: true });
    nextFrame();
    expect(minus.defaultPrevented).toBe(true);
    expect(cameraFromDom().zoom).toBe(1);

    const zero = dispatchKey({ key: '0', metaKey: true });
    nextFrame();
    expect(zero.defaultPrevented).toBe(true);
    expect(cameraFromDom()).toEqual(start);
  });

  it('keys without Ctrl/Cmd are left alone', () => {
    renderBoard();
    const event = dispatchKey({ key: '=' });
    nextFrame();
    expect(event.defaultPrevented).toBe(false);
    expect(cameraFromDom()).toEqual(initialCamera());
  });

  it('TC-29 click without moving leaves the camera unchanged and keeps the hint', () => {
    const { viewport } = renderBoard();
    fireEvent.pointerDown(viewport, { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
    fireEvent.pointerUp(viewport, { clientX: 10, clientY: 10, pointerId: 1 });
    nextFrame();
    expect(cameraFromDom()).toEqual(initialCamera());
    expect(screen.getByText(NAVIGATION_HINT_TEXT)).toBeTruthy();
  });

  it('TC-30 Ctrl wheel over the zoom control does not zoom the board or suppress the default', () => {
    renderBoard();
    const group = screen.getByRole('group', { name: 'Zoom' });
    const event = dispatchWheel(group, { deltaY: -100, ctrlKey: true });
    nextFrame();
    expect(event.defaultPrevented).toBe(false);
    expect(cameraFromDom()).toEqual(initialCamera());
  });

  it('pointerdown on a child element does not start a pan', () => {
    const { viewport } = renderBoard();
    const marker = screen.getByTestId('origin-marker');
    fireEvent.pointerDown(marker, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    expect(viewport.dataset.state).toBe('idle');
  });

  it('dot grid spacing and offset follow the camera', () => {
    const { viewport } = renderBoard();
    expect(viewport.style.backgroundSize).toBe('24px 24px');
    dispatchKey({ key: '=', ctrlKey: true });
    nextFrame();
    expect(viewport.style.backgroundSize).toBe(`${24 * ZOOM_STEP_FACTOR}px ${24 * ZOOM_STEP_FACTOR}px`);
  });
});
