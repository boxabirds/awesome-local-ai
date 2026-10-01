import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, type RenderResult } from '@testing-library/react';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { resetCamera, type Camera } from '../../src/client/canvas/camera';
import {
  GRID_SPACING_WORLD,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import { liveResizeObservers } from './setup';

/** Viewport size reported by the ResizeObserver stub. */
const SIZE = { width: 1200, height: 800 };

function renderBoard(): RenderResult {
  const result = render(<BoardViewport />);
  act(() => {
    vi.advanceTimersByTime(50);
  });
  return result;
}

function viewportEl(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

function worldEl(): HTMLElement {
  return screen.getByTestId('world-layer');
}

function readCamera(el = viewportEl()): Camera {
  return {
    x: Number(el.dataset.cameraX),
    y: Number(el.dataset.cameraY),
    zoom: Number(el.dataset.zoom),
  };
}

/** Flush the coalesced requestAnimationFrame camera render. */
/** Dispatch an event and let React process it. */
function dispatch(target: Element, event: Event): void {
  act(() => {
    target.dispatchEvent(event);
  });
}

function flush(): void {
  act(() => {
    vi.advanceTimersByTime(50);
  });
}

function pointerEvent(type: string, x: number, y: number): MouseEvent {
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

function wheelEvent(
  init: { deltaX?: number; deltaY?: number; deltaMode?: number; ctrlKey?: boolean; metaKey?: boolean; x?: number; y?: number },
): Event {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaX: init.deltaX ?? 0,
    deltaY: init.deltaY ?? 0,
    deltaMode: init.deltaMode ?? 0,
    ctrlKey: init.ctrlKey === true,
    metaKey: init.metaKey === true,
    clientX: init.x ?? 0,
    clientY: init.y ?? 0,
  });
  return event;
}

function gestureEvent(type: string, scale: number, x = 300, y = 200): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'scale', { value: scale });
  Object.defineProperty(event, 'rotation', { value: 0 });
  Object.defineProperty(event, 'clientX', { value: x });
  Object.defineProperty(event, 'clientY', { value: y });
  return event;
}

function keyEvent(key: string, init: { ctrlKey?: boolean; metaKey?: boolean } = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: init.ctrlKey === true,
    metaKey: init.metaKey === true,
  });
}

/** Parse `scale(z) translate(tx px, ty px)` into numbers. */
function parseWorldTransform(value: string): { zoom: number; tx: number; ty: number } {
  const match = /scale\(([-\d.e+]+)\)\s*translate\(([-\d.e+]+)px,\s*([-\d.e+]+)px\)/.exec(
    value.replace(/\s+/g, ' '),
  );
  if (!match) throw new Error(`unrecognised world transform: ${value}`);
  return { zoom: Number(match[1]), tx: Number(match[2]), ty: Number(match[3]) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BoardViewport drag to pan (pan.drag)', () => {
  it('TC-13 moves the board by the pointer delta and runs Idle -> Panning -> Idle', () => {
    renderBoard();
    const start = readCamera();
    expect(start).toEqual(resetCamera(SIZE));
    expect(viewportEl()).toHaveAttribute('data-panning', 'false');

    dispatch(viewportEl(), pointerEvent('pointerdown', 400, 300));
    expect(viewportEl()).toHaveAttribute('data-panning', 'true');

    dispatch(viewportEl(), pointerEvent('pointermove', 600, 400));
    flush();

    const during = readCamera();
    expect(during.x).toBeCloseTo(start.x - 200, 6);
    expect(during.y).toBeCloseTo(start.y - 100, 6);
    expect(during.zoom).toBeCloseTo(start.zoom, 9);

    // The world layer transform matches the camera: scale(zoom) translate(-x, -y)
    const t = parseWorldTransform(worldEl().style.transform);
    expect(t.zoom).toBeCloseTo(during.zoom, 9);
    expect(t.tx).toBeCloseTo(-during.x, 4);
    expect(t.ty).toBeCloseTo(-during.y, 4);

    dispatch(viewportEl(), pointerEvent('pointerup', 600, 400));
    expect(viewportEl()).toHaveAttribute('data-panning', 'false');

    // and moving the pointer afterwards does nothing
    dispatch(viewportEl(), pointerEvent('pointermove', 900, 900));
    flush();
    expect(readCamera()).toEqual(during);
  });

  it('TC-14 freezes the camera at pointercancel and ignores later moves', () => {
    renderBoard();
    dispatch(viewportEl(), pointerEvent('pointerdown', 100, 100));
    dispatch(viewportEl(), pointerEvent('pointermove', 200, 150));
    flush();
    const atCancel = readCamera();

    dispatch(viewportEl(), pointerEvent('pointercancel', 200, 150));
    expect(viewportEl()).toHaveAttribute('data-panning', 'false');

    dispatch(viewportEl(), pointerEvent('pointermove', 800, 700));
    flush();
    expect(readCamera()).toEqual(atCancel);
  });

  it('ends the drag when pointer capture is lost', () => {
    renderBoard();
    dispatch(viewportEl(), pointerEvent('pointerdown', 100, 100));
    dispatch(viewportEl(), pointerEvent('pointermove', 140, 140));
    flush();
    const atLoss = readCamera();

    dispatch(viewportEl(), pointerEvent('lostpointercapture', 140, 140));
    expect(viewportEl()).toHaveAttribute('data-panning', 'false');
    dispatch(viewportEl(), pointerEvent('pointermove', 900, 900));
    flush();
    expect(readCamera()).toEqual(atLoss);
  });

  it('TC-29 a click without movement leaves the camera and the hint alone', () => {
    renderBoard();
    const before = readCamera();
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();

    dispatch(viewportEl(), pointerEvent('pointerdown', 300, 300));
    dispatch(viewportEl(), pointerEvent('pointerup', 300, 300));
    flush();

    expect(readCamera()).toEqual(before);
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();
  });
});

