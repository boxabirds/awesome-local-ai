/**
 * The Pen tool, held on a real board and drawn with real pointer events (story 11).
 *
 * Everything asserted here is something a person would notice on the screen rather than a call
 * the code happens to make:
 *
 *  - **the line follows the pointer, and nothing of it has left the tab** (`pen.draw`,
 *    `pen.share`). The assertion that matters is the one about the *other* person: the document
 *    receives no update at all until the pointer is lifted, so what arrives at a colleague is one
 *    finished stroke and never the milliseconds on the way to it;
 *  - **the pen stays in hand** (`pen.stay_active`): after a stroke there is still a pen surface,
 *    and the next gesture draws without going back for the tool;
 *  - **a press that never travelled is a dot** (`pen.dot`), and **a pointer taken away mid-draw
 *    keeps its line** (`pen.interrupted`) — a browser that reclaimed the pointer is not a reason
 *    to lose something somebody drew;
 *  - **a line is stored as the shape it drew** (`pen.smooth`): every point the pointer passed is
 *    within the simplification tolerance of what is stored, at the zoom it was drawn at;
 *  - **a line too long to hold is split without a gap in it** (`pen.long_stroke`), which is
 *    asserted as geometry — the last point of one stroke *is* the first point of the next;
 *  - **the ink is chosen, not configured** (`pen.options`): colour and thickness apply to the
 *    next stroke only, change nothing on the board until one is drawn, and are gone when the pen
 *    is.
 *
 * Strokes are drawn on the real `BoardScreen`, so the routing that makes the pen a pen — the tool
 * button, the `P` key, the pen's own surface above every object — is on screen while it happens.
 */

