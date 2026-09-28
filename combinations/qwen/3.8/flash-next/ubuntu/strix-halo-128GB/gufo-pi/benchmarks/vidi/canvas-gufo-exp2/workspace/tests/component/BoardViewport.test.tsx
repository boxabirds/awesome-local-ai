import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/client/App';
import { screenToWorld } from '../../src/client/canvas/camera';
import {
  GRID_SPACING_WORLD,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import {
  cameraFromDom,
  fireGesture,
  fireKey,
  fireWheel,
  flushFrame,
  hintEl,
  viewportEl,
  worldEl,
  zoomLabelEl,
} from './helpers/board';

const POINTER = { pointerId: 1, isPrimary: true, button: 0 };

describe('viewport.input: drag to pan', () => {
  // TC-13
  it('TC-13 moves the board by exactly the pointer movement and walks Idle -> Panning -> Idle', async () => {
    render(<App />);
    const start = cameraFromDom();
    expect(viewportEl()).toHaveAttribute('data-panning', 'false');

    fireEvent.pointerDown(viewportEl(), { ...POINTER, clientX: 400, clientY: 300 });
    expect(viewportEl()).toHaveAttribute('data-panning', 'true');

    fireEvent.pointerMove(viewportEl(), { ...POINTER, clientX: 600, clientY: 400 });
    await flushFrame();

    const cam = cameraFromDom();
    expect(cam.x).toBeCloseTo(start.x - 200 / start.zoom, 9);
    expect(cam.y).toBeCloseTo(start.y - 100 / start.zoom, 9);
    expect(cam.zoom).toBeCloseTo(start.zoom, 12);
    const style = worldEl().getAttribute('style') ?? '';
    expect(style).toContain(`scale(${cam.zoom})`);
    expect(style).toContain(`translate(${-cam.x}px, ${-cam.y}px)`);

    fireEvent.pointerUp(viewportEl(), { ...POINTER });
    expect(viewportEl()).toHaveAttribute('data-panning', 'false');
    const after = cameraFromDom();
    expect(after.x).toBeCloseTo(start.x - 200, 9);
    expect(after.y).toBeCloseTo(start.y - 100, 9);
  });

  // TC-14
  it('TC-14 freezes the camera at pointercancel and ignores later moves', async () => {
    render(<App />);
    const start = cameraFromDom();

    fireEvent.pointerDown(viewportEl(), { ...POINTER, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewportEl(), { ...POINTER, clientX: 150, clientY: 120 });
    await flushFrame();
    const atCancel = cameraFromDom();
    expect(atCancel.x).toBeCloseTo(start.x - 50, 9);

    fireEvent.pointerCancel(viewportEl(), { ...POINTER });
    expect(viewportEl()).toHaveAttribute('data-panning', 'false');

    fireEvent.pointerMove(viewportEl(), { ...POINTER, clientX: 900, clientY: 900 });
    await flushFrame();
    expect(cameraFromDom()).toEqual(atCancel);
  });

  // TC-29
  it('TC-29 leaves the camera and the hint alone for a click without movement', async () => {
    render(<App />);
    const before = cameraFromDom();

    fireEvent.pointerDown(viewportEl(), { ...POINTER, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(viewportEl(), { ...POINTER });
    await flushFrame();

    expect(cameraFromDom()).toEqual(before);
    expect(hintEl()).not.toBeNull();
  });

  it('does not start a pan from board content, only from the empty board', async () => {
    render(<App />);
    const before = cameraFromDom();
    // Later stories render objects into the world layer; a pointerdown on one
    // is not the board surface, so it must not pan the board.
    const object = document.createElement('div');
    object.setAttribute('data-testid', 'fake-object');
    worldEl().appendChild(object);

    fireEvent.pointerDown(object, { ...POINTER, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(object, { ...POINTER, clientX: 400, clientY: 400 });
    await flushFrame();

    expect(cameraFromDom()).toEqual(before);
    expect(viewportEl()).toHaveAttribute('data-panning', 'false');
  });
});

describe('viewport.input: wheel and gestures', () => {
  // TC-15
  it('TC-15 pans with a plain wheel scroll and prevents the page default', async () => {
    render(<App />);
    const start = cameraFromDom();

    const event = fireWheel(viewportEl(), { deltaY: 100 });
    await flushFrame();

    expect(event.defaultPrevented).toBe(true);
    const cam = cameraFromDom();
    expect(cam.y).toBeCloseTo(start.y + 100 / start.zoom, 9);
    expect(cam.x).toBeCloseTo(start.x, 12);
    expect(cam.zoom).toBeCloseTo(start.zoom, 12);
  });

  it('pans horizontally with a trackpad scroll right', async () => {
    render(<App />);
    const start = cameraFromDom();

    const event = fireWheel(viewportEl(), { deltaX: 80 });
    await flushFrame();

    expect(event.defaultPrevented).toBe(true);
    const cam = cameraFromDom();
    expect(cam.x).toBeCloseTo(start.x + 80 / start.zoom, 9);
  });

  it('converts line and page delta modes to pixels', async () => {
    render(<App />);
    const start = cameraFromDom();

    fireWheel(viewportEl(), { deltaY: 3, deltaMode: 1 }); // 3 lines
    await flushFrame();
    const afterLines = cameraFromDom();

    fireWheel(viewportEl(), { deltaY: -3, deltaMode: 1 });
    await flushFrame();
    expect(cameraFromDom().y).toBeCloseTo(start.y, 9);

    fireWheel(viewportEl(), { deltaY: 1, deltaMode: 2 }); // 1 page
    await flushFrame();
    const afterPage = cameraFromDom();
    expect(afterPage.y).toBeGreaterThan(afterLines.y);
  });

  // TC-16
  it('TC-16 zooms around the pointer on Ctrl+wheel and prevents the page default', async () => {
    render(<App />);
    const start = cameraFromDom();
    const point = { x: 300, y: 200 };
    const worldBefore = screenToWorld(start, point);

    const event = fireWheel(viewportEl(), { deltaY: -100, ctrlKey: true, clientX: point.x, clientY: point.y });
    await flushFrame();

    expect(event.defaultPrevented).toBe(true);
    const cam = cameraFromDom();
    expect(cam.zoom).toBeGreaterThan(start.zoom);
    const worldAfter = screenToWorld(cam, point);
    expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(1e-6);
    expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(1e-6);
  });

  it('clamps Ctrl+wheel zoom at ZOOM_MAX and disables Zoom in', async () => {
    render(<App />);
    // Zoom in a lot: the wheel gesture clamps at ZOOM_MAX.
    for (let i = 0; i < 60; i += 1) {
      fireWheel(viewportEl(), { deltaY: -600, ctrlKey: true, clientX: 10, clientY: 10 });
      await flushFrame();
    }
    expect(cameraFromDom().zoom).toBe(ZOOM_MAX);
    expect(screen.getByTestId('zoom-in')).toBeDisabled();
  });

  it('clamps Ctrl+wheel zoom at ZOOM_MIN and disables Zoom out', async () => {
    render(<App />);
    for (let i = 0; i < 60; i += 1) {
      fireWheel(viewportEl(), { deltaY: 600, ctrlKey: true, clientX: 10, clientY: 10 });
      await flushFrame();
    }
    expect(cameraFromDom().zoom).toBe(ZOOM_MIN);
    expect(screen.getByTestId('zoom-out')).toBeDisabled();
  });

  // TC-17
  it('TC-17 zooms with a Safari gesture scale and prevents the page default', async () => {
    render(<App />);
    const start = cameraFromDom();

    fireGesture(viewportEl(), 'gesturestart', 1);
    const event = fireGesture(viewportEl(), 'gesturechange', 2, { x: 200, y: 150 });
    await flushFrame();

    expect(event.defaultPrevented).toBe(true);
    const cam = cameraFromDom();
    expect(cam.zoom).toBeCloseTo(Math.min(start.zoom * 2, ZOOM_MAX), 9);
    const before = screenToWorld(start, { x: 200, y: 150 });
    const after = screenToWorld(cam, { x: 200, y: 150 });
    expect(Math.abs(after.x - before.x)).toBeLessThan(1e-6);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1e-6);
  });
});

describe('viewport.input: keyboard shortcuts', () => {
  // TC-18
  it('TC-18 steps in, steps out and resets with Ctrl held, preventing page zoom', async () => {
    render(<App />);
    const start = cameraFromDom();

    const inEvent = fireKey('=', { ctrlKey: true });
    await flushFrame();
    expect(inEvent.defaultPrevented).toBe(true);
    expect(cameraFromDom().zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 9);
    expect(zoomLabelEl().textContent).toBe('125%');

    const outEvent = fireKey('-', { ctrlKey: true });
    await flushFrame();
    expect(outEvent.defaultPrevented).toBe(true);
    expect(cameraFromDom().zoom).toBe(1);
    expect(zoomLabelEl().textContent).toBe('100%');

    // Move away, then reset with the keyboard.
    fireEvent.pointerDown(viewportEl(), { ...POINTER, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(viewportEl(), { ...POINTER, clientX: 300, clientY: 300 });
    await flushFrame();
    expect(cameraFromDom().x).not.toBe(start.x);

    const resetEvent = fireKey('0', { ctrlKey: true });
    await flushFrame();
    expect(resetEvent.defaultPrevented).toBe(true);
    expect(cameraFromDom()).toEqual(start);
  });

  it('supports Cmd as well as Ctrl and leaves other shortcuts alone', async () => {
    render(<App />);

    const cmdIn = fireKey('+', { metaKey: true });
    await flushFrame();
    expect(cmdIn.defaultPrevented).toBe(true);
    expect(cameraFromDom().zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 9);

    const unrelated = fireKey('s', { ctrlKey: true });
    expect(unrelated.defaultPrevented).toBe(false);
    expect(cameraFromDom().zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 9);

    const plain = fireKey('=');
    expect(plain.defaultPrevented).toBe(false);
    expect(cameraFromDom().zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 9);
  });
});

describe('viewport.input: grid and chrome', () => {
  it('renders a dot grid whose spacing and position follow the camera', async () => {
    render(<App />);
    const style = viewportEl();
    expect(style.style.backgroundSize).toBe(`${GRID_SPACING_WORLD}px ${GRID_SPACING_WORLD}px`);

    const start = cameraFromDom();
    const initialOffset = style.style.backgroundPosition;

    fireEvent.pointerDown(viewportEl(), { ...POINTER, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(viewportEl(), { ...POINTER, clientX: 5, clientY: 0 });
    await flushFrame();

    const cam = cameraFromDom();
    expect(cam.x).not.toBe(start.x);
    expect(style.style.backgroundPosition).not.toBe(initialOffset);

    // Zooming scales the grid with the board.
    fireWheel(viewportEl(), { deltaY: -100, ctrlKey: true, clientX: 100, clientY: 100 });
    await flushFrame();
    const zoomed = cameraFromDom();
    expect(style.style.backgroundSize).toBe(
      `${GRID_SPACING_WORLD * zoomed.zoom}px ${GRID_SPACING_WORLD * zoomed.zoom}px`,
    );
  });

  // TC-30
  it('TC-30 ignores Ctrl+wheel over the zoom control', async () => {
    render(<App />);
    const before = cameraFromDom();
    const controls = screen.getByTestId('zoom-controls');

    const event = fireWheel(controls, { deltaY: -200, ctrlKey: true });
    await flushFrame();

    expect(cameraFromDom()).toEqual(before);
    // The control does not claim the browser default for the page.
    expect(event.defaultPrevented).toBe(false);
  });

  it('resizes without moving content relative to the top-left of the board', async () => {
    render(<App />);
    const before = cameraFromDom();

    Object.defineProperty(window, 'innerWidth', { value: 900, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 500, configurable: true });
    fireEvent(window, new Event('resize'));
    await flushFrame();

    expect(cameraFromDom()).toEqual(before);
  });
});