describe('BoardViewport wheel input (pan.scroll, zoom.pointer)', () => {
  it('TC-15 pans with a plain wheel and prevents the browser default', () => {
    renderBoard();
    const before = readCamera();
    const event = wheelEvent({ deltaY: 100 });
    dispatch(viewportEl(), event);
    flush();

    const after = readCamera();
    expect(after.y).toBeCloseTo(before.y + 100 / before.zoom, 6);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.zoom).toBeCloseTo(before.zoom, 9);
    expect(event.defaultPrevented).toBe(true);
  });

  it('pans horizontally with a trackpad scroll and keeps the pointer invariant when zooming', () => {
    renderBoard();
    const before = readCamera();
    dispatch(viewportEl(), wheelEvent({ deltaX: 60 }));
    flush();
    const after = readCamera();
    expect(after.x).toBeCloseTo(before.x + 60 / before.zoom, 6);

    // convert the pointer world point before and after a Ctrl+wheel zoom
    const point = { x: 300, y: 200 };
    const worldBefore = {
      x: point.x / after.zoom + after.x,
      y: point.y / after.zoom + after.y,
    };
    dispatch(viewportEl(), wheelEvent({ deltaY: -50, ctrlKey: true, x: point.x, y: point.y }));
    flush();
    const zoomed = readCamera();
    expect(zoomed.zoom).toBeGreaterThan(after.zoom);
    expect(zoomed.x).toBeCloseTo(worldBefore.x - point.x / zoomed.zoom, 6);
    expect(zoomed.y).toBeCloseTo(worldBefore.y - point.y / zoomed.zoom, 6);
  });

  it('converts LINE and PAGE wheel deltas to pixels', () => {
    renderBoard();
    const before = readCamera();
    dispatch(viewportEl(), wheelEvent({ deltaY: 3, deltaMode: 1 }));
    flush();
    expect(readCamera().y).toBeCloseTo(before.y + 3 * 16, 6);

    const beforePage = readCamera();
    dispatch(viewportEl(), wheelEvent({ deltaY: 1, deltaMode: 2 }));
    flush();
    expect(readCamera().y).toBeCloseTo(beforePage.y + 800, 6);
  });

  it('TC-16 zooms with a Ctrl wheel and prevents page zoom', () => {
    renderBoard();
    const before = readCamera();
    const event = wheelEvent({ deltaY: -100, ctrlKey: true, x: 300, y: 200 });
    dispatch(viewportEl(), event);
    flush();

    const after = readCamera();
    expect(after.zoom).toBeGreaterThan(before.zoom);
    expect(event.defaultPrevented).toBe(true);
  });

  it('clamps wheel zoom to the limits', () => {
    renderBoard();
    for (let i = 0; i < 40; i += 1) {
      dispatch(viewportEl(), wheelEvent({ deltaY: -600, ctrlKey: true, x: 100, y: 100 }));
      flush();
    }
    expect(readCamera().zoom).toBe(ZOOM_MAX);
    for (let i = 0; i < 80; i += 1) {
      dispatch(viewportEl(), wheelEvent({ deltaY: 600, ctrlKey: true, x: 100, y: 100 }));
      flush();
    }
    expect(readCamera().zoom).toBe(ZOOM_MIN);
  });

  it('TC-17 doubles the zoom on a Safari gesturechange and prevents the default', () => {
    renderBoard();
    const before = readCamera();
    dispatch(viewportEl(), gestureEvent('gesturestart', 1));
    const change = gestureEvent('gesturechange', 2);
    dispatch(viewportEl(), change);
    flush();

    const after = readCamera();
    expect(after.zoom).toBeCloseTo(before.zoom * 2, 6);
    expect(change.defaultPrevented).toBe(true);
    expect(gestureEvent('gestureend', 2).type).toBe('gestureend');
  });
});