import { act, cleanup, render, type RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardScreen } from '../../src/client/board/BoardScreen';
import { boardObjects, createSticky, type ObjectSnapshot } from '../../src/shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX
} from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { STROKE_OBJECT_TYPE, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { screenToWorld, worldToScreen } from '../../src/client/canvas/camera';
import {
    clickElement,
  fireKey,
  firePointer,
  fireWheel,
  flushCameraFrame,
  flushFrames,
  stubResizeObserver,
  stubViewportGeometry,
  testCamera,
  toolButton,
  toolPressed,
  viewportElement
} from './harness';

interface BoardFixture {
  doc: Y.Doc;
  root: HTMLElement;
  objects(): readonly ObjectSnapshot[];
}

beforeEach(() => {
  vi.useFakeTimers();
  stubViewportGeometry();
  stubResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderBoard(): Promise<BoardFixture> {
  const doc = new Y.Doc();
  const result: RenderResult = render(<BoardScreen doc={doc} />);
  await flushCameraFrame();
  return { doc, root: result.container, objects: () => boardObjects(doc) };
}

/** Count what the document is told, so "nothing has been shared" can be proved rather than hoped. */
function watchUpdates(board: BoardFixture): { count(): number } {
  let updates = 0;
  board.doc.on('update', () => {
    updates += 1;
  });
  return { count: () => updates };
}

function strokes(board: BoardFixture): StrokeSnap[] {
  return board.objects().filter((object) => object.type === STROKE_OBJECT_TYPE) as StrokeSnap[];
}

/** Put the pen in hand with the keyboard, the way a person with work to do does. */
function holdPen(board: BoardFixture): void {
  fireKey('p');
  expect(viewportElement(board.root).dataset.tool).toBe('pen');
  expect(toolPressed(toolButton(board.root, 'pen'))).toBe(true);
}

/** The pen's surface: in a browser, the only thing under the pointer while the pen is held. */
function penSurface(board: BoardFixture): HTMLElement {
  const element = board.root.querySelector<HTMLElement>('[data-vidi6="pen-tool"]');
  if (!element) throw new Error('the Pen tool is not being held');
  return element;
}

function penPreview(board: BoardFixture): SVGPathElement | null {
  return board.root.querySelector<SVGPathElement>('[data-vidi6="pen-preview"] path');
}

function pointerEvent(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    pointerId: 1,
    button: 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    isPrimary: true,
    pointerType: 'mouse'
  });
}

interface StrokeGesture {
  /** How the gesture ends. `nothing` leaves the line in the pen. */
  endAs?: 'pointerup' | 'pointercancel' | 'lostpointercapture' | 'nothing';
}

/** Press, drag through `points`, and end the gesture. One `act()` per event. */
async function draw(board: BoardFixture, points: Point[], gesture: StrokeGesture = {}): Promise<void> {
  const surface = penSurface(board);
  const first = points[0];
  if (!first) throw new Error('a gesture needs somewhere to start');
  firePointer(surface, 'pointerdown', first.x, first.y);
  for (const point of points.slice(1)) firePointer(surface, 'pointermove', point.x, point.y);
  await flushFrames();
  const endAs = gesture.endAs ?? 'pointerup';
  if (endAs === 'nothing') return;
  const last = points[points.length - 1] ?? first;
  firePointer(surface, endAs, last.x, last.y);
  await flushFrames();
}

/**
 * The same gesture fired in one `act()`.
 *
 * A stroke long enough to hit the point limit is thousands of pointer events, and wrapping each
 * one in `act()` would make this suite take longer than drawing by hand would.
 */
async function drawBulk(board: BoardFixture, points: Point[]): Promise<void> {
  const surface = penSurface(board);
  act(() => {
    const first = points[0];
    surface.dispatchEvent(pointerEvent('pointerdown', first.x, first.y));
    for (const point of points.slice(1)) surface.dispatchEvent(pointerEvent('pointermove', point.x, point.y));
    const last = points[points.length - 1];
    surface.dispatchEvent(pointerEvent('pointerup', last.x, last.y));
  });
  await flushFrames();
}

/**
 * A line a hand drew: two straight runs with a bend between them, and a tremor of less than a
 * pixel on top. The bend is the drawing; the tremor is what simplification is for (`pen.smooth`).
 */
function handLine(count = 60): Point[] {
  return Array.from({ length: count }, (_, index) => ({
    x: 100 + index * 5,
    y: (index < 30 ? 200 : 200 + (index - 30) * 4) + ((index % 3) - 1) * 0.4
  }));
}

/** A polyline across the board, waving up and down as it goes. */
function zigzag(count: number, step = 6, amplitude = 24): Point[] {
  return Array.from({ length: count }, (_, index) => ({
    x: 100 + index * step,
    y: 200 + (index % 2 === 0 ? 0 : amplitude)
  }));
}

describe('the Pen tool (pen.draw)', () => {
  it('P puts the pen in hand, and the board offers the pen toolbar while it is held', async () => {
    const board = await renderBoard();
    expect(board.root.querySelector('[data-vidi6="pen-toolbar"]')).toBeNull();

    holdPen(board);
    expect(penSurface(board)).toBeTruthy();
    expect(board.root.querySelector('[data-vidi6="pen-toolbar"]')).toBeTruthy();

    // Putting it down again: the surface and its options both go, and the board is normal.
    fireKey('v');
    expect(board.root.querySelector('[data-vidi6="pen-tool"]')).toBeNull();
    expect(board.root.querySelector('[data-vidi6="pen-toolbar"]')).toBeNull();
  });

  it('TC-09: a drag shows a line that follows the pointer and commits one stroke in the chosen ink when lifted, with no write before it', async () => {
    const board = await renderBoard();
    const updates = watchUpdates(board);
    holdPen(board);

    // Red and thick, as the design's case asks: the gesture below is made with an ink chosen from
    // the pen, so the stroke can be checked against the choice as well as against the pointer.
    clickElement(board.root.querySelector('[data-vidi6="pen-swatch"][data-color="red"]')!);
    clickElement(board.root.querySelector('[data-vidi6="pen-thickness"][data-thickness="thick"]')!);
    expect(updates.count()).toBe(0);

    const surface = penSurface(board);
    firePointer(surface, 'pointerdown', 100, 200);
    firePointer(surface, 'pointermove', 160, 140);
    firePointer(surface, 'pointermove', 220, 220);
    firePointer(surface, 'pointermove', 300, 160);
    await flushFrames();

    // The line is on the screen, where the pointer has been...
    const drawn = penPreview(board);
    expect(drawn).toBeTruthy();
    expect(drawn!.getAttribute('d')).toMatch(/^M\s*100\s+200/);
    expect(drawn!.getAttribute('d')).toContain('300');
    // ...and it is the only copy: nothing has gone to the document yet (`pen.share`).
    expect(updates.count()).toBe(0);
    expect(strokes(board)).toHaveLength(0);

    firePointer(surface, 'pointerup', 300, 160);
    await flushFrames();

    const [stroke] = strokes(board);
    expect(stroke).toBeTruthy();
    expect(stroke.type).toBe('stroke');
    expect(scaledPoints(stroke).length).toBeGreaterThan(2);
    expect(stroke.color).toBe('red');
    expect(stroke.thickness).toBe('thick');
    // The preview was a promise about the pointer; the pointer is gone, so it is gone.
    expect(board.root.querySelector('[data-vidi6="pen-preview"]')).toBeNull();
    expect(updates.count()).toBeGreaterThan(0);
    // And the pen is still in hand afterwards (`pen.stay_active`): a person sketching a whole
    // cluster is not sent back to the palette between two lines.
    expect(viewportElement(board.root).dataset.tool).toBe('pen');
    expect(toolPressed(toolButton(board.root, 'pen'))).toBe(true);
  });

  it('TC-13: Escape and V both put the pen down mid-draw and leave nothing behind, and neither spends the pen', async () => {
    const board = await renderBoard();
    const updates = watchUpdates(board);
    holdPen(board);

    await draw(board, zigzag(8));
    expect(strokes(board)).toHaveLength(1);
    // The tool did not go back to Select (`pen.stay_active`): the same surface is still there.
    expect(viewportElement(board.root).dataset.tool).toBe('pen');
    expect(toolPressed(toolButton(board.root, 'pen'))).toBe(true);

    // The next gesture draws, without asking for the pen again.
    await draw(board, [
      { x: 400, y: 100 },
      { x: 460, y: 160 },
      { x: 520, y: 100 }
    ]);
    expect(strokes(board)).toHaveLength(2);

    // Escape puts the pen down mid-draw — and the line in it goes nowhere.
    const before = updates.count();
    let surface = penSurface(board);
    firePointer(surface, 'pointerdown', 600, 600);
    firePointer(surface, 'pointermove', 700, 700);
    fireKey('Escape');
    await flushFrames();
    expect(board.root.querySelector('[data-vidi6="pen-tool"]')).toBeNull();
    expect(viewportElement(board.root).dataset.tool).toBe('select');
    expect(strokes(board)).toHaveLength(2);
    // The unfinished gesture wrote nothing of itself; only the unmount bookkeeping ran.
    expect(updates.count()).toBe(before);

    // The same story with V: the tool goes back to Select, and the half-line is thrown away
    // because the person who pressed V said they were not finished with the line by not lifting.
    holdPen(board);
    surface = penSurface(board);
    firePointer(surface, 'pointerdown', 620, 620);
    firePointer(surface, 'pointermove', 720, 720);
    fireKey('v');
    expect(board.root.querySelector('[data-vidi6="pen-tool"]')).toBeNull();
    expect(viewportElement(board.root).dataset.tool).toBe('select');
    expect(strokes(board)).toHaveLength(2);
    expect(updates.count()).toBe(before);
  });

  it('TC-10: a press that never travelled is one point, stored as a dot of the thickness', async () => {
    const board = await renderBoard();
    holdPen(board);

    // Less than the drag threshold, so it is a dot and not a very short line.
    await draw(board, [
      { x: 200, y: 200 },
      { x: 200 + DRAG_THRESHOLD_PX / 2, y: 200 }
    ]);

    const [dot] = strokes(board);
    expect(dot).toBeTruthy();
    // One point, stored flattened as the two numbers of it.
    expect(scaledPoints(dot)).toHaveLength(1);
    expect(dot.points).toHaveLength(2);
    // A dot still has a box, and its size is the thickness — which is what makes it visible.
    expect(dot.width).toBe(PEN_THICKNESS_WORLD[dot.thickness]);
    expect(dot.height).toBe(PEN_THICKNESS_WORLD[dot.thickness]);
  });

  it('TC-01: every point the pointer passed is within the tolerance of the stored path, at 100%', async () => {
    const board = await renderBoard();
    holdPen(board);

    const points = handLine(60);
    await draw(board, points);
    const [stroke] = strokes(board);
    expect(stroke).toBeTruthy();
    // The bend survives and the tremor does not: far fewer points than the pointer recorded, and
    // not so few that the line has become a straight one.
    const stored = scaledPoints(stroke);
    expect(stored.length).toBeGreaterThan(2);
    expect(stored.length).toBeLessThan(points.length / 5);

    const zoom = testCamera().zoom;
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / zoom;
    const world = points.map((point) => screenToWorld(testCamera(), point));
    for (const point of world) {
      expect(distanceToPolyline(scaledPoints(stroke), point)).toBeLessThanOrEqual(tolerance + 1e-6);
    }
  });

  it('TC-02: the tolerance is a screen measurement, so it is half as many board units at 200%', async () => {
    const board = await renderBoard();
    holdPen(board);

    // Zoom in, then draw: the same screen gesture covers half as much board, and the tolerance the
    // stroke is simplified at is half as many board units (`pen.smooth`).
    fireWheel(viewportElement(board.root), 640, 400, 0, -240, { ctrlKey: true });
    await flushCameraFrame();
    const zoom = testCamera().zoom;
    expect(zoom).toBeGreaterThan(1.2);

    const points = zigzag(30, 6, 6);
    await draw(board, points);
    const [stroke] = strokes(board);
    const world = points.map((point) => screenToWorld(testCamera(), point));
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / zoom;
    for (const point of world) {
      expect(distanceToPolyline(scaledPoints(stroke), point)).toBeLessThanOrEqual(tolerance + 1e-6);
    }
    // A stroke drawn at 200% holds detail the same drawing at 100% would not have kept: measured
    // on the board, the tolerance it was held to is smaller by the zoom.
    expect(tolerance).toBeLessThan(STROKE_SIMPLIFY_TOLERANCE_PX);
  });

  it('TC-12: a line longer than the point limit is committed as several strokes that join without a gap', async () => {
    const board = await renderBoard();
    holdPen(board);

    // One point past the limit, in one continuous gesture.
    const points = Array.from({ length: STROKE_MAX_POINTS + 100 }, (_, index) => ({
      x: 100 + index,
      y: 200 + (index % 7) * 0.5
    }));
    await drawBulk(board, points);

    const committed = strokes(board);
    expect(committed.length).toBeGreaterThanOrEqual(2);
    for (const stroke of committed) {
      const held = scaledPoints(stroke).length;
      expect(held).toBeGreaterThan(1);
      expect(held).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    }

    // Where one stroke ends the next begins — the same board point, held by both, which is what
    // "no gap and no overlap" means when it is drawn (`pen.long_stroke`).
    const ordered = [...committed].sort((a, b) => a.x - b.x);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      const previousPoints = scaledPoints(previous);
      const currentPoints = scaledPoints(current);
      const end = previousPoints[previousPoints.length - 1];
      const start = currentPoints[0];
      // `scaledPoints` already lands them on the board, so this compares the places themselves.
      expect(start.x).toBeCloseTo(end.x, 3);
      expect(start.y).toBeCloseTo(end.y, 3);
    }
  });

  it('TC-11: a pointer taken away mid-draw keeps the points already drawn, and the release that follows writes nothing', async () => {
    const board = await renderBoard();
    holdPen(board);

    const points = [
      { x: 100, y: 100 },
      { x: 160, y: 160 },
      { x: 220, y: 120 }
    ];
    await draw(board, points, { endAs: 'lostpointercapture' });
    expect(strokes(board)).toHaveLength(1);

    // The system cancelling the gesture is the same kindness, not a lost drawing.
    await draw(board, [
      { x: 300, y: 300 },
      { x: 360, y: 260 },
      { x: 420, y: 320 }
    ], { endAs: 'pointercancel' });
    expect(strokes(board)).toHaveLength(2);

    // A release that arrives after the capture was lost does not commit the same line twice.
    const surface = penSurface(board);
    firePointer(surface, 'pointerdown', 500, 500);
    firePointer(surface, 'pointermove', 560, 560);
    firePointer(surface, 'lostpointercapture', 560, 560);
    firePointer(surface, 'pointerup', 560, 560);
    expect(strokes(board)).toHaveLength(3);
  });

  it('TC-19: a drag that starts on top of a note draws over it and leaves the note where it was', async () => {
    const board = await renderBoard();
    let noteId = '';
    const centreWorld = { x: 300, y: 300 };
    act(() => {
      noteId = createSticky(board.doc, centreWorld);
    });
    await flushFrames();
    const noteBefore = board.objects().find((object) => object.id === noteId);
    if (!noteBefore) throw new Error('the note did not arrive on the board');
    const position = { x: noteBefore.x, y: noteBefore.y };

    holdPen(board);
    // The press lands squarely in the middle of the note, in board terms.
    const centre = worldToScreen(testCamera(), centreWorld);
    await draw(board, [
      { x: centre.x - 60, y: centre.y - 40 },
      { x: centre.x, y: centre.y + 20 },
      { x: centre.x + 60, y: centre.y - 20 }
    ]);

    expect(strokes(board)).toHaveLength(1);
    const noteAfter = board.objects().find((object) => object.id === noteId);
    expect(noteAfter?.x).toBe(position.x);
    expect(noteAfter?.y).toBe(position.y);

    // And navigating is untouched while the pen is held: the wheel is not the pen's. A plain wheel
    // pans, in both axes, and the drawing under it goes with the board (`pen.navigation`).
    const pannedFrom = { x: testCamera().x, y: testCamera().y };
    fireWheel(penSurface(board), 640, 400, -120, -80);
    await flushCameraFrame();
    expect(testCamera().x).not.toBe(pannedFrom.x);
    expect(testCamera().y).not.toBe(pannedFrom.y);
    expect(testCamera().zoom).toBe(1);
    const zoomedFrom = testCamera().zoom;
    fireWheel(penSurface(board), 640, 400, 0, -240, { ctrlKey: true });
    await flushCameraFrame();
    expect(testCamera().zoom).toBeGreaterThan(zoomedFrom);
  });
});

