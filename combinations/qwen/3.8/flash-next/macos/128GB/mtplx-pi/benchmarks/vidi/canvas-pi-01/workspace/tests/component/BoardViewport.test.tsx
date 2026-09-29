/**
 * Story 1 · task 6 — component tests for the viewport input surface
 * (TC-13 … TC-18, TC-29, TC-30 from the design's ui-component list).
 *
 * jsdom has no layout: instead of measuring pixels these tests assert the
 * DOM facts the renderer produces (the world layer transform and the camera
 * stamp) and the event-handling contract (preventDefault, state machine).
 * Real pixel alignment is covered by the Playwright suite.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BoardShell } from '../../src/client/App';
import type { Camera, Size } from '../../src/client/canvas/camera';
import { NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import { WHEEL_ZOOM_SENSITIVITY } from '../../src/shared/config';

const VIEWPORT: Size = { width: 800, height: 600 };

/** The standard view: world (0,0) centred in an 800x600 board area. */
const START: Camera = { x: -400, y: -300, zoom: 1 };

beforeEach(() => {
  cleanup();
});

function renderBoard(viewport: Size = VIEWPORT) {
  const utils = render(<BoardShell viewport={viewport} />);
  return {
    ...utils,
    surface: () => screen.getByTestId('board-viewport') as HTMLElement,
    world: () => screen.getByTestId('world-layer') as HTMLElement,
    camera: (): Camera => {
      const stamp = (screen.getByTestId('world-layer') as HTMLElement).dataset.camera;
      const [x, y, zoom] = (stamp ?? '').split(',').map(Number);
      return { x, y, zoom };
    },
  };
}

/** jsdom implements PointerEvent, but not pointer capture. */
function pointer(type: string, x: number, y: number): Event {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  Object.defineProperty(event, 'isPrimary', { value: true });
  return event;
}

const nextFrames = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('drag to pan (TC-13, TC-14, TC-29)', () => {
  it('TC-13: a drag moves the board by exactly the pointer delta and runs Idle -> Panning -> Idle', async () => {
    const board = renderBoard();
    const surface = board.surface();
    expect(board.camera()).toEqual(START);
    expect(surface.dataset.panning).toBe('false');

    fireEvent(surface, pointer('pointerdown', 400, 300));
    // State machine: a drag on empty board space is in the Panning state.
    expect(surface.dataset.panning).toBe('true');

    fireEvent(surface, pointer('pointermove', 600, 400));
    await waitFor(() => {
      expect(board.camera()).toEqual({ x: -600, y: -400, zoom: 1 });
    });
    // The world layer transform follows the camera: translate(-x, -y).
    expect(board.world().style.transform).toBe('scale(1) translate(600px, 400px)');
    // The grabbing-hand cursor is active while dragging.
    expect(surface.style.cursor).toBe('grabbing');

    fireEvent(surface, pointer('pointerup', 600, 400));
    expect(surface.dataset.panning).toBe('false');
    expect(surface.style.cursor).toBe('default');
    // No further change after the drag ended.
    expect(board.camera()).toEqual({ x: -600, y: -400, zoom: 1 });
  });

  it('TC-14: a cancelled drag freezes the camera and later moves are ignored', async () => {
    const board = renderBoard();
    const surface = board.surface();

    fireEvent(surface, pointer('pointerdown', 100, 100));
    fireEvent(surface, pointer('pointermove', 150, 140));
    await waitFor(() => {
      expect(board.camera()).toEqual({ x: -450, y: -340, zoom: 1 });
    });

    // The system interrupts the drag (alert, touch cancel, lost capture).
    fireEvent(surface, pointer('pointercancel', 150, 140));
    expect(surface.dataset.panning).toBe('false');

    // A move without a live drag must not move the board, however far.
    fireEvent(surface, pointer('pointermove', 900, 900));
    await nextFrames();
    expect(board.camera()).toEqual({ x: -450, y: -340, zoom: 1 });
  });

  it('TC-29: a click without movement leaves the camera and the hint alone', async () => {
    const board = renderBoard();
    const surface = board.surface();
    expect(screen.getByText(NAVIGATION_HINT_TEXT)).toBeTruthy();

    fireEvent(surface, pointer('pointerdown', 300, 300));
    fireEvent(surface, pointer('pointerup', 300, 300));
    await nextFrames();

    expect(board.camera()).toEqual(START);
    expect(screen.getByText(NAVIGATION_HINT_TEXT)).toBeTruthy();
  });
});

