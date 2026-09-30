import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Board } from '../../src/client/board/Board';

/** A board id for the component under test; the fake provider never reaches a server. */
const BOARD_ID = 'component-board-under-test';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import {
  resetCamera,
  screenToWorld,
  worldToScreen,
  type Camera,
} from '../../src/client/canvas/camera';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import { ResizeObserverStub } from './setup';
import { dispatchGesture, dispatchPointer, dispatchWheel, VIEWPORT } from './helpers/events';

/** The camera as the board sees it, through the test-mode hook. */
const camera = (): Camera => {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hook not registered');
  return hooks.getCamera();
};

/** Camera updates are coalesced with requestAnimationFrame (fake timers). */
const flush = (): void => {
  act(() => {
    vi.advanceTimersByTime(64);
  });
};

const viewport = (): HTMLElement => screen.getByTestId('board-viewport');
const world = (): HTMLElement => screen.getByTestId('board-world');

const CENTRED: Camera = {
  x: -VIEWPORT.width / 2,
  y: -VIEWPORT.height / 2,
  zoom: 1,
};

beforeEach(() => {
  vi.useFakeTimers();
});

describe('pan by dragging (pan.drag)', () => {
  // TC-13: pointerdown / move(200,100) / up pans exactly, Idle -> Panning -> Idle.
  it('TC-13 moves the board exactly with the pointer and returns to idle', () => {
    render(<BoardViewport />);
    const start = camera();
    expect(start).toEqual(CENTRED);
    expect(viewport().dataset.state).toBe('idle');

    dispatchPointer(viewport(), 'pointerdown', 300, 200);
    expect(viewport().dataset.state).toBe('panning');

    dispatchPointer(viewport(), 'pointermove', 400, 250);
    flush();
    dispatchPointer(viewport(), 'pointermove', 500, 300);
    flush();
    dispatchPointer(viewport(), 'pointerup', 500, 300);
    flush();

    expect(viewport().dataset.state).toBe('idle');
    const after = camera();
    // The board moved with the pointer: camera x,y by -delta/zoom.
    expect(after.x).toBeCloseTo(start.x - 200, 9);
    expect(after.y).toBeCloseTo(start.y - 100, 9);
    // The world layer transform matches the camera.
    expect(world().style.transform).toBe(
      `scale(1) translate(${-after.x}px, ${-after.y}px)`,
    );
    // The grid dot the drag started on is 200px right and 100px down from where
    // it started (within 1px): jsdom has no layout, so the projection is what
    // the DOM transform is built from. Real pixels are asserted in e2e TC-23.
    const dot = { x: start.x + 300, y: start.y + 200 };
    expect(worldToScreen(after, dot).x - worldToScreen(start, dot).x).toBeCloseTo(200, 9);
    expect(worldToScreen(after, dot).y - worldToScreen(start, dot).y).toBeCloseTo(100, 9);
    // The grid repeats with the camera, so it never runs out.
    expect(viewport().style.backgroundSize).toBe(
      `${GRID_SPACING_WORLD * after.zoom}px ${GRID_SPACING_WORLD * after.zoom}px`,
    );
  });

  // TC-14: a pointercancel mid-drag freezes the camera; later moves are ignored.
  it('TC-14 ends the drag on pointercancel and ignores later moves', () => {
    render(<BoardViewport />);
    dispatchPointer(viewport(), 'pointerdown', 300, 200);
    dispatchPointer(viewport(), 'pointermove', 400, 200);
    flush();
    const atCancel = camera();
    expect(atCancel.x).toBeCloseTo(CENTRED.x - 100, 9);

    dispatchPointer(viewport(), 'pointercancel', 400, 200);
    flush();
    expect(camera()).toBe(atCancel);
    expect(viewport().dataset.state).toBe('idle');

    dispatchPointer(viewport(), 'pointermove', 900, 700);
    flush();
    expect(camera()).toBe(atCancel);
  });

  it('ends the drag on lostpointercapture', () => {
    render(<BoardViewport />);
    dispatchPointer(viewport(), 'pointerdown', 300, 200);
    dispatchPointer(viewport(), 'pointermove', 350, 200);
    flush();
    const atLost = camera();
    dispatchPointer(viewport(), 'lostpointercapture', 350, 200);
    flush();
    expect(viewport().dataset.state).toBe('idle');
    dispatchPointer(viewport(), 'pointermove', 900, 200);
    flush();
    expect(camera()).toBe(atLost);
  });

  // TC-29: a click without moving leaves the camera unchanged.
  it('TC-29 leaves the camera unchanged for a press without movement', () => {
    render(<Board boardId={BOARD_ID} />);
    const before = camera();
    dispatchPointer(viewport(), 'pointerdown', 300, 200);
    dispatchPointer(viewport(), 'pointerup', 300, 200);
    flush();
    expect(camera()).toBe(before);
    expect(viewport().dataset.state).toBe('idle');
    // The hint is not dismissed by a no-op camera update.
    expect(screen.getByTestId('navigation-hint')).not.toBeNull();
  });
});