describe('what the pen says about itself (accessibility)', () => {
  it('the pen, its six inks and its three thicknesses have names, and a stroke is announced as a drawing', async () => {
    const board = await renderBoard();
    holdPen(board);

    // The tool itself: named, and marked as the tool in hand.
    const pen = toolButton(board.root, 'pen');
    expect(pen.getAttribute('aria-label')).toContain('Pen');
    expect(pen.getAttribute('aria-pressed')).toBe('true');

    // Six inks and three thicknesses, each said out loud, each saying whether it is the one.
    const toolbar = board.root.querySelector<HTMLElement>('[data-vidi6="pen-toolbar"]')!;
    expect(toolbar.getAttribute('role')).toBe('toolbar');
    expect(toolbar.getAttribute('aria-label')).toBe('Pen options');
    const swatches = Array.from(toolbar.querySelectorAll<HTMLElement>('[data-vidi6="pen-swatch"]'));
    const thicknesses = Array.from(toolbar.querySelectorAll<HTMLElement>('[data-vidi6="pen-thickness"]'));
    expect(swatches).toHaveLength(Object.keys(PEN_COLORS).length);
    expect(thicknesses).toHaveLength(3);
    const spoken = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);
    for (const swatch of swatches) {
      expect(swatch.getAttribute('aria-label')).toBe(`${spoken(swatch.dataset.color ?? '')} pen`);
      expect(swatch.getAttribute('aria-pressed')).toBe(swatch.dataset.color === 'black' ? 'true' : 'false');
    }
    for (const button of thicknesses) {
      expect(button.getAttribute('aria-label')).toBe(spoken(button.dataset.thickness ?? ''));
      expect(button.getAttribute('aria-pressed')).toBe(button.dataset.thickness === 'medium' ? 'true' : 'false');
    }

    // A stroke on the board is announced for what it is: a drawing, not a note, not a shape.
    await draw(board, zigzag(8));
    const stroke = board.root.querySelector<HTMLElement>('[data-vidi6="stroke"]');
    expect(stroke?.getAttribute('role')).toBe('img');
    expect(stroke?.getAttribute('aria-label')).toBe('Drawing');
  });

  it('the round cursor is the thickness the pen is set to, at the zoom the board is at', async () => {
    const board = await renderBoard();
    holdPen(board);
    const surface = penSurface(board);
    firePointer(surface, 'pointermove', 300, 300);
    await flushFrames();

    const cursor = board.root.querySelector<HTMLElement>('[data-vidi6="pen-cursor"]');
    expect(cursor).toBeTruthy();
    // The thickness is a board measurement, so on screen it is the thickness times the zoom.
    expect(cursor!.style.width).toBe(`${PEN_THICKNESS_WORLD.medium * testCamera().zoom}px`);
    expect(cursor!.style.height).toBe(`${PEN_THICKNESS_WORLD.medium * testCamera().zoom}px`);

    // A thicker pen, and a closer look: the circle answers to both.
    clickElement(board.root.querySelector('[data-vidi6="pen-thickness"][data-thickness="thick"]')!);
    firePointer(surface, 'pointermove', 320, 320);
    await flushFrames();
    expect(board.root.querySelector<HTMLElement>('[data-vidi6="pen-cursor"]')!.style.width).toBe(
      `${PEN_THICKNESS_WORLD.thick * testCamera().zoom}px`
    );

    fireWheel(viewportElement(board.root), 640, 400, 0, -240, { ctrlKey: true });
    await flushCameraFrame();
    firePointer(surface, 'pointermove', 340, 340);
    await flushFrames();
    const zoom = testCamera().zoom;
    expect(zoom).toBeGreaterThan(1);
    expect(board.root.querySelector<HTMLElement>('[data-vidi6="pen-cursor"]')!.style.width).toBe(
      `${PEN_THICKNESS_WORLD.thick * zoom}px`
    );
  });
});

