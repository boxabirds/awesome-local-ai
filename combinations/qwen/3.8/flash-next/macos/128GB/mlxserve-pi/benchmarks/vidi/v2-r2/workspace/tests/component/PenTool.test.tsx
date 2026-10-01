// pen.tool (ui-component): holding the Pen, drawing a stroke, and what happens to
// the line - and to the tool - when the gesture ends.
//
// A Pen gesture is a state machine driven entirely by pointer events, so it is the
// one tool whose every branch is reachable in jsdom: press, moves, release; press,
// release; press, moves, cancellation; a gesture too long for one stroke; Escape in
// the middle of a line. What a test asserts is what the document holds afterwards -
// not how many times a handler ran - because the only promise the tool makes is
// about the drawing that ends up on the board.
//
// Two of these cases are deliberate opposites, and they are kept next to each other
// for that reason: a gesture the *system* ends keeps its ink, a gesture Escape ends
// throws it away.

import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { fireEvent } from '@testing-library/react';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  TYPE_STROKE,
} from '../../src/shared/config';
import { scaledPoints, type StrokeSnapshot } from '../../src/shared/objects/stroke';
import { snapshot } from '../../src/shared/board-model';
import {
  clickBoard,
  drawOnPen,
  drawPointsOnPen,
  dropPenTool,
  flushFrames,
  holdPenTool,
  newNote,
  notePosition,
  penColorButton,
  penCursorEl,
  penPreviewEl,
  penPreviewPath,
  penPreviewPoints,
  penThicknessButton,
  penToolButton,
  penToolLayer,
  penToolbarElement,
  pointerOnLayer,
  pressKey,
  readCamera,
  renderBoard,
  screenOf,
  selectedStrokes,
  snapshotStrokes,
  strokeAt,
  strokeBox,
  strokeColorOf,
  strokeCount,
  strokePathOf,
  strokeThicknessOf,
  useBoardTestLifecycle,
  wheelAt,
  worldOfScreen,
} from './helpers';

type Point = { x: number; y: number };

/** The Pen's own panel: the colours and thicknesses the next line is drawn with. */
function panel(): HTMLElement {
  const el = penToolbarElement();
  if (el === null) throw new Error('the Pen panel is not on screen');
  return el;
}

/** The Pen's layer over the board, as the element a pointer event can be sent to. */
function penLayer(): HTMLElement {
  const el = penToolLayer();
  if (el === null) throw new Error('the Pen tool is not held');
  return el;
}

/** The drawing the document holds for an id, or null when it has none. */
function stored(doc: Y.Doc, id: string): StrokeSnapshot | null {
  return snapshotStrokes(doc).find((stroke) => stroke.id === id) ?? null;
}

/** The screen points of a straight drag, `steps` steps between its ends. */
function screenLine(from: Point, to: Point, steps: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    points.push({
      x: from.x + ((to.x - from.x) * i) / steps,
      y: from.y + ((to.y - from.y) * i) / steps,
    });
  }
  return points;
}

