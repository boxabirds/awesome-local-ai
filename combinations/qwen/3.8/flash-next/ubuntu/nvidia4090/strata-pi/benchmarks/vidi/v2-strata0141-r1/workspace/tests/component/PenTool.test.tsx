import { fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_MAX_POINTS } from '../../src/shared/config';
import {
  activeTool,
  boardElement,
  createNote,
  dispatchWheel,
  docStrokes,
  flushFrame,
  noteOf,
  penClick,
  penColorButton,
  penCursorElement,
  penDrag,
  penDragThrough,
  penPreviewElement,
  penPreviewPathData,
  penThicknessButton,
  penToolbarElement,
  pressKeys,
  pressPenTool,
  renderBoard,
  selectionCount,
  strokeElements,
  strokeOf,
  strokeWorldPoints,
  noteElement,
  toolPressed,
  worldOf,
  readCamera,
} from './harness';
import { longSpiral, underlinePath } from '../fixtures/pen-paths';

/**
 * Story 11 task 5 (`pen.tool`): TC-09 to TC-14.
 *
 * A whole board is rendered with a real Y.Doc, and the pen is driven with synthetic
 * pointer events exactly as a browser delivers them - the Pen tool listens on
 * `window` in front of the board, so a press on the board element is enough to start
 * a stroke. What is asserted is the tool's own behaviour: what it commits, what it
 * leaves alone, what it shows only to the person drawing, and what it does to the
 * tool afterwards.
 *
 * At zoom 1 the board's camera is the identity, so a screen coordinate *is* a world
 * coordinate here; `worldOf` converts the ones that are not.
 */