describe('one undo step per stroke', () => {
  it('Ctrl+Z takes back the last line only, and puts it back again', async () => {
    const board = await renderBoard();
    holdPen(board);

    await draw(board, zigzag(8));
    await draw(board, [
      { x: 500, y: 120 },
      { x: 560, y: 180 },
      { x: 620, y: 120 }
    ]);
    expect(strokes(board)).toHaveLength(2);

    // One keystroke, one line: the gesture was one step, not one step per pointer sample
    // (story 8's undo, from the constraint that each finished stroke is one undo step).
    fireKey('z', { ctrlKey: true });
    await flushFrames();
    expect(strokes(board)).toHaveLength(1);
    fireKey('z', { ctrlKey: true });
    await flushFrames();
    expect(strokes(board)).toHaveLength(0);
    fireKey('z', { ctrlKey: true, shiftKey: true });
    await flushFrames();
    expect(strokes(board)).toHaveLength(1);
  });

  it('a split long stroke undoes as the parts it was made of', async () => {
    const board = await renderBoard();
    holdPen(board);

    await drawBulk(
      board,
      Array.from({ length: STROKE_MAX_POINTS + 60 }, (_, index) => ({
        x: 100 + index,
        y: 200 + (index % 5) * 0.5
      }))
    );
    const parts = strokes(board).length;
    expect(parts).toBeGreaterThanOrEqual(2);

    // Each part was finished separately, so each is its own step: undo takes one away, not all.
    fireKey('z', { ctrlKey: true });
    await flushFrames();
    expect(strokes(board)).toHaveLength(parts - 1);
  });
});