describe('wheel and gesture input (TC-15, TC-16, TC-17)', () => {
  it('TC-15: a plain scroll moves the board and prevents the page default', async () => {
    const board = renderBoard();
    const surface = board.surface();
    const before = board.camera();

    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: 0,
      deltaY: 100,
      deltaMode: 0,
      clientX: 400,
      clientY: 300,
    });
    fireEvent(surface, event);

    // Scrolling down moves the viewport down the board: camera y grows by
    // deltaY / zoom.
    await waitFor(() => {
      expect(board.camera().y).toBeCloseTo(before.y + 100, 6);
    });
    expect(board.camera().zoom).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('TC-16: Ctrl + wheel zooms around the pointer and prevents the page default', async () => {
    const board = renderBoard();
    const surface = board.surface();
    const pointer = { x: 300, y: 200 };
    const before = board.camera();
    const worldBefore = {
      x: pointer.x / before.zoom + before.x,
      y: pointer.y / before.zoom + before.y,
    };

    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: 0,
      deltaY: -100,
      deltaMode: 0,
      ctrlKey: true,
      clientX: pointer.x,
      clientY: pointer.y,
    });
    fireEvent(surface, event);

    const expectedZoom = Math.exp(100 * WHEEL_ZOOM_SENSITIVITY);
    await waitFor(() => {
      expect(board.camera().zoom).toBeCloseTo(expectedZoom, 6);
    });
    expect(event.defaultPrevented).toBe(true);

    // The world point that was under the pointer stayed under the pointer.
    const camera = board.camera();
    const worldAfter = {
      x: pointer.x / camera.zoom + camera.x,
      y: pointer.y / camera.zoom + camera.y,
    };
    expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(1e-6);
    expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(1e-6);
  });

  it('TC-17: a Safari gesturechange zooms by its scale ratio', async () => {
    const board = renderBoard();
    const surface = board.surface();

    const event = new Event('gesturechange', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'scale', { value: 2 });
    Object.defineProperty(event, 'clientX', { value: 400 });
    Object.defineProperty(event, 'clientY', { value: 300 });
    fireEvent(surface, event);

    await waitFor(() => {
      expect(board.camera().zoom).toBeCloseTo(2, 6);
    });
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('keyboard shortcuts (TC-18)', () => {
  function key(keyName: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key: keyName,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    return event;
  }

  it('Ctrl + = zooms in one step, Ctrl + - back out, Ctrl + 0 resets', async () => {
    const board = renderBoard();
    // Start somewhere else, so that "reset" is a real change to observe.
    const FAR: Camera = { x: 12345, y: -9876, zoom: 1 };
    window.__vidi6?.setCamera(FAR);
    await waitFor(() => {
      expect(board.camera()).toEqual(FAR);
    });

    const zoomIn = key('=');
    await waitFor(() => {
      expect(board.camera().zoom).toBe(1.25);
    });
    expect(zoomIn.defaultPrevented).toBe(true);

    const zoomOut = key('-');
    await waitFor(() => {
      expect(board.camera().zoom).toBe(1);
    });
    // Zooming in and out around the same anchor round-trips exactly.
    expect(board.camera()).toEqual(FAR);
    expect(zoomOut.defaultPrevented).toBe(true);

    const reset = key('0');
    await waitFor(() => {
      expect(board.camera()).toEqual(START);
    });
    expect(reset.defaultPrevented).toBe(true);
    // The starting point is centred: world (0,0) maps to the viewport centre.
    expect(board.world().style.transform).toBe('scale(1) translate(400px, 300px)');
  });

  it('ignores keys without Ctrl or Cmd', async () => {
    const board = renderBoard();
    const plain = new KeyboardEvent('keydown', { key: '=', bubbles: true, cancelable: true });
    window.dispatchEvent(plain);
    await nextFrames();
    expect(board.camera()).toEqual(START);
  });
});

describe('scope of board gestures (TC-30)', () => {
  it('Ctrl + wheel over the zoom control does not zoom the board', async () => {
    const board = renderBoard();
    const controls = screen.getByTestId('zoom-controls');

    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: -240,
      deltaMode: 0,
      ctrlKey: true,
    });
    fireEvent(controls, event);
    await nextFrames();

    // Outside the board the browser keeps its own behaviour: the event is not
    // cancelled, and the board camera never moved.
    expect(event.defaultPrevented).toBe(false);
    expect(board.camera()).toEqual(START);
  });
});