describe('Pen tool (`pen.draw`, `pen.options`, `pen.stay_active`)', () => {
  let doc: Y.Doc;

  beforeEach(async () => {
    doc = new Y.Doc();
    renderBoard({ doc });
    await flushFrame();
    pressPenTool();
    await flushFrame();
  });

  it('TC-09: a drag with red and thick chosen commits one stroke in them, and the pen stays in hand', async () => {
    expect(activeTool()).toBe('pen');
    expect(toolPressed('pen')).toBe(true);

    fireEvent.click(penColorButton('red'));
    fireEvent.click(penThicknessButton('thick'));
    await flushFrame();

    const path = underlinePath(); // a handwritten line, ~120 points, screen space
    penDragThrough(path);
    await flushFrame();

    const strokes = docStrokes(doc);
    expect(strokes).toHaveLength(1);
    const stroke = strokes[0]!;
    expect(stroke.type).toBe('stroke');
    expect(stroke.color).toBe('red');
    expect(stroke.thickness).toBe('thick');
    expect(stroke.createdBy).not.toBe('');
    // The line it recorded is the drag that made it: it starts where the pen was
    // pressed and ends where it was lifted, in board coordinates.
    const points = strokeWorldPoints(stroke);
    expect(points.length).toBeGreaterThan(2);
    expect(points.length).toBeLessThan(path.length);
    expect(points[0]!.x).toBeCloseTo(worldOf(path[0]!).x, 6);
    expect(points[0]!.y).toBeCloseTo(worldOf(path[0]!).y, 6);
    const lastScreen = path[path.length - 1]!;
    const lastPoint = points[points.length - 1]!;
    expect(lastPoint.x).toBeCloseTo(worldOf(lastScreen).x, 6);
    expect(lastPoint.y).toBeCloseTo(worldOf(lastScreen).y, 6);

    // `pen.stay_active`: the pen is still the tool in hand, so the next drag draws
    // too, and nothing was selected on the way.
    expect(activeTool()).toBe('pen');
    expect(toolPressed('pen')).toBe(true);
    expect(selectionCount()).toBe(0);
  });

  it('a stroke is chosen before it is drawn and kept afterwards: the pen toolbar is the pen only', async () => {
    expect(penToolbarElement()).not.toBeNull();

    pressKeys('v');
    await flushFrame();

    expect(activeTool()).toBe('select');
    expect(penToolbarElement()).toBeNull();
  });

  it('the line being drawn is shown only to the person drawing it (`pen.share`, `pen.draw`)', async () => {
    const from = { x: 120, y: 120 };
    const mid = { x: 220, y: 180 };
    pointerEventsDown(from);
    pointerEventMove(mid);
    await flushFrame();

    const preview = penPreviewElement();
    expect(preview).not.toBeNull();
    const d = penPreviewPathData();
    expect(d).not.toBeNull();
    expect(d!.startsWith('M')).toBe(true);
    expect(d).toContain(String(mid.x));
    // As wide on screen as the stroke will be at this zoom.
    expect(preview!.getAttribute('stroke-width')).toBe(
      String(PEN_THICKNESS_WORLD.medium * 1),
    );
    // And nothing has been written yet: the stroke is finished on release, not while
    // it is being drawn.
    expect(docStrokes(doc)).toHaveLength(0);

    pointerEventUp({ x: 260, y: 220 });
    await flushFrame();

    expect(penPreviewElement()).toBeNull();
    expect(docStrokes(doc)).toHaveLength(1);
  });

  it('the pen tip is a round cursor the size of the thickness at this zoom (`pen.cursor`)', async () => {
    fireEvent.click(penThicknessButton('thick'));
    await flushFrame();

    pointerEventsDown({ x: 300, y: 300 });
    await flushFrame();

    const cursor = penCursorElement();
    expect(cursor).not.toBeNull();
    const size = PEN_THICKNESS_WORLD.thick;
    expect(cursor!.style.width).toBe(`${size}px`);
    expect(cursor!.style.height).toBe(`${size}px`);
    expect(cursor!.getAttribute('class')).toContain('pen-cursor');
    expect(cursor!.getAttribute('data-thickness')).toBe('thick');
    pointerEventUp({ x: 300, y: 300 });
  });

  it('TC-10: a press and release without movement draws one round dot', async () => {
    const at = { x: 400, y: 300 };
    penClick(at);
    await flushFrame();

    const strokes = docStrokes(doc);
    expect(strokes).toHaveLength(1);
    const stroke = strokes[0]!;
    const thickness = PEN_THICKNESS_WORLD[stroke.thickness];
    // A dot is the thickness square it is painted as, with the point in its middle.
    expect(stroke.width).toBe(thickness);
    expect(stroke.height).toBe(thickness);
    expect(stroke.points).toHaveLength(2);
    expect(stroke.points[0]).toBeCloseTo(thickness / 2, 9);
    expect(strokeWorldPoints(stroke)).toHaveLength(1);
    expect(strokeWorldPoints(stroke)[0]!.x).toBeCloseTo(worldOf(at).x, 9);
    expect(strokeWorldPoints(stroke)[0]!.y).toBeCloseTo(worldOf(at).y, 9);
    expect(activeTool()).toBe('pen');
  });

  it('TC-11: a drag that is cancelled keeps the points it has', async () => {
    const start = { x: 100, y: 500 };
    pointerEventsDown(start);
    for (let step = 1; step <= 6; step += 1) {
      pointerEventMove({ x: 100 + step * 30, y: 500 + step * 10 });
    }
    pointerEventCancel({ x: 280, y: 560 });
    await flushFrame();

    const strokes = docStrokes(doc);
    expect(strokes).toHaveLength(1);
    const points = strokeWorldPoints(strokes[0]!);
    expect(points[0]!.x).toBeCloseTo(worldOf(start).x, 6);
    expect(points[0]!.y).toBeCloseTo(worldOf(start).y, 6);
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(penPreviewElement()).toBeNull();
    expect(activeTool()).toBe('pen');
  });

  it('TC-12: reaching STROKE_MAX_POINTS commits a part and continues from its last point (`pen.long_stroke`)', async () => {
    const path = longSpiral(); // 5,010 points
    expect(path.length).toBe(STROKE_MAX_POINTS + 10);

    penDragThrough(path);
    await flushFrame();

    const strokes = docStrokes(doc);
    expect(strokes).toHaveLength(2);

    const first = strokeWorldPoints(strokes[0]!);
    const second = strokeWorldPoints(strokes[1]!);
    // The join: the second stroke starts exactly where the first ended, so the two
    // drawn one after the other meet with no gap.
    expect(second[0]!.x).toBeCloseTo(first[first.length - 1]!.x, 6);
    expect(second[0]!.y).toBeCloseTo(first[first.length - 1]!.y, 6);
    // The first part holds the limit's worth of points, the second the rest.
    expect(first.length).toBeGreaterThan(100);
    expect(second.length).toBeGreaterThanOrEqual(2);
    expect(second.length).toBeLessThan(20);
    expect(strokes.map((stroke) => stroke.z)).toEqual([1, 2]);
  });

  it('TC-13: Escape, or V, drops the pen and creates nothing', async () => {
    pointerEventsDown({ x: 150, y: 150 });
    for (let step = 1; step <= 5; step += 1) {
      pointerEventMove({ x: 150 + step * 20, y: 150 + step * 12 });
    }
    pressKeys('Escape');
    await flushFrame();
    pointerEventUp({ x: 250, y: 210 });
    await flushFrame();

    expect(activeTool()).toBe('select');
    expect(docStrokes(doc)).toHaveLength(0);
    expect(penPreviewElement()).toBeNull();

    // And the letter that picks the Select tool does the same.
    pressPenTool();
    await flushFrame();
    expect(activeTool()).toBe('pen');
    pressKeys('v');
    await flushFrame();
    expect(activeTool()).toBe('select');
    expect(docStrokes(doc)).toHaveLength(0);
  });

  it('TC-14: changing the colour leaves the stroke that exists exactly as it is', async () => {
    penDrag({ x: 100, y: 100 }, { x: 200, y: 160 }, 4);
    await flushFrame();
    const first = docStrokes(doc)[0]!;
    expect(first.color).toBe('black');
    expect(first.thickness).toBe('medium');
    expect(strokeElements()).toHaveLength(1);
    expect(screen.getByTestId(`stroke-line-${first.id}`).getAttribute('stroke')).toBe(
      PEN_COLORS.black,
    );

    fireEvent.click(penColorButton('purple'));
    fireEvent.click(penThicknessButton('thin'));
    await flushFrame();

    // Nothing was rewritten: the option is a setting for the next stroke only.
    expect(strokeOf(doc, first.id).color).toBe('black');
    expect(strokeOf(doc, first.id).thickness).toBe('medium');
    expect(screen.getByTestId(`stroke-line-${first.id}`).getAttribute('stroke')).toBe(
      PEN_COLORS.black,
    );

    penDrag({ x: 300, y: 100 }, { x: 400, y: 160 }, 4);
    await flushFrame();

    const strokes = docStrokes(doc);
    expect(strokes).toHaveLength(2);
    const second = strokes.find((stroke) => stroke.id !== first.id)!;
    expect(second.color).toBe('purple');
    expect(second.thickness).toBe('thin');
  });

  it('the pen draws over a sticky note without moving it (`pen.over_objects`)', async () => {
    // A note sitting under the drag, in board coordinates at this camera.
    const stickyId = createNote(doc, worldOf({ x: 380, y: 350 }));
    await flushFrame();
    const before = noteOf(doc, stickyId);
    expect(noteElement(stickyId)).not.toBeNull();

    penDrag({ x: 250, y: 250 }, { x: 520, y: 460 }, 8);
    await flushFrame();

    const after = noteOf(doc, stickyId);
    expect({ x: after.x, y: after.y, width: after.width, height: after.height }).toEqual({
      x: before.x,
      y: before.y,
      width: before.width,
      height: before.height,
    });
    expect(docStrokes(doc)).toHaveLength(1);
    expect(activeTool()).toBe('pen');
    expect(selectionCount()).toBe(0);
  });

  it('a press on the pen toolbar is a choice, not the start of a stroke', async () => {
    const toolbar = penToolbarElement();
    expect(toolbar).not.toBeNull();

    fireEvent.pointerDown(toolbar!, { clientX: 20, clientY: 20, pointerId: 3, button: 0 });
    fireEvent.pointerMove(toolbar!, { clientX: 120, clientY: 90, pointerId: 3, button: 0 });
    fireEvent.pointerUp(toolbar!, { clientX: 120, clientY: 90, pointerId: 3, button: 0 });
    await flushFrame();

    expect(docStrokes(doc)).toHaveLength(0);
    expect(penPreviewElement()).toBeNull();
  });

  it('a recorded handwritten path becomes one stroke that keeps its shape', async () => {
    const path = underlinePath(); // ~120 points, screen coordinates at zoom 1
    penDragThrough(path);
    await flushFrame();

    const strokes = docStrokes(doc);
    expect(strokes).toHaveLength(1);
    const points = strokeWorldPoints(strokes[0]!);
    expect(points[0]!.x).toBeCloseTo(worldOf(path[0]!).x, 6);
    expect(points[0]!.y).toBeCloseTo(worldOf(path[0]!).y, 6);
    const lastScreen = path[path.length - 1]!;
    const lastPoint = points[points.length - 1]!;
    expect(lastPoint.x).toBeCloseTo(worldOf(lastScreen).x, 6);
    expect(lastPoint.y).toBeCloseTo(worldOf(lastScreen).y, 6);
    // Fewer points than were recorded, and a box that holds the whole line.
    expect(points.length).toBeLessThan(path.length);
    const stroke = strokes[0]!;
    expect(stroke.width).toBeGreaterThan(300);
    expect(stroke.height).toBeGreaterThan(4);
  });

  it('drawing while the board is zoomed places the stroke where the pointer was, at that zoom (`pen.smooth`)', async () => {
    // Zoom the way the board is zoomed: a ctrl+wheel over the surface.
    dispatchWheel(boardElement(), { deltaY: -120, ctrlKey: true });
    await flushFrame();
    const zoom = readCamera().zoom;
    expect(zoom).toBeGreaterThan(1);

    const at = { x: 300, y: 300 };
    const world = worldOf(at);
    penDrag(at, { x: 380, y: 340 }, 4);
    await flushFrame();

    const strokes = docStrokes(doc);
    expect(strokes).toHaveLength(1);
    const stroke = strokes[0]!;
    const points = strokeWorldPoints(stroke);
    expect(points[0]!.x).toBeCloseTo(world.x, 6);
    expect(points[0]!.y).toBeCloseTo(world.y, 6);
    // The line is shorter in board units than it looked on screen, and the smoothing
    // was allowed half a board unit of error at this zoom, not one (`TC-02`,
    // `pen.smooth`): a straight drag still comes back as its two ends, and the box is
    // the line plus the half-thickness the round caps add.
    expect(points.length).toBe(2);
    expect(stroke.width).toBeCloseTo(80 / zoom + PEN_THICKNESS_WORLD[stroke.thickness], 6);
    expect(stroke.height).toBeCloseTo(40 / zoom + PEN_THICKNESS_WORLD[stroke.thickness], 6);
  });
});

/* Event helpers that read as the sequence they stand for. */

function pointerEventsDown(at: { x: number; y: number }): void {
  fireEvent.pointerDown(screen.getByTestId('board'), {
    clientX: at.x,
    clientY: at.y,
    pointerId: 7,
    button: 0,
    pointerType: 'mouse',
  });
}

function pointerEventMove(at: { x: number; y: number }): void {
  fireEvent.pointerMove(screen.getByTestId('board'), {
    clientX: at.x,
    clientY: at.y,
    pointerId: 7,
    button: 0,
    pointerType: 'mouse',
  });
}

function pointerEventUp(at: { x: number; y: number }): void {
  fireEvent.pointerUp(screen.getByTestId('board'), {
    clientX: at.x,
    clientY: at.y,
    pointerId: 7,
    button: 0,
    pointerType: 'mouse',
  });
}

function pointerEventCancel(at: { x: number; y: number }): void {
  fireEvent.pointerCancel(screen.getByTestId('board'), {
    clientX: at.x,
    clientY: at.y,
    pointerId: 7,
    button: 0,
    pointerType: 'mouse',
  });
}