describe('pan and zoom by wheel (pan.scroll, zoom.pointer)', () => {
  // TC-15: plain wheel deltaY +100 moves the camera y by 100/zoom and is prevented.
  it('TC-15 pans on a plain wheel and prevents the browser default', () => {
    render(<BoardViewport />);
    const event = dispatchWheel(viewport(), { deltaY: 100, clientX: 640, clientY: 400 });
    expect(event.defaultPrevented).toBe(true);
    flush();
    // Scrolling down moves content up: the camera looks further down the board.
    expect(camera().y).toBeCloseTo(CENTRED.y + 100, 9);
    expect(worldToScreen(camera(), { x: 0, y: 0 }).y).toBeCloseTo(
      worldToScreen(CENTRED, { x: 0, y: 0 }).y - 100,
      9,
    );
  });

  it('pans horizontally for a two-finger scroll right (content moves left)', () => {
    render(<BoardViewport />);
    dispatchWheel(viewport(), { deltaX: 50, clientX: 640, clientY: 400 });
    flush();
    expect(camera().x).toBeCloseTo(CENTRED.x + 50, 9);
    expect(worldToScreen(camera(), { x: 0, y: 0 }).x).toBeCloseTo(
      worldToScreen(CENTRED, { x: 0, y: 0 }).x - 50,
      9,
    );
  });

  it('converts line and page deltaMode to pixels', () => {
    render(<BoardViewport />);
    dispatchWheel(viewport(), { deltaY: 3, deltaMode: 1 });
    flush();
    const lines = camera();
    expect(lines.y).toBeCloseTo(CENTRED.y + 3 * 16, 9);
    dispatchWheel(viewport(), { deltaY: 1, deltaMode: 2 });
    flush();
    expect(camera().y).toBeCloseTo(lines.y + 800, 9);
  });

  // TC-16: Ctrl + wheel at a pointer zooms around it and is prevented.
  it('TC-16 zooms around the pointer on Ctrl + wheel and prevents the default', () => {
    render(<BoardViewport />);
    const before = camera();
    const pointer = { x: 300, y: 200 };
    const event = dispatchWheel(viewport(), {
      deltaY: -100,
      ctrlKey: true,
      clientX: pointer.x,
      clientY: pointer.y,
    });
    expect(event.defaultPrevented).toBe(true);
    flush();
    const after = camera();
    expect(after.zoom).toBeGreaterThan(before.zoom);
    // The world point under the pointer does not move.
    const beforePoint = screenToWorld(before, pointer);
    const afterPoint = screenToWorld(after, pointer);
    expect(afterPoint.x).toBeCloseTo(beforePoint.x, 6);
    expect(afterPoint.y).toBeCloseTo(beforePoint.y, 6);
  });

  it('pans (not zooms) on a plain wheel and zooms on metaKey too', () => {
    render(<BoardViewport />);
    const zoomBefore = camera().zoom;
    dispatchWheel(viewport(), { deltaY: -100 });
    flush();
    expect(camera().zoom).toBe(zoomBefore);
    dispatchWheel(viewport(), { deltaY: -100, metaKey: true });
    flush();
    expect(camera().zoom).toBeGreaterThan(zoomBefore);
  });

  it('does nothing at the zoom limit and re-enables on the way back', () => {
    render(<BoardViewport />);
    act(() => {
      window.__vidi6?.setCamera({ ...CENTRED, zoom: ZOOM_MAX });
    });
    flush();
    const atMax = camera();
    expect(atMax.zoom).toBe(ZOOM_MAX);
    dispatchWheel(viewport(), { deltaY: -500, ctrlKey: true, clientX: 640, clientY: 400 });
    flush();
    // Further zoom-in does nothing and does not trip the navigation latch.
    expect(camera()).toBe(atMax);
    dispatchWheel(viewport(), { deltaY: 100, ctrlKey: true, clientX: 640, clientY: 400 });
    flush();
    expect(camera().zoom).toBeLessThan(ZOOM_MAX);
  });

  // TC-17: a Safari gesturechange with scale 2 doubles the zoom and is prevented.
  it('TC-17 zooms by the Safari gesture scale and prevents page zoom', () => {
    render(<BoardViewport />);
    const event = dispatchGesture(viewport(), 'gesturechange', 2, 640, 400);
    expect(event.defaultPrevented).toBe(true);
    flush();
    expect(camera().zoom).toBeCloseTo(2, 9);
    // A further gesturechange reports a cumulative scale, so it composes.
    const next = dispatchGesture(viewport(), 'gesturechange', 3, 640, 400);
    expect(next.defaultPrevented).toBe(true);
    flush();
    expect(camera().zoom).toBeCloseTo(3, 9);
  });

  it('clamps a Safari gesture past ZOOM_MAX', () => {
    render(<BoardViewport />);
    dispatchGesture(viewport(), 'gesturestart', 1, 640, 400);
    dispatchGesture(viewport(), 'gesturechange', 100, 640, 400);
    flush();
    expect(camera().zoom).toBe(ZOOM_MAX);
  });
});