describe('BoardViewport keyboard shortcuts (zoom.step, view.reset)', () => {
  it('TC-18 Ctrl+= / Ctrl+- / Ctrl+0 zoom one step and reset', () => {
    renderBoard();
    // move away from the start so Reset view has something to do
    dispatch(viewportEl(), pointerEvent('pointerdown', 100, 100));
    dispatch(viewportEl(), pointerEvent('pointermove', 300, 250));
    dispatch(viewportEl(), pointerEvent('pointerup', 300, 250));
    flush();
    expect(readCamera().zoom).toBe(1);

    const plus = keyEvent('=', { ctrlKey: true });
    act(() => {
      window.dispatchEvent(plus);
    });
    flush();
    expect(readCamera().zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 9);
    expect(plus.defaultPrevented).toBe(true);

    const minus = keyEvent('-', { ctrlKey: true });
    act(() => {
      window.dispatchEvent(minus);
    });
    flush();
    expect(readCamera().zoom).toBe(1);
    expect(minus.defaultPrevented).toBe(true);

    const zero = keyEvent('0', { ctrlKey: true });
    act(() => {
      window.dispatchEvent(zero);
    });
    flush();
    expect(readCamera()).toEqual(resetCamera(SIZE));
    expect(zero.defaultPrevented).toBe(true);
  });

  it('also accepts the Cmd (meta) modifier', () => {
    renderBoard();
    act(() => {
      window.dispatchEvent(keyEvent('=', { metaKey: true }));
    });
    flush();
    expect(readCamera().zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 9);
  });

  it('leaves unrelated key presses alone', () => {
    renderBoard();
    const before = readCamera();
    const plain = keyEvent('=');
    act(() => {
      window.dispatchEvent(plain);
    });
    flush();
    expect(readCamera()).toEqual(before);
    expect(plain.defaultPrevented).toBe(false);
  });
});

describe('BoardViewport rendering (pan.unbounded, nav.hint)', () => {
  it('draws the dot grid attached to the board and moves it with pan and zoom', () => {
    renderBoard();
    const initial = readCamera();
    expect(viewportEl().style.backgroundSize).toBe(
      `${GRID_SPACING_WORLD * initial.zoom}px ${GRID_SPACING_WORLD * initial.zoom}px`,
    );

    act(() => {
      window.dispatchEvent(keyEvent('=', { ctrlKey: true }));
    });
    flush();
    const zoomed = readCamera();
    expect(viewportEl().style.backgroundSize).toBe(
      `${GRID_SPACING_WORLD * zoomed.zoom}px ${GRID_SPACING_WORLD * zoomed.zoom}px`,
    );
    // the grid is driven by the camera, so a pan changes its position
    const positionBefore = viewportEl().style.backgroundPosition;
    dispatch(viewportEl(), pointerEvent('pointerdown', 0, 0));
    dispatch(viewportEl(), pointerEvent('pointermove', 7, 0));
    dispatch(viewportEl(), pointerEvent('pointerup', 7, 0));
    flush();
    expect(viewportEl().style.backgroundPosition).not.toBe(positionBefore);
    // ...and stays within one tile, so far-away positions render crisply
    const [px, py] = viewportEl().style.backgroundPosition
      .split(' ')
      .map((value) => Number.parseFloat(value));
    const spacing = GRID_SPACING_WORLD * readCamera().zoom;
    expect(px).toBeGreaterThanOrEqual(0);
    expect(px).toBeLessThan(spacing);
    expect(py).toBeGreaterThanOrEqual(0);
    expect(py).toBeLessThan(spacing);
  });

  it('TC-22 / TC-29 hides the hint after the first camera change and keeps it hidden', () => {
    renderBoard();
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();

    dispatch(viewportEl(), wheelEvent({ deltaY: 10 }));
    flush();
    expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();

    dispatch(viewportEl(), wheelEvent({ deltaY: 10 }));
    flush();
    expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();
  });

  it('TC-30 a Ctrl wheel over the zoom control does not zoom the board', () => {
    renderBoard();
    const before = readCamera();
    const controls = screen.getByTestId('zoom-controls');
    const label = screen.getByTestId('zoom-label');
    expect(controls).toContainElement(label);
    const event = wheelEvent({ deltaY: -100, ctrlKey: true, x: 1000, y: 700 });
    dispatch(label, event);
    flush();

    expect(readCamera()).toEqual(before);
    expect(event.defaultPrevented).toBe(false);
  });

  it('TC-07 leaves the camera unchanged when the board area is resized', () => {
    renderBoard();
    const before = readCamera();

    act(() => {
      liveResizeObservers().forEach((observer) => observer.emit(1920, 1080));
    });
    flush();

    const after = readCamera();
    expect(after).toEqual(before);
  });

  it('renders children inside the world layer', () => {
    render(
      <BoardViewport>
        <div data-testid="child-object" className="board-object" style={{ left: 40, top: 60 }} />
      </BoardViewport>,
    );
    flush();
    expect(screen.getByTestId('child-object').parentElement).toBe(worldEl());
  });

  it('clamps the zoom at the limits and keeps the grid consistent', () => {
    renderBoard();
    expect(ZOOM_MIN).toBe(0.1);
    for (let i = 0; i < 30; i += 1) {
      act(() => {
        window.dispatchEvent(keyEvent('-', { ctrlKey: true }));
      });
      flush();
    }
    expect(readCamera().zoom).toBe(ZOOM_MIN);
    expect(viewportEl().style.backgroundSize).toBe(
      `${GRID_SPACING_WORLD * ZOOM_MIN}px ${GRID_SPACING_WORLD * ZOOM_MIN}px`,
    );
  });
});
