import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { WHEEL_ZOOM_SENSITIVITY, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import { zoomPercent } from '../../src/client/canvas/camera';
import {
  CENTRED_TRANSFORM,
  flushFrame,
  renderApp,
  surfaceOf,
  worldLayerOf,
  zoomLabelOf,
} from './helpers';

const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

beforeEach(() => {
  vi.useFakeTimers();
});

describe('pan by dragging (viewport.input)', () => {
  // TC-13: pointerdown → move(+200,+100) → up. The world layer transform
  // matches the camera; the state machine runs Idle → Panning → Idle.
  it('TC-13 drags the board exactly with the pointer and returns to idle', () => {
    const { getByText, queryByTestId } = renderApp();
    const surface = surfaceOf(document.body);
    const world = worldLayerOf(document.body);
    expect(getByText(HINT_TEXT)).toBeInTheDocument();
    expect(world.style.transform).toBe(CENTRED_TRANSFORM);
    expect(surface).toHaveAttribute('data-state', 'idle');

    fireEvent.pointerDown(surface, { pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientX: 300, clientY: 300 });
    expect(surface).toHaveAttribute('data-state', 'panning');

    fireEvent.pointerMove(surface, { pointerId: 1, isPrimary: true, pointerType: 'mouse', clientX: 500, clientY: 400 });
    flushFrame();
    // Camera x: -640 - 200 = -840; y: -400 - 100 = -500 (content moved +200,+100).
    expect(world.style.transform).toBe('scale(1) translate(840px, 500px)');

    fireEvent.pointerUp(surface, { pointerId: 1 });
    expect(surface).toHaveAttribute('data-state', 'idle');
    // The hint is dismissed by the first pan and does not come back.
    expect(queryByTestId('navigation-hint')).toBeNull();
  });

  // TC-14: pointercancel mid-drag freezes the camera; later moves are ignored.
  it('TC-14 freezes the camera at the pointercancel position', () => {
    renderApp();
    const surface = surfaceOf(document.body);
    const world = worldLayerOf(document.body);

    fireEvent.pointerDown(surface, { pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(surface, { pointerId: 1, isPrimary: true, pointerType: 'mouse', clientX: 500, clientY: 400 });
    flushFrame();
    expect(world.style.transform).toBe('scale(1) translate(840px, 500px)');

    fireEvent.pointerCancel(surface, { pointerId: 1 });
    expect(surface).toHaveAttribute('data-state', 'idle');

    fireEvent.pointerMove(surface, { pointerId: 1, isPrimary: true, pointerType: 'mouse', clientX: 900, clientY: 900 });
    flushFrame();
    expect(world.style.transform).toBe('scale(1) translate(840px, 500px)');
  });

  // TC-29 (negative): a click without moving leaves the camera unchanged and
  // does not dismiss the hint.
  it('TC-29 ignores a zero-length click and keeps the hint', () => {
    const { queryByTestId } = renderApp();
    const surface = surfaceOf(document.body);
    const world = worldLayerOf(document.body);

    fireEvent.pointerDown(surface, { pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientX: 400, clientY: 400 });
    fireEvent.pointerUp(surface, { pointerId: 1 });
    flushFrame();

    expect(world.style.transform).toBe(CENTRED_TRANSFORM);
    expect(surface).toHaveAttribute('data-testid', 'board-viewport');
    expect(queryByTestId('navigation-hint')).not.toBeNull();
    expect(queryByTestId('navigation-hint')).toHaveTextContent(HINT_TEXT);
  });
});

describe('wheel input (viewport.input)', () => {
  // TC-15: plain wheel moves the board in the scroll direction and is
  // defaultPrevented (the page never scrolls).
  it('TC-15 pans on plain wheel and prevents the default', () => {
    renderApp();
    const surface = surfaceOf(document.body);
    const world = worldLayerOf(document.body);

    const event = new WheelEvent('wheel', {
      deltaY: 100,
      clientX: 640,
      clientY: 400,
      bubbles: true,
      cancelable: true,
    });
    surface.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    flushFrame();
    // Camera y increases by deltaY/zoom (=100), so content moves up.
    expect(world.style.transform).toBe('scale(1) translate(640px, 300px)');
  });

  // TC-16: Ctrl + wheel zooms around the pointer and is defaultPrevented
  // (the page never zooms).
  it('TC-16 zooms on ctrl wheel at the pointer and prevents the default', () => {
    renderApp();
    const surface = surfaceOf(document.body);
    const world = worldLayerOf(document.body);
    const label = zoomLabelOf(document.body);

    const event = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
      bubbles: true,
      cancelable: true,
    });
    surface.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    flushFrame();

    const expectedZoom = Math.exp(100 * WHEEL_ZOOM_SENSITIVITY);
    expect(zoomLabelOf(document.body)).toHaveTextContent(`${zoomPercent({ x: 0, y: 0, zoom: expectedZoom })}%`);
    expect(parseFloat(/scale\(([^)]+)\)/.exec(world.style.transform)![1])).toBeCloseTo(expectedZoom, 6);
    expect(label).toBeInTheDocument();
  });

  // TC-30 (negative): Ctrl + wheel over the zoom control does not zoom the
  // board, and the browser default is not suppressed there.
  it('TC-30 leaves the camera unchanged for ctrl wheel over the zoom control', () => {
    const { getByTestId } = renderApp();
    const world = worldLayerOf(document.body);
    const controls = getByTestId('zoom-controls');

    const event = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      clientX: 1200,
      clientY: 780,
      bubbles: true,
      cancelable: true,
    });
    controls.dispatchEvent(event);
    flushFrame();

    expect(event.defaultPrevented).toBe(false);
    expect(world.style.transform).toBe(CENTRED_TRANSFORM);
    expect(zoomLabelOf(document.body)).toHaveTextContent('100%');
  });
});

