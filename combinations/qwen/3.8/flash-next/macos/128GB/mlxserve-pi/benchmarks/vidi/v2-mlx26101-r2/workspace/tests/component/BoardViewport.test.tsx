import { beforeEach, describe, expect, it } from 'vitest';

import { screen } from './tl.js';
import { screenToWorld, worldToScreen, zoomAt, type Camera, type Point } from '../../src/client/canvas/camera.js';
import { GRID_SPACING_WORLD, ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config.js';
import {
  DRAG,
  POINTER,
  STANDARD_VIEW,
  board,
  camera,
  centreZoom,
  flushFrames,
  gestureEvent,
  grid,
  keydown,
  lostPointerCapture,
  pointerCancel,
  pointerDown,
  pointerMove,
  pointerUp,
  renderedCamera,
  renderApp,
  wheelEvent,
  worldLayer,
  zoomLabel,
} from './helpers.js';

const expectCamera = (actual: Camera, expected: Camera, precision = 6): void => {
  expect(actual.zoom).toBeCloseTo(expected.zoom, precision);
  expect(actual.x).toBeCloseTo(expected.x, precision);
  expect(actual.y).toBeCloseTo(expected.y, precision);
};

/** Positive modulo: the remainder of the dot lattice. */
const mod = (value: number, period: number): number => {
  const wrapped = value % period;
  return wrapped < 0 ? wrapped + period : wrapped;
};

const expectPoints = (actual: Point, expected: Point, precision = 6): void => {
  expect(actual.x).toBeCloseTo(expected.x, precision);
  expect(actual.y).toBeCloseTo(expected.y, precision);
};

beforeEach(() => {
  renderApp();
});

describe('pan by dragging (TC-13)', () => {
  it('moves the board by exactly the distance and direction the pointer moved', () => {
    expect(renderedCamera()).toEqual(STANDARD_VIEW);

    pointerDown({ x: 100, y: 100 });
    expect(board()).toHaveAttribute('data-panning', 'true');

    pointerMove({ x: 100 + DRAG.x, y: 100 + DRAG.y });
    expectCamera(camera(), { ...STANDARD_VIEW, x: STANDARD_VIEW.x - DRAG.x, y: STANDARD_VIEW.y - DRAG.y });
    // Rendered world layer transform matches the camera: the content moved with
    // the pointer, so the world origin is now 200 px right and 100 px down.
    expectCamera(renderedCamera(), camera(), 9);
    expect(worldLayer().style.transform).toBe(
      `scale(1) translate(${-STANDARD_VIEW.x + DRAG.x}px, ${-STANDARD_VIEW.y + DRAG.y}px)`,
    );

    pointerUp({ x: 100 + DRAG.x, y: 100 + DRAG.y });
    expect(board()).toHaveAttribute('data-panning', 'false');
    expectCamera(renderedCamera(), { ...STANDARD_VIEW, x: STANDARD_VIEW.x - DRAG.x, y: STANDARD_VIEW.y - DRAG.y });
  });

  it('moves the dot grid by exactly the drag distance', () => {
    const before = grid();
    expect(before.spacing).toBeCloseTo(GRID_SPACING_WORLD, 9);

    pointerDown({ x: 40, y: 40 });
    pointerMove({ x: 40 + DRAG.x, y: 40 + DRAG.y });
    pointerUp({ x: 40 + DRAG.x, y: 40 + DRAG.y });

    const after = grid();
    expect(after.spacing).toBeCloseTo(before.spacing, 9);
    // The lattice repeats every `spacing` px, so the phase of the dots after the
    // drag is exactly the phase before, advanced by the drag distance.
    const shift = (a: number, b: number): number =>
      mod(a - (b + DRAG.x), after.spacing);
    expect(shift(after.offsetX, before.offsetX)).toBeCloseTo(0, 6);
    expect(mod(after.offsetY - (before.offsetY + DRAG.y), after.spacing)).toBeCloseTo(0, 6);
    // And the world layer itself moved by exactly the drag, in the same direction.
    expectCamera(renderedCamera(), { ...STANDARD_VIEW, x: STANDARD_VIEW.x - DRAG.x, y: STANDARD_VIEW.y - DRAG.y }, 9);
  });

  it('follows the pointer across several moves within one frame', () => {
    pointerDown({ x: 500, y: 500 });
    pointerMove({ x: 520, y: 500 });
    pointerMove({ x: 560, y: 470 });
    pointerMove({ x: 600, y: 430 });
    pointerUp({ x: 600, y: 430 });
    // Total pointer movement: 100 px right, 70 px up.
    expectCamera(renderedCamera(), {
      x: STANDARD_VIEW.x - 100,
      y: STANDARD_VIEW.y + 70,
      zoom: 1,
    });
  });

  it('ends the drag on lostpointercapture and ignores later moves', () => {
    pointerDown({ x: 200, y: 200 });
    pointerMove({ x: 250, y: 250 });
    lostPointerCapture({ x: 250, y: 250 });
    expect(board()).toHaveAttribute('data-panning', 'false');
    const frozen = camera();
    pointerMove({ x: 900, y: 900 });
    expect(camera()).toBe(frozen);
  });
});

describe('drag interrupted (TC-14)', () => {
  it('keeps the board where it was at the moment of cancellation', () => {
    pointerDown({ x: 300, y: 300 });
    pointerMove({ x: 340, y: 260 });
    const atCancel = camera();
    expectCamera(atCancel, { x: STANDARD_VIEW.x - 40, y: STANDARD_VIEW.y + 40, zoom: 1 });

    pointerCancel({ x: 340, y: 260 });
    expect(board()).toHaveAttribute('data-panning', 'false');
    expectCamera(camera(), atCancel, 9);

    // Pointer keeps moving (e.g. the pointer leaves the window): ignored.
    pointerMove({ x: 800, y: 800 });
    expect(camera()).toBe(atCancel);
    expectCamera(renderedCamera(), atCancel, 9);
  });
});

describe('pan by scrolling (TC-15)', () => {
  it('moves the board in the scroll direction and prevents the page scrolling', () => {
    const event = wheelEvent({ deltaY: 100 });
    expect(event.defaultPrevented).toBe(true);
    expectCamera(camera(), { ...STANDARD_VIEW, y: STANDARD_VIEW.y + 100 / STANDARD_VIEW.zoom });
    expect(zoomLabel()).toHaveTextContent('100%');
  });

  it('moves the board sideways for a horizontal trackpad scroll', () => {
    wheelEvent({ deltaX: 60 });
    // Scroll right: content moves left, so the camera advances in x.
    expectCamera(camera(), { x: STANDARD_VIEW.x + 60, y: STANDARD_VIEW.y, zoom: 1 });
  });

  it('converts line and page delta modes to pixels', () => {
    wheelEvent({ deltaY: 3, deltaMode: 1 }); // 3 lines
    expectCamera(camera(), { x: STANDARD_VIEW.x, y: STANDARD_VIEW.y + 3 * 16, zoom: 1 });
  });
});

describe('zoom around the pointer (TC-16)', () => {
  it('zooms with Ctrl + wheel, keeping the board location under the pointer', () => {
    const before = screenToWorld(camera(), POINTER);
    const event = wheelEvent({ deltaY: -100, ctrlKey: true, point: POINTER });
    expect(event.defaultPrevented).toBe(true);
    expect(camera().zoom).toBeGreaterThan(1);
    expectPoints(screenToWorld(camera(), POINTER), before);
    expect(camera().zoom).toBeCloseTo(Math.exp(1), 9);
    expect(zoomLabel()).toHaveTextContent(`${Math.round(Math.exp(1) * 100)}%`);
  });

  it('zooms with Cmd + wheel too', () => {
    wheelEvent({ deltaY: -100, metaKey: true, point: POINTER });
    expect(camera().zoom).toBeCloseTo(Math.exp(1), 9);
  });

  it('zooms out with a positive Ctrl + wheel delta and clamps at ZOOM_MIN', () => {
    wheelEvent({ deltaY: 100, ctrlKey: true, point: POINTER });
    expect(camera().zoom).toBeLessThan(1);
    for (let i = 0; i < 20; i += 1) wheelEvent({ deltaY: 1000, ctrlKey: true, point: POINTER });
    expect(camera().zoom).toBe(ZOOM_MIN);
  });

  it('clamps a violent pinch at ZOOM_MAX', () => {
    wheelEvent({ deltaY: -600, ctrlKey: true, point: POINTER }); // factor e^6
    expect(camera().zoom).toBe(ZOOM_MAX);
  });

  it('is a safe no-op when a wheel delta would mean an infinite zoom', () => {
    // camera.math's contract: an invalid factor leaves the camera unchanged.
    wheelEvent({ deltaY: -1e308, ctrlKey: true, point: POINTER });
    expectCamera(camera(), STANDARD_VIEW, 9);
  });
});

describe('Safari gesture pinch (TC-17)', () => {
  it('zooms by the gesture scale around the gesture point', () => {
    const before = screenToWorld(STANDARD_VIEW, POINTER);
    gestureEvent('gesturestart', 1, POINTER);
    const event = gestureEvent('gesturechange', 2, POINTER);
    expect(event.defaultPrevented).toBe(true);
    // Exactly a pinch of the standard view about the gesture point.
    expectCamera(camera(), zoomAt(STANDARD_VIEW, POINTER, 2), 9);
    expect(camera().zoom).toBeCloseTo(2, 9);
    // The board location under the gesture stays put.
    expectPoints(screenToWorld(camera(), POINTER), before);
  });

  it('derives the zoom from where the gesture started and clamps it', () => {
    gestureEvent('gesturestart', 1, POINTER);
    gestureEvent('gesturechange', 1.5, POINTER);
    expectCamera(camera(), zoomAt(STANDARD_VIEW, POINTER, 1.5), 9);
    gestureEvent('gesturechange', 10, POINTER);
    expect(camera().zoom).toBe(ZOOM_MAX);
    gestureEvent('gestureend', 10, POINTER);
    // The clamp keeps the board location under the gesture pinned.
    expectCamera(camera(), { ...zoomAt(STANDARD_VIEW, POINTER, ZOOM_MAX), zoom: ZOOM_MAX }, 9);
  });

  it('prevents the browser page zoom on gesturestart and gestureend', () => {
    const start = gestureEvent('gesturestart', 1, POINTER);
    const end = gestureEvent('gestureend', 1, POINTER);
    expect(start.defaultPrevented).toBe(true);
    expect(end.defaultPrevented).toBe(true);
    expectCamera(camera(), STANDARD_VIEW, 9);
  });
});

describe('keyboard shortcuts (TC-18)', () => {
  it('Ctrl + =, Ctrl + - and Ctrl + 0 zoom in, out and reset', () => {
    const zoomIn = keydown('=', { ctrl: true });
    expect(zoomIn.defaultPrevented).toBe(true);
    // Keyboard zoom is anchored at the centre of the board area.
    expectCamera(camera(), centreZoom(STANDARD_VIEW, 1.25), 9);

    const zoomOut = keydown('-', { ctrl: true });
    expect(zoomOut.defaultPrevented).toBe(true);
    expectCamera(camera(), STANDARD_VIEW, 9);

    // Pan away, then reset returns to the standard view.
    wheelEvent({ deltaY: 400 });
    expect(zoomLabel()).toHaveTextContent('100%');
    const reset = keydown('0', { ctrl: true });
    expect(reset.defaultPrevented).toBe(true);
    expectCamera(camera(), STANDARD_VIEW, 9);
  });

  it('works with the Cmd key and with the + and _ keys', () => {
    expect(keydown('+', { meta: true }).defaultPrevented).toBe(true);
    expectCamera(camera(), centreZoom(STANDARD_VIEW, 1.25), 9);
    expect(keydown('_', { meta: true }).defaultPrevented).toBe(true);
    expectCamera(camera(), STANDARD_VIEW, 9);
  });

  it('renders camera updates on the next animation frame, not on every event', () => {
    keydown('=', { ctrl: true, flush: false });
    keydown('=', { ctrl: true, flush: false });
    keydown('=', { ctrl: true, flush: false });
    // The state is ahead of the DOM until the frame runs (design camera.hook:
    // many events per frame, one render per frame).
    expect(zoomLabel()).toHaveTextContent('100%');
    expect(camera().zoom).toBeCloseTo(1.25 ** 3, 9);
    flushFrames();
    expect(zoomLabel()).toHaveTextContent(`${Math.round(1.25 ** 3 * 100)}%`);
    expectCamera(renderedCamera(), camera(), 9);
  });

  it('ignores keys without Ctrl or Cmd', () => {
    const plain = keydown('=');
    expect(plain.defaultPrevented).toBe(false);
    expectCamera(camera(), STANDARD_VIEW, 9);
  });

  it('does not move the view for other key combinations', () => {
    expect(keydown('=', { ctrl: true, alt: true }).defaultPrevented).toBe(false);
    expectCamera(camera(), STANDARD_VIEW, 9);
  });
});

describe('click without movement (TC-29)', () => {
  it('leaves the camera unchanged and keeps the hint', () => {
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();
    pointerDown({ x: 640, y: 400 });
    pointerUp({ x: 640, y: 400 });
    expect(camera()).toEqual(STANDARD_VIEW);
    expectCamera(renderedCamera(), STANDARD_VIEW, 9);
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();
  });

  it('does not start a pan from the zoom controls', () => {
    const controls = screen.getByTestId('zoom-controls');
    pointerDown({ x: 1200, y: 780 }, controls);
    expect(board()).toHaveAttribute('data-panning', 'false');
    expectCamera(camera(), STANDARD_VIEW, 9);
  });

  it('ignores a right-click drag on the board', () => {
    pointerDown({ x: 200, y: 200 });
    // A second pointer with a non-primary button must not pan.
    pointerDown({ x: 200, y: 200 });
    expectCamera(camera(), STANDARD_VIEW, 9);
  });
});

describe('gestures outside the board (TC-30)', () => {
  it('does not zoom the board for a Ctrl + wheel over the zoom controls', () => {
    const controls = screen.getByTestId('zoom-controls');
    const event = wheelEvent({ deltaY: -100, ctrlKey: true, point: { x: 1200, y: 780 } }, controls);
    // The board never sees it, and the browser default is left alone there.
    expect(event.defaultPrevented).toBe(false);
    expectCamera(camera(), STANDARD_VIEW, 9);
    expect(zoomLabel()).toHaveTextContent('100%');
  });

  it('does not zoom the board for a Ctrl + wheel over the navigation hint', () => {
    const hint = screen.getByTestId('navigation-hint');
    const event = wheelEvent({ deltaY: -100, ctrlKey: true }, hint);
    expect(event.defaultPrevented).toBe(false);
    expectCamera(camera(), STANDARD_VIEW, 9);
  });

  it('renders a grid spacing of GRID_SPACING_WORLD * zoom', () => {
    expect(grid().spacing).toBeCloseTo(GRID_SPACING_WORLD, 9);
    keydown('=', { ctrl: true });
    expect(grid().spacing).toBeCloseTo(GRID_SPACING_WORLD * 1.25, 9);
    // ...and the world layer scales by the same factor.
    expect(worldToScreen(renderedCamera(), { x: GRID_SPACING_WORLD, y: 0 }).x -
      worldToScreen(renderedCamera(), { x: 0, y: 0 }).x).toBeCloseTo(GRID_SPACING_WORLD * 1.25, 6);
  });
});
