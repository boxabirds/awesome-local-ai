import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCamera, zoomAt } from '../../src/client/canvas/camera';
import {
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import { NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import { flushFrame, readCamera, renderApp, useFakeFrames } from './helpers';

function initialCamera() {
  return resetCamera({ width: window.innerWidth, height: window.innerHeight });
}

function wheel(target: Element, init: WheelEventInit) {
  const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(ev);
  });
  return ev;
}

function key(init: KeyboardEventInit) {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    window.dispatchEvent(ev);
  });
  return ev;
}

describe('BoardViewport (viewport.input)', () => {
  beforeEach(() => useFakeFrames());
  afterEach(() => vi.useRealTimers());

  it('TC-13 drag pans the world layer by the pointer delta; Idle→Panning→Idle', () => {
    const { viewport } = renderApp();
    const start = initialCamera();
    expect(viewport.dataset.state).toBe('idle');

    fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    expect(viewport.dataset.state).toBe('panning');
    expect(viewport.className).toContain('is-panning');
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 300, clientY: 200 });
    flushFrame();
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 300, clientY: 200 });
    expect(viewport.dataset.state).toBe('idle');

    const cam = readCamera(viewport);
    expect(cam).toEqual({ x: start.x - 200, y: start.y - 100, zoom: 1 });
    const world = screen.getByTestId('board-world');
    expect(world.style.transform).toBe(`scale(1) translate(${-cam.x}px, ${-cam.y}px)`);
  });

  it('TC-14 pointercancel mid-drag freezes the camera; later moves are ignored', () => {
    const { viewport } = renderApp();
    const start = initialCamera();
    fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 150, clientY: 130 });
    fireEvent.pointerCancel(viewport, { pointerId: 1 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 400, clientY: 400 });
    flushFrame();
    expect(viewport.dataset.state).toBe('idle');
    expect(readCamera(viewport)).toEqual({ x: start.x - 50, y: start.y - 30, zoom: 1 });
  });

  it('lostpointercapture ends the drag', () => {
    const { viewport } = renderApp();
    fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
    fireEvent.lostPointerCapture(viewport, { pointerId: 1 });
    expect(viewport.dataset.state).toBe('idle');
  });

  it('pointerdown on a child element does not start a pan', () => {
    const { viewport } = renderApp();
    fireEvent.pointerDown(screen.getByTestId('board-world'), { pointerId: 1, button: 0 });
    expect(viewport.dataset.state).toBe('idle');
  });

  it('TC-15 plain wheel pans vertically and prevents default', () => {
    const { viewport } = renderApp();
    const start = initialCamera();
    const ev = wheel(viewport, { deltaY: 100 });
    flushFrame();
    expect(ev.defaultPrevented).toBe(true);
    const cam = readCamera(viewport);
    expect(cam.y).toBe(start.y + 100 / start.zoom);
    expect(cam.x).toBe(start.x);
  });

  it('plain horizontal wheel pans horizontally; LINE deltaMode converts to pixels', () => {
    const { viewport } = renderApp();
    const start = initialCamera();
    wheel(viewport, { deltaX: 3, deltaMode: WheelEvent.DOM_DELTA_LINE });
    flushFrame();
    const cam = readCamera(viewport);
    expect(cam.x).toBeGreaterThan(start.x);
    expect(cam.y).toBe(start.y);
  });

  it('TC-16 Ctrl wheel zooms in around the pointer and prevents default', () => {
    const { viewport } = renderApp();
    const start = initialCamera();
    const ev = wheel(viewport, { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 200 });
    flushFrame();
    expect(ev.defaultPrevented).toBe(true);
    const expected = zoomAt(start, { x: 300, y: 200 }, Math.exp(100 * WHEEL_ZOOM_SENSITIVITY));
    const cam = readCamera(viewport);
    expect(cam.zoom).toBeGreaterThan(start.zoom);
    expect(cam.zoom).toBeCloseTo(expected.zoom, 10);
    expect(cam.x).toBeCloseTo(expected.x, 6);
    expect(cam.y).toBeCloseTo(expected.y, 6);
  });

  it('Meta (Cmd) wheel zooms as well', () => {
    const { viewport } = renderApp();
    const ev = wheel(viewport, { deltaY: 100, metaKey: true, clientX: 10, clientY: 10 });
    flushFrame();
    expect(ev.defaultPrevented).toBe(true);
    expect(readCamera(viewport).zoom).toBeLessThan(1);
  });

  it('TC-17 Safari gesturechange scale 2 doubles zoom and prevents default', () => {
    const { viewport } = renderApp();
    const start = new Event('gesturestart', { bubbles: true, cancelable: true });
    Object.assign(start, { scale: 1 });
    const change = new Event('gesturechange', { bubbles: true, cancelable: true });
    Object.assign(change, { scale: 2, clientX: 200, clientY: 150 });
    act(() => {
      viewport.dispatchEvent(start);
      viewport.dispatchEvent(change);
    });
    flushFrame();
    expect(start.defaultPrevented).toBe(true);
    expect(change.defaultPrevented).toBe(true);
    expect(readCamera(viewport).zoom).toBe(Math.min(2, ZOOM_MAX));
  });

  it('TC-18 Ctrl+= , Ctrl+- , Ctrl+0 step and reset, each preventing default', () => {
    const { viewport } = renderApp();
    const zoomIn = key({ key: '=', ctrlKey: true });
    flushFrame();
    expect(zoomIn.defaultPrevented).toBe(true);
    expect(readCamera(viewport).zoom).toBe(ZOOM_STEP_FACTOR);

    const zoomOut = key({ key: '-', ctrlKey: true });
    flushFrame();
    expect(zoomOut.defaultPrevented).toBe(true);
    expect(readCamera(viewport).zoom).toBe(1);

    wheel(viewport, { deltaY: 500 });
    flushFrame();
    const reset = key({ key: '0', metaKey: true });
    flushFrame();
    expect(reset.defaultPrevented).toBe(true);
    expect(readCamera(viewport)).toEqual(initialCamera());
  });

  it('keys without Ctrl/Cmd are ignored', () => {
    const { viewport } = renderApp();
    const ev = key({ key: '=' });
    flushFrame();
    expect(ev.defaultPrevented).toBe(false);
    expect(readCamera(viewport)).toEqual(initialCamera());
  });

  it('TC-29 click without moving leaves camera unchanged and keeps the hint', () => {
    const { viewport } = renderApp();
    fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 50, clientY: 50 });
    flushFrame();
    expect(readCamera(viewport)).toEqual(initialCamera());
    expect(screen.getByText(NAVIGATION_HINT_TEXT)).toBeInTheDocument();
  });

  it('TC-30 Ctrl wheel over the zoom control does not zoom the board or suppress the default', () => {
    const { viewport } = renderApp();
    const group = screen.getByRole('group', { name: 'Zoom' });
    const ev = wheel(screen.getByRole('button', { name: 'Zoom in' }), {
      deltaY: -100,
      ctrlKey: true,
    });
    flushFrame();
    expect(group).toBeInTheDocument();
    expect(ev.defaultPrevented).toBe(false);
    expect(readCamera(viewport)).toEqual(initialCamera());
  });

  it('renders a dot grid whose spacing follows zoom', () => {
    const { viewport } = renderApp();
    expect(viewport.style.backgroundSize).toBe('24px 24px');
    key({ key: '=', ctrlKey: true });
    flushFrame();
    expect(viewport.style.backgroundSize).toBe('30px 30px');
  });
});