describe('the pen toolbar (pen.options)', () => {
  it('TC-14: defaults are offered before anything is drawn, and a swatch changes the next stroke only', async () => {
    const board = await renderBoard();
    const updates = watchUpdates(board);
    holdPen(board);

    const toolbar = board.root.querySelector<HTMLElement>('[data-vidi6="pen-toolbar"]')!;
    expect(toolbar.dataset.color).toBe('black');
    expect(toolbar.dataset.thickness).toBe('medium');
    expect(toolbar.querySelector('[data-vidi6="pen-swatch"][data-color="black"]')?.getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(toolbar.querySelector('[data-vidi6="pen-thickness"][data-thickness="thin"]')?.getAttribute('aria-pressed')).toBe(
      'false'
    );

    // Choosing is not writing: this tab's pen has changed, and the board has not heard about it.
    const before = updates.count();
    clickElement(toolbar.querySelector('[data-vidi6="pen-swatch"][data-color="red"]')!);
    clickElement(toolbar.querySelector('[data-vidi6="pen-thickness"][data-thickness="thick"]')!);
    expect(updates.count()).toBe(before);
    expect(toolbar.dataset.color).toBe('red');
    expect(toolbar.dataset.thickness).toBe('thick');

    await draw(board, zigzag(10));
    const [stroke] = strokes(board);
    expect(stroke.color).toBe('red');
    expect(stroke.thickness).toBe('thick');

    // A different ink for the next line: the stroke already on the board keeps what it was drawn
    // with, because the pen's settings belong to the pen and not to the drawing.
    clickElement(board.root.querySelector('[data-vidi6="pen-swatch"][data-color="blue"]')!);
    await draw(board, zigzag(6, 40));
    const red = strokes(board).find((stroke) => stroke.color === 'red');
    const blue = strokes(board).find((stroke) => stroke.color === 'blue');
    expect(red?.thickness).toBe('thick');
    expect(blue?.color).toBe('blue');

    // Put the pen down and its options go with it; pick it up and this tab's pen is as left.
    fireKey('v');
    expect(board.root.querySelector('[data-vidi6="pen-toolbar"]')).toBeNull();
    holdPen(board);
    expect(board.root.querySelector<HTMLElement>('[data-vidi6="pen-toolbar"]')?.dataset.color).toBe('blue');
  });
});