describe('keyboard shortcuts (zoom.step, view.reset)', () => {
  // TC-18: Ctrl/Cmd + = , Ctrl/Cmd + - and Ctrl/Cmd + 0, each prevented.
  it('TC-18 steps zoom with = and -, then resets with 0', () => {
    render(<BoardViewport />);
    expect(camera().zoom).toBe(1);

    const zoomedIn = fireEvent.keyDown(window, { key: '=', code: 'Equal', ctrlKey: true });
    expect(zoomedIn).toBe(false); // defaultPrevented, so the page does not zoom
    flush();
    expect(camera().zoom).toBe(ZOOM_STEP_FACTOR);

    const zoomedOut = fireEvent.keyDown(window, { key: '-', code: 'Minus', ctrlKey: true });
    expect(zoomedOut).toBe(false);
    flush();
    expect(camera().zoom).toBe(1);

    const reset = fireEvent.keyDown(window, { key: '0', code: 'Digit0', metaKey: true });
    expect(reset).toBe(false);
    flush();
    expect(camera()).toEqual(resetCamera(VIEWPORT));
  });

  it('ignores shortcuts without Ctrl or Cmd', () => {
    render(<BoardViewport />);
    const before = camera();
    fireEvent.keyDown(window, { key: '=' });
    fireEvent.keyDown(window, { key: '0' });
    flush();
    expect(camera()).toBe(before);
  });
});

describe('board ownership (zoom.no_page_zoom, TC-30)', () => {
  // TC-30: a Ctrl/Cmd wheel over the zoom control neither zooms the board nor
  // suppresses the browser default there.
  it('TC-30 leaves the camera alone for a Ctrl wheel over the zoom control', () => {
    render(<Board boardId={BOARD_ID} />);
    const before = camera();
    const controls = screen.getByTestId('zoom-controls');
    const event = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      clientX: 1200,
      clientY: 780,
      bubbles: true,
      cancelable: true,
    });
    controls.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    flush();
    expect(camera()).toBe(before);
  });
});

describe('far away (pan.unbounded)', () => {
  it('pans exactly one million world units from the start with the grid intact', () => {
    render(<BoardViewport />);
    const far: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT - VIEWPORT.width / 2,
      y: -UNBOUNDED_PAN_TESTED_EXTENT - VIEWPORT.height / 2,
      zoom: 1,
    };
    act(() => {
      window.__vidi6?.setCamera(far);
    });
    flush();
    expect(camera()).toEqual(far);
    expect(viewport().style.backgroundSize).toBe(
      `${GRID_SPACING_WORLD}px ${GRID_SPACING_WORLD}px`,
    );
    dispatchPointer(viewport(), 'pointerdown', 600, 300);
    dispatchPointer(viewport(), 'pointermove', 800, 400);
    dispatchPointer(viewport(), 'pointerup', 800, 400);
    flush();
    expect(camera().x).toBeCloseTo(far.x - 200, 6);
    expect(camera().y).toBeCloseTo(far.y - 100, 6);
    // Panning still follows the pointer exactly.
    expect(worldToScreen(camera(), { x: far.x, y: far.y }).x).toBeCloseTo(
      worldToScreen(far, { x: far.x, y: far.y }).x + 200,
      6,
    );
    expect(worldToScreen(camera(), { x: far.x, y: far.y }).y).toBeCloseTo(
      worldToScreen(far, { x: far.x, y: far.y }).y + 100,
      6,
    );
    // Reset view still returns to the standard view.
    fireEvent.keyDown(window, { key: '0', code: 'Digit0', ctrlKey: true });
    flush();
    expect(camera()).toEqual(resetCamera(VIEWPORT));
  });
});

describe('viewport resize', () => {
  it('leaves the camera unchanged when the viewport grows', () => {
    render(<BoardViewport />);
    const before = camera();
    expect(before).toEqual(CENTRED);
    ResizeObserverStub.resize(1920, 1080);
    flush();
    // The camera (world point at the top-left) is top-left anchored, so
    // resizing does not move content relative to the top-left corner.
    expect(camera()).toBe(before);
    expect(viewport().style.backgroundSize).toBe(
      `${GRID_SPACING_WORLD * before.zoom}px ${GRID_SPACING_WORLD * before.zoom}px`,
    );
  });
});