describe('the Pen tool', () => {
  useBoardTestLifecycle();

  it('TC-09 draws in the colour and thickness chosen, and stays held afterwards', () => {
    const { doc } = renderBoard();

    holdPenTool();
    expect(penToolButton()?.getAttribute('aria-pressed')).toBe('true');
    expect(penToolLayer()).not.toBeNull();

    // The panel is the Pen's own, and it says what the next stroke will be drawn with.
    expect(panel()).not.toBeNull();
    expect(document.querySelectorAll('.pen-swatch')).toHaveLength(6);
    expect(document.querySelectorAll('.pen-thickness')).toHaveLength(3);
    expect(penColorButton('black')?.getAttribute('aria-pressed')).toBe('true');
    expect(penThicknessButton('medium')?.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(penColorButton('red')!);
    fireEvent.click(penThicknessButton('thick')!);
    expect(penColorButton('red')?.getAttribute('aria-pressed')).toBe('true');
    expect(penColorButton('black')?.getAttribute('aria-pressed')).toBe('false');
    expect(penToolLayer()?.dataset.penColor).toBe('red');
    expect(penToolLayer()?.dataset.penThickness).toBe('thick');

    const start = { x: 200, y: 150 };
    const end = { x: 380, y: 260 };
    drawOnPen(start, end, 5);

    // One stroke, drawn with what the panel was set to.
    const strokes = snapshotStrokes(doc);
    expect(strokes).toHaveLength(1);
    const stroke = strokes[0]!;
    expect(stroke.color).toBe('red');
    expect(stroke.thickness).toBe('thick');

    // The line is where the drag was: the box reaches from where the pen went down to
    // where it lifted, padded by half the thickness on every side.
    const a = worldOfScreen(start);
    const b = worldOfScreen(end);
    expect(stroke.x).toBeCloseTo(Math.min(a.x, b.x) - PEN_THICKNESS_WORLD.thick / 2, 3);
    expect(stroke.width).toBeCloseTo(Math.abs(b.x - a.x) + PEN_THICKNESS_WORLD.thick, 3);
    expect(stroke.height).toBeCloseTo(Math.abs(b.y - a.y) + PEN_THICKNESS_WORLD.thick, 3);

    // A straight drag keeps two points - the simplification did its work - and the ink
    // is drawn in the colour and at the width the pen was set to.
    expect(stroke.points).toHaveLength(4);
    expect(strokeColorOf(0)).toBe('red');
    expect(strokeAt(0).querySelector('[data-testid="stroke-ink"]')!.getAttribute('stroke')).toBe(
      PEN_COLORS.red,
    );
    expect(
      strokeAt(0).querySelector('[data-testid="stroke-ink"]')!.getAttribute('stroke-width'),
    ).toBe(String(PEN_THICKNESS_WORLD.thick));

    // What was drawn is what is selected, and the Pen is still held: drawing the next
    // line is what a person holding a pen does next.
    expect(selectedStrokes().map((el) => el.dataset.strokeId)).toEqual([stroke.id]);
    expect(penToolLayer()).not.toBeNull();
    expect(penToolButton()?.getAttribute('aria-pressed')).toBe('true');
    expect(penPreviewEl()).toBeNull();
    expect(penToolLayer()?.dataset.drawing).toBe('false');
  });

  it('TC-10 a press and release that never travelled is one point, drawn as a dot', () => {
    const { doc } = renderBoard();
    holdPenTool();

    const at = { x: 300, y: 220 };
    // One report short of what counts as a line: a hand that shakes is not drawing.
    drawOnPen(at, { x: at.x + DRAG_THRESHOLD_PX - 1, y: at.y }, 1);

    const strokes = snapshotStrokes(doc);
    expect(strokes).toHaveLength(1);
    const stroke = strokes[0]!;
    // One point, stored as a pair of numbers, in a box exactly one thickness square: a
    // tap has no extent of its own, so the ink's own width is all the room it needs.
    expect(stroke.points).toHaveLength(2);
    const square = PEN_THICKNESS_WORLD.medium;
    expect(stroke.width).toBeCloseTo(square, 6);
    expect(stroke.height).toBeCloseTo(square, 6);
    expect(strokeBox(0).width).toBeCloseTo(square, 6);
    expect(strokeBox(0).height).toBeCloseTo(square, 6);

    // A zero-length line with a round cap is the dot: no curve in it, no length.
    const d = strokePathOf(0);
    expect(d).toMatch(/^M [-\d.]+ [-\d.]+ L [-\d.]+ [-\d.]+$/);
    expect(d).not.toContain('Q');

    // It is a stroke like any other, so it is selected by what it drew.
    expect(strokeCount()).toBe(1);
    expect(selectedStrokes()).toHaveLength(1);
  });

  it('TC-11 a drag the system ends keeps the ink the hand already laid down', () => {
    const { doc } = renderBoard();
    holdPenTool();
    const layer = penToolLayer();
    expect(layer).not.toBeNull();

    const start = { x: 120, y: 300 };
    const mid = { x: 260, y: 200 };
    pointerOnLayer(layer, 'pointerdown', start);
    flushFrames();
    pointerOnLayer(layer, 'pointermove', { x: 190, y: 250 });
    flushFrames();
    pointerOnLayer(layer, 'pointermove', mid);
    flushFrames();
    expect(penPreviewEl()).not.toBeNull();

    // A cancellation is not an undo: the line so far is the drawing.
    pointerOnLayer(layer, 'pointercancel', mid);
    flushFrames();

    const strokes = snapshotStrokes(doc);
    expect(strokes).toHaveLength(1);
    const points = scaledPoints(strokes[0]!);
    const a = worldOfScreen(start);
    const b = worldOfScreen(mid);
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points[0]!.x).toBeCloseTo(a.x, 3);
    expect(points[0]!.y).toBeCloseTo(a.y, 3);
    expect(points[points.length - 1]!.x).toBeCloseTo(b.x, 3);
    expect(points[points.length - 1]!.y).toBeCloseTo(b.y, 3);

    // The gesture is over, so the pointer that lifts afterwards is nobody's stroke.
    expect(penPreviewEl()).toBeNull();
    expect(penToolLayer()?.dataset.drawing).toBe('false');
    pointerOnLayer(layer, 'pointerup', mid);
    flushFrames();
    expect(snapshotStrokes(doc)).toHaveLength(1);
    // and the Pen is still held, for the next line
    expect(penToolLayer()).not.toBeNull();
  });

  it('TC-12 a gesture longer than one stroke may hold is stored in parts that join', () => {
    const { doc } = renderBoard();
    holdPenTool();

    // One point further than a stroke is allowed to hold, drawn without waiting for a
    // frame in between: what a trackpad does between two paints.
    const from = { x: 60, y: 80 };
    const to = { x: 900, y: 640 };
    const points = screenLine(from, to, STROKE_MAX_POINTS + 10);
    expect(points).toHaveLength(STROKE_MAX_POINTS + 11);
    drawPointsOnPen(points);

    const strokes = snapshotStrokes(doc);
    expect(strokes).toHaveLength(2);
    for (const stroke of strokes) {
      // Neither part is over the cap, and both are drawings.
      expect(stroke.points.length / 2).toBeLessThanOrEqual(STROKE_MAX_POINTS);
      expect(stroke.type).toBe(TYPE_STROKE);
    }

    // The seam: the second line begins at the point the first one ended at, which is
    // what makes two strokes read as one line rather than a line with a hole in it.
    const first = scaledPoints(strokes[0]!);
    const second = scaledPoints(strokes[1]!);
    const end = first[first.length - 1]!;
    expect(second[0]!.x).toBeCloseTo(end.x, 4);
    expect(second[0]!.y).toBeCloseTo(end.y, 4);

    // The gesture ran to its last point: the line ends under where the pen lifted.
    const last = second[second.length - 1]!;
    expect(last.x).toBeCloseTo(worldOfScreen(to).x, 3);
    expect(last.y).toBeCloseTo(worldOfScreen(to).y, 3);
  });

  it('TC-13 Escape mid-stroke throws the line away and lets go of the tool', () => {
    const { doc } = renderBoard();
    holdPenTool();
    const layer = penToolLayer();
    expect(layer).not.toBeNull();

    const start = { x: 150, y: 150 };
    pointerOnLayer(layer, 'pointerdown', start);
    flushFrames();
    for (const point of screenLine(start, { x: 400, y: 350 }, 6).slice(1)) {
      pointerOnLayer(layer, 'pointermove', point);
      flushFrames();
    }
    expect(penPreviewEl()).not.toBeNull();
    expect(penPreviewPoints()).toBeGreaterThan(2);

    // "That was not the line I meant": nothing is written. Escape is also still the key
    // that puts the tool back, so the layer goes with it.
    pressKey('Escape');
    flushFrames();

    expect(snapshotStrokes(doc)).toHaveLength(0);
    expect(strokeCount()).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
    expect(penPreviewEl()).toBeNull();
    expect(penCursorEl()).toBeNull();
    expect(penToolLayer()).toBeNull();
    expect(penToolbarElement()).toBeNull();

    // Lifting the pointer afterwards draws nothing, and Select is holding the pointer.
    pointerOnLayer(layer, 'pointerup', { x: 400, y: 350 });
    flushFrames();
    expect(snapshot(doc)).toHaveLength(0);
    pressKey('v');
    expect(penToolLayer()).toBeNull();
    expect(
      document.querySelector('[data-testid="tool-select"][aria-pressed="true"]'),
    ).not.toBeNull();
  });

  it('TC-14 changing the colour leaves the drawing already on the board alone', () => {
    const { doc } = renderBoard();
    holdPenTool();

    drawOnPen({ x: 100, y: 100 }, { x: 300, y: 180 }, 4);
    const strokes = snapshotStrokes(doc);
    expect(strokes).toHaveLength(1);
    const firstId = strokes[0]!.id;
    const firstInk = strokePathOf(0);
    const firstColor = strokeAt(0)
      .querySelector('[data-testid="stroke-ink"]')!
      .getAttribute('stroke');
    expect(firstColor).toBe(PEN_COLORS.black);

    fireEvent.click(penColorButton('blue')!);
    fireEvent.click(penThicknessButton('thin')!);
    flushFrames();

    // A stroke is the colour it was drawn in. The panel is a decision about the next
    // line and rewrites nothing that is already on the board.
    expect(strokeCount()).toBe(1);
    expect(strokeColorOf(0)).toBe('black');
    expect(strokeThicknessOf(0)).toBe('medium');
    expect(strokePathOf(0)).toBe(firstInk);
    expect(
      strokeAt(0).querySelector('[data-testid="stroke-ink"]')!.getAttribute('stroke'),
    ).toBe(firstColor);
    expect(stored(doc, firstId)!.color).toBe('black');
    expect(stored(doc, firstId)!.thickness).toBe('medium');

    drawOnPen({ x: 320, y: 200 }, { x: 520, y: 300 }, 4);
    const after = snapshotStrokes(doc);
    expect(after).toHaveLength(2);
    expect(after[1]!.color).toBe('blue');
    expect(after[1]!.thickness).toBe('thin');
    expect(after[0]!.id).toBe(firstId);
    expect(strokeColorOf(0)).toBe('black');
    expect(strokeColorOf(1)).toBe('blue');

    // The choice is still made for the next line, and nothing had to be picked again.
    expect(penColorButton('blue')?.getAttribute('aria-pressed')).toBe('true');
    expect(penThicknessButton('thin')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('takes the press wherever it lands: a drag begun on a sticky note moves nothing', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    flushFrames();
    const before = notePosition(0);

    holdPenTool();
    // The press that would have grabbed the note, on the note's own screen point.
    const at = screenOf({ x: 40, y: 40 });
    drawOnPen(at, { x: at.x + 120, y: at.y + 90 }, 4);

    expect(notePosition(0)).toEqual(before);
    const strokes = snapshotStrokes(doc);
    expect(strokes).toHaveLength(1);
    // The drawing is the selection, not the note the line was begun on.
    expect(selectedStrokes()).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="sticky-note"][data-selected="true"]')).toHaveLength(
      0,
    );
  });

  it('leaves scrolling and zooming to the board while the Pen is held', () => {
    const { doc } = renderBoard();
    holdPenTool();
    const layer = penToolLayer();
    expect(layer).not.toBeNull();
    const before = readCamera();

    // A wheel over the Pen's layer is still the board's: panning does not stop because
    // a pen is in the hand - and it draws no stroke.
    const event = wheelAt(penLayer(), { deltaY: 120, clientX: 400, clientY: 300 });
    flushFrames();
    expect(event.defaultPrevented).toBe(true);
    expect(readCamera().y).toBeCloseTo(before.y + 120 / before.zoom, 6);
    expect(snapshotStrokes(doc)).toHaveLength(0);
    expect(penPreviewEl()).toBeNull();

    // Ctrl/Cmd+scroll zooms, under the same rule, with the Pen still held.
    wheelAt(penLayer(), { deltaY: -100, ctrlKey: true, clientX: 400, clientY: 300 });
    flushFrames();
    expect(readCamera().zoom).not.toBe(before.zoom);
    expect(penToolLayer()).not.toBeNull();
    expect(snapshotStrokes(doc)).toHaveLength(0);
  });

  it('takes a double-click as two taps with the pen rather than a new sticky note', () => {
    const { doc } = renderBoard();
    holdPenTool();
    const layer = penToolLayer();
    expect(layer).not.toBeNull();

    const at = { x: 260, y: 200 };
    pointerOnLayer(penLayer(), 'pointerdown', at);
    pointerOnLayer(penLayer(), 'pointerup', at);
    fireEvent.click(penLayer(), { clientX: at.x, clientY: at.y, detail: 2 });
    fireEvent.doubleClick(penLayer(), { clientX: at.x, clientY: at.y, detail: 2 });
    flushFrames();

    expect(document.querySelectorAll('[data-testid="sticky-note"]')).toHaveLength(0);
    const strokes = snapshotStrokes(doc);
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.points).toHaveLength(2);
  });

  it('lets go of the pen with V, and takes the panel with it', () => {
    const { doc } = renderBoard();
    holdPenTool();
    expect(penToolLayer()).not.toBeNull();
    expect(penToolbarElement()).not.toBeNull();

    dropPenTool();
    expect(penToolLayer()).toBeNull();
    expect(penToolbarElement()).toBeNull();

    // A press on the board afterwards is the board's again, and draws nothing.
    clickBoard(400, 300);
    flushFrames();
    expect(snapshotStrokes(doc)).toHaveLength(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('paints the line in flight once per animation frame, however often the pointer reported', () => {
    const { doc } = renderBoard();
    holdPenTool();
    const layer = penToolLayer();
    expect(layer).not.toBeNull();

    const from = { x: 100, y: 100 };
    pointerOnLayer(layer, 'pointerdown', from);
    // Twenty reports with no frame between them: the preview is asked for once.
    for (const point of screenLine(from, { x: 500, y: 400 }, 20).slice(1)) {
      pointerOnLayer(layer, 'pointermove', point);
    }
    expect(penPreviewEl()).toBeNull();

    flushFrames();
    const path = penPreviewPath();
    expect(path).not.toBeNull();
    expect((path!.getAttribute('d') ?? '').startsWith('M ')).toBe(true);
    // The line in flight is still being collected point by point, which is what a test
    // can only see because the layer reports it.
    expect(penPreviewPoints()).toBe(21);
    expect(snapshotStrokes(doc)).toHaveLength(0);

    pressKey('Escape');
    flushFrames();
    expect(snapshot(doc)).toHaveLength(0);
  });
});
