import { describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import { resetCamera, zoomAt } from '../../src/client/canvas/camera';
import { NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import { WHEEL_ZOOM_SENSITIVITY, ZOOM_MAX, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import { camera, dispatchPrevented, nextFrame, pointer, renderBoard, setCamera } from './helpers';

const START = { x: 0, y: 0, zoom: 1 };

function expectWorldTransform(world: HTMLElement) {
  const c = camera();
  expect(world.style.transform).toBe(`scale(${c.zoom}) translate(${-c.x}px, ${-c.y}px)`);
}

describe('BoardViewport input (viewport.input)', () => {
  it('starts with the origin centred at 100%', () => {
    renderBoard();
    expect(camera()).toEqual(resetCamera({ width: window.innerWidth, height: window.innerHeight }));
  });

  it('TC-13 drag moves the board by the pointer delta; Idle → Panning → Idle', () => {
    const { viewport, world } = renderBoard();
    setCamera(START);
    expect(viewport).toHaveAttribute('data-state', 'idle');
    pointer(viewport, 'down', 100, 100);
    expect(viewport).toHaveAttribute('data-state', 'panning');
    pointer(viewport, 'move', 300, 200);
    nextFrame();
    expect(camera()).toEqual({ x: -200, y: -100, zoom: 1 });
    expectWorldTransform(world);
    pointer(viewport, 'up', 300, 200);
    expect(viewport).toHaveAttribute('data-state', 'idle');
    pointer(viewport, 'move', 500, 500);
    nextFrame();
    expect(camera()).toEqual({ x: -200, y: -100, zoom: 1 });
  });

  it('coalesces several pointer moves into one frame', () => {
    const { viewport, world } = renderBoard();
    setCamera(START);
    pointer(viewport, 'down', 0, 0);
    pointer(viewport, 'move', 10, 0);
    pointer(viewport, 'move', 20, 5);
    // Not rendered until the next animation frame.
    expect(world.style.transform).toBe('scale(1) translate(0px, 0px)');
    nextFrame();
    expect(camera()).toEqual({ x: -20, y: -5, zoom: 1 });
  });

  it('TC-14 pointercancel mid-drag freezes the camera; later moves are ignored', () => {
    const { viewport } = renderBoard();
    setCamera(START);
    pointer(viewport, 'down', 0, 0);
    pointer(viewport, 'move', 50, 40);
    pointer(viewport, 'cancel', 50, 40);
    nextFrame();
    expect(viewport).toHaveAttribute('data-state', 'idle');
    const atCancel = camera();
    expect(atCancel).toEqual({ x: -50, y: -40, zoom: 1 });
    pointer(viewport, 'move', 400, 400);
    nextFrame();
    expect(camera()).toEqual(atCancel);
  });

  it('does not start a pan from a child element', () => {
    const { viewport } = renderBoard();
    setCamera(START);
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    pointer(zoomIn, 'down', 0, 0);
    expect(viewport).toHaveAttribute('data-state', 'idle');
    pointer(viewport, 'move', 100, 100);
    nextFrame();
    expect(camera()).toEqual(START);
  });

  it('TC-15 plain wheel pans by delta / zoom and prevents the default', () => {
    const { viewport } = renderBoard();
    setCamera(START);
    const prevented = dispatchPrevented(
      viewport,
      new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }),
    );
    nextFrame();
    expect(prevented).toBe(true);
    expect(camera()).toEqual({ x: 0, y: 100 / START.zoom, zoom: 1 });
  });

  it('plain wheel horizontal scroll pans horizontally; line mode is converted to pixels', () => {
    const { viewport } = renderBoard();
    setCamera({ x: 0, y: 0, zoom: 2 });
    dispatchPrevented(viewport, new WheelEvent('wheel', { deltaX: 50, bubbles: true, cancelable: true }));
    nextFrame();
    expect(camera()).toEqual({ x: 25, y: 0, zoom: 2 });
    dispatchPrevented(
      viewport,
      new WheelEvent('wheel', { deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE, bubbles: true, cancelable: true }),
    );
    nextFrame();
    expect(camera().y).toBeGreaterThan(0);
  });

  it('TC-16 Ctrl wheel zooms in around the pointer and prevents the default', () => {
    const { viewport } = renderBoard();
    setCamera(START);
    const point = { x: 300, y: 200 };
    const prevented = dispatchPrevented(
      viewport,
      new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, clientX: point.x, clientY: point.y, bubbles: true, cancelable: true }),
    );
    nextFrame();
    expect(prevented).toBe(true);
    expect(camera().zoom).toBeGreaterThan(1);
    expect(camera()).toEqual(zoomAt(START, point, Math.exp(100 * WHEEL_ZOOM_SENSITIVITY)));
  });

  it('Meta (Cmd) wheel also zooms', () => {
    const { viewport } = renderBoard();
    setCamera(START);
    dispatchPrevented(
      viewport,
      new WheelEvent('wheel', { deltaY: 100, metaKey: true, bubbles: true, cancelable: true }),
    );
    nextFrame();
    expect(camera().zoom).toBeLessThan(1);
  });

  it('TC-17 Safari gesturechange zooms by the scale ratio (clamped) and prevents the default', () => {
    const { viewport } = renderBoard();
    setCamera(START);
    const gesture = (type: string, scale: number) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(e, { scale, clientX: 300, clientY: 200 });
      return e;
    };
    expect(dispatchPrevented(viewport, gesture('gesturestart', 1))).toBe(true);
    expect(dispatchPrevented(viewport, gesture('gesturechange', 2))).toBe(true);
    nextFrame();
    expect(camera().zoom).toBe(2);
    dispatchPrevented(viewport, gesture('gesturechange', 2 * ZOOM_MAX));
    nextFrame();
    expect(camera().zoom).toBe(ZOOM_MAX);
  });

  it('TC-18 Ctrl+= , Ctrl+- , Ctrl+0 step and reset with the default prevented', () => {
    renderBoard();
    setCamera({ x: 500, y: 500, zoom: 1 });
    const key = (k: string, mod: 'ctrlKey' | 'metaKey' = 'ctrlKey') =>
      dispatchPrevented(window, new KeyboardEvent('keydown', { key: k, [mod]: true, bubbles: true, cancelable: true }));
    expect(key('=')).toBe(true);
    expect(camera().zoom).toBe(ZOOM_STEP_FACTOR);
    expect(screen.getByRole('status')).toHaveTextContent('125%');
    expect(key('-')).toBe(true);
    expect(camera().zoom).toBe(1);
    expect(key('0', 'metaKey')).toBe(true);
    expect(camera()).toEqual(resetCamera({ width: window.innerWidth, height: window.innerHeight }));
  });

  it('ignores zoom keys without Ctrl/Cmd', () => {
    renderBoard();
    setCamera(START);
    const prevented = dispatchPrevented(window, new KeyboardEvent('keydown', { key: '=', bubbles: true, cancelable: true }));
    expect(prevented).toBe(false);
    expect(camera()).toEqual(START);
  });

  it('TC-29 click without moving leaves the camera unchanged and keeps the hint', () => {
    const { viewport } = renderBoard();
    setCamera(START);
    const before = camera();
    pointer(viewport, 'down', 120, 80);
    pointer(viewport, 'move', 120, 80);
    pointer(viewport, 'up', 120, 80);
    nextFrame();
    expect(camera()).toBe(before);
    expect(camera()).toEqual(START);
    expect(screen.getByText(NAVIGATION_HINT_TEXT)).toBeInTheDocument();
  });

  it('TC-30 Ctrl wheel over the zoom control does not zoom the board or suppress the browser default', () => {
    renderBoard();
    setCamera(START);
    const controls = screen.getByRole('group', { name: 'Zoom' });
    const prevented = dispatchPrevented(
      controls,
      new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }),
    );
    nextFrame();
    expect(prevented).toBe(false);
    expect(camera()).toEqual(START);
    expect(screen.getByText(NAVIGATION_HINT_TEXT)).toBeInTheDocument();
  });

  it('zoom buttons step around the centre and reset returns to 100%', () => {
    renderBoard();
    setCamera({ x: 1000, y: 1000, zoom: 3 });
    act(() => screen.getByRole('button', { name: 'Reset view' }).click());
    expect(camera()).toEqual(resetCamera({ width: window.innerWidth, height: window.innerHeight }));
    expect(screen.getByRole('status')).toHaveTextContent('100%');
    act(() => screen.getByRole('button', { name: 'Zoom in' }).click());
    expect(screen.getByRole('status')).toHaveTextContent('125%');
    act(() => screen.getByRole('button', { name: 'Zoom out' }).click());
    expect(screen.getByRole('status')).toHaveTextContent('100%');
  });
});