describe('Safari gesture input (viewport.input)', () => {
  // TC-17: gesturestart + gesturechange(scale 2) doubles the zoom and is
  // defaultPrevented (Safari page zoom never changes).
  it('TC-17 zooms with Safari gesture events around the pointer', () => {
    renderApp();
    const surface = surfaceOf(document.body);
    const world = worldLayerOf(document.body);

    const start = new Event('gesturestart', { bubbles: true, cancelable: true });
    Object.assign(start, { scale: 1, clientX: 640, clientY: 400 });
    surface.dispatchEvent(start);
    expect(start.defaultPrevented).toBe(true);

    const change = new Event('gesturechange', { bubbles: true, cancelable: true });
    Object.assign(change, { scale: 2, clientX: 640, clientY: 400 });
    surface.dispatchEvent(change);
    expect(change.defaultPrevented).toBe(true);
    flushFrame();

    // Zoom 2 around the viewport centre: camera halves towards the centre.
    expect(world.style.transform).toBe('scale(2) translate(320px, 200px)');
    expect(zoomLabelOf(document.body)).toHaveTextContent('200%');
  });
});

describe('keyboard shortcuts (viewport.input)', () => {
  // TC-18: Ctrl + = zooms in one step, Ctrl + - back out, Ctrl + 0 resets;
  // each shortcut is defaultPrevented so the browser page zoom is untouched.
  it('TC-18 handles ctrl zoom in, zoom out and reset keys', () => {
    renderApp();
    const world = worldLayerOf(document.body);

    const zoomIn = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(zoomIn);
    expect(zoomIn.defaultPrevented).toBe(true);
    flushFrame();
    expect(zoomLabelOf(document.body)).toHaveTextContent(`${zoomPercent({ x: 0, y: 0, zoom: 1 * ZOOM_STEP_FACTOR })}%`);
    expect(parseFloat(/scale\(([^)]+)\)/.exec(world.style.transform)![1])).toBe(ZOOM_STEP_FACTOR);

    const zoomOut = new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(zoomOut);
    expect(zoomOut.defaultPrevented).toBe(true);
    flushFrame();
    // Step snapping returns the zoom to exactly 1.0.
    expect(world.style.transform).toBe(CENTRED_TRANSFORM);
    expect(zoomLabelOf(document.body)).toHaveTextContent('100%');

    // Move away first so the reset has something to undo.
    const surface = surfaceOf(document.body);
    fireEvent.pointerDown(surface, { pointerId: 2, isPrimary: true, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 2, isPrimary: true, pointerType: 'mouse', clientX: 260, clientY: 180 });
    fireEvent.pointerUp(surface, { pointerId: 2 });
    flushFrame();

    const reset = new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(reset);
    expect(reset.defaultPrevented).toBe(true);
    flushFrame();
    expect(world.style.transform).toBe(CENTRED_TRANSFORM);
    expect(zoomLabelOf(document.body)).toHaveTextContent('100%');
  });
});
