/**
 * Story 11, task 5: the Pen tool (TC-09 to TC-14).
 *
 * Six things are worth proving about a pen, and they are the six a shaky hand would notice
 * first: the stroke lands with the colour and thickness that were chosen (TC-09), a click is a
 * dot rather than nothing (TC-10), an interrupted drag still leaves its line (TC-11), a stroke
 * too long for one object is written in parts that meet (TC-12), Escape puts the pen down
 * without leaving a line behind (TC-13), and choosing a colour changes only what comes next
 * (TC-14).
 *
 * Every gesture here goes through the Pen tool's own surface, because that surface *is* the
 * tool: it is what keeps presses away from the notes and the panning below.
 */
import { describe, expect, it } from 'vitest';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
} from '../../src/shared/config';
import { scaledPoints } from '../../src/shared/objects/stroke';
import type { Point } from '../../src/shared/geometry';
import { HANDWRITTEN_LOOP, moved } from '../fixtures/pen-paths';
import { worldToScreen } from '../../src/client/canvas/camera';
import {
  createNote,
  flushFrames,
  noteElement,
  notePosition,
  pointerDownOn,
  pointerMoveOn,
  pointerUpOn,
  pressKey,
  readCamera,
  renderBoard,
  viewportElement,
  waitForNotes,
} from './fixtures/board';
import { toolPressed } from './fixtures/shapes';
import {
  clickPenSwatch,
  clickPenThickness,
  clickPenTool,
  drawStroke,
  penCursorBox,
  penPressedColours,
  penPressedThicknesses,
  penSurface,
  penSurfaceOrNull,
  penToolbarOrNull,
  penToolPressed,
  previewPath,
  previewPathD,
  selectedStickyIds,
  selectedStrokeIds,
  strokeInDoc,
  strokesInDoc,
  waitForStrokes,
} from './fixtures/pen';

/** A wobbly run of board points: a line drawn by a hand rather than by a ruler. */
function run(from: Point, to: Point, steps: number): Point[] {
  const points: Point[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const along = index / steps;
    points.push({
      x: from.x + (to.x - from.x) * along,
      y: from.y + (to.y - from.y) * along + Math.sin(along * Math.PI * 4) * 8,
    });
  }
  return points;
}

const SHORT_LINE = run({ x: -160, y: -60 }, { x: 120, y: 80 }, 19);

describe('the Pen tool (TC-09 to TC-14)', () => {
  it('TC-09: one drag makes one stroke, in the colour and thickness that were chosen', async () => {
    await renderBoard();
    await clickPenTool();
    clickPenSwatch('red');
    clickPenThickness('thick');
    expect(penPressedColours()).toEqual(['red']);
    expect(penPressedThicknesses()).toEqual(['thick']);

    const drawn = await drawStroke(SHORT_LINE);

    // One gesture, one stroke — not one per point, and not one per part.
    expect(drawn.ids).toHaveLength(1);
    const strokes = await waitForStrokes(1);
    const stroke = strokes[0];
    expect(stroke.type).toBe('stroke');
    expect(stroke.color).toBe('red');
    expect(stroke.thickness).toBe('thick');
    expect(stroke.createdBy).toBeTruthy();
    // The points are the line that was drawn, give or take one pixel of smoothing.
    const line = scaledPoints(stroke);
    expect(line.length).toBeGreaterThan(1);
    expect(line[0].x).toBeCloseTo(-160, 6);
    expect(line[0].y).toBeCloseTo(-60, 6);
    // The tool stays up: a sketch is more than one line (PRD: pen.stay_active).
    expect(penToolPressed()).toBe(true);
    expect(toolPressed('[data-testid="tool-pen"]')).toBe(true);
    expect(penSurfaceOrNull()).not.toBeNull();
    expect(penToolbarOrNull()).not.toBeNull();
    // And the new stroke is not selected: the pen does not interrupt itself.
    expect(selectedStrokeIds()).toEqual([]);
  });

  it('shows the line while the pointer is down and keeps it out of the document', async () => {
    await renderBoard();
    await clickPenTool();
    const surface = penSurface();
    const screen = (point: Point): Point => worldToScreen(readCamera(), point);

    pointerDownOn(surface, screen(SHORT_LINE[0]));
    await flushFrames();
    expect(previewPath()).not.toBeNull();
    const firstD = previewPathD();
    pointerMoveOn(surface, screen(SHORT_LINE[1]));
    await flushFrames();
    // The preview follows the pointer, and two points are a straight line.
    const secondD = previewPathD();
    expect(secondD).not.toBe(firstD);
    expect(secondD?.startsWith('M')).toBe(true);
    expect(secondD).toContain('L');
    // Three points are a curve through the middle of each segment.
    pointerMoveOn(surface, screen(SHORT_LINE[2]));
    await flushFrames();
    expect(previewPathD()).toContain('Q');
    // Nothing of it has reached the document, so nobody else can see it (PRD: pen.share).
    expect(strokesInDoc()).toHaveLength(0);

    pointerUpOn(surface, screen(SHORT_LINE[2]));
    await flushFrames();
    expect(strokesInDoc()).toHaveLength(1);
    // And the preview is gone with the press.
    expect(previewPath()).toBeNull();
  });

  it('the round cursor is the chosen thickness at this zoom, and follows the pointer', async () => {
    await renderBoard();
    await clickPenTool();
    const cam = readCamera();
    clickPenThickness('thick');
    const surface = penSurface();
    pointerDownOn(surface, { x: 300, y: 200 });
    await flushFrames();
    const expected = PEN_THICKNESS_WORLD.thick * cam.zoom;
    const box = penCursorBox();
    expect(box.size).toBeCloseTo(Math.max(expected, 1), 6);
    expect(box.x).toBeCloseTo(300, 6);
    expect(box.y).toBeCloseTo(200, 6);

    clickPenSwatch('blue');
    expect(previewPath()?.getAttribute('stroke')).toBe(PEN_COLORS.blue);
    pointerUpOn(surface, { x: 300, y: 200 });
    await flushFrames();
    expect(document.querySelector('[data-testid="pen-cursor"]')).toBeNull();
  });

  it('TC-10: a press that never moved leaves one point, drawn as a dot the width of the pen', async () => {
    await renderBoard();
    await clickPenTool();
    const at: Point = { x: -40, y: -30 };
    // Nothing between down and up but a movement smaller than the drag threshold.
    const drawn = await drawStroke([at, { x: at.x + DRAG_THRESHOLD_PX / 2, y: at.y }]);

    const strokes = await waitForStrokes(1);
    expect(strokes[0].points.length).toBe(2); // one point, flattened
    expect(strokes[0].points).toHaveLength(2);
    const stroke = strokeInDoc(drawn.ids[0]);
    // A dot's box is the thickness: the round cap is the whole drawing.
    const thickness = PEN_THICKNESS_WORLD[stroke.thickness];
    expect(stroke.width).toBeCloseTo(thickness, 6);
    expect(stroke.height).toBeCloseTo(thickness, 6);
    expect(scaledPoints(stroke)[0].x).toBeCloseTo(at.x, 6);
    expect(scaledPoints(stroke)[0].y).toBeCloseTo(at.y, 6);
  });

  it('a press that stayed where it was still leaves a dot at each of two near-identical points', async () => {
    await renderBoard();
    await clickPenTool();
    // Exactly the same point twice: the second adds nothing, and the model keeps what is usable.
    const drawn = await drawStroke([{ x: 10, y: 10 }, { x: 10, y: 10 }]);
    expect(await waitForStrokes(1)).toHaveLength(1);
    expect(strokeInDoc(drawn.ids[0]).points).toHaveLength(2);
  });

  it('a loop that ends where it began is a line, not a dot', async () => {
    await renderBoard();
    await clickPenTool();
    // A circle is drawn by coming back to where it started: measuring how far the press got by
    // where it ended would call the most ink there is a click.
    const loop = [...moved(HANDWRITTEN_LOOP, { x: -120, y: -90 })];
    loop.push({ ...loop[0] });
    const drawn = await drawStroke(loop);

    expect(await waitForStrokes(1)).toHaveLength(1);
    const stroke = strokeInDoc(drawn.ids[0]);
    expect(stroke.points.length / 2).toBeGreaterThan(4);
    // It kept the size of the loop rather than the thickness of the pen.
    const line = scaledPoints(stroke);
    const width = Math.max(...line.map((point) => point.x)) - Math.min(...line.map((point) => point.x));
    const height = Math.max(...line.map((point) => point.y)) - Math.min(...line.map((point) => point.y));
    expect(width).toBeGreaterThan(150);
    expect(height).toBeGreaterThan(120);
  });

  it('TC-11: a pointer the system takes back leaves the line that was drawn so far', async () => {
    await renderBoard();
    await clickPenTool();
    const points = run({ x: -200, y: 40 }, { x: 60, y: 40 }, 12);
    const drawn = await drawStroke(points, { cancel: true });

    const strokes = await waitForStrokes(1);
    expect(strokes).toHaveLength(1);
    const line = scaledPoints(strokes[0]);
    // It ends where the pointer was when the interruption came, not further along.
    expect(line[line.length - 1].x).toBeCloseTo(points[points.length - 1].x, 6);
    expect(line[line.length - 1].y).toBeCloseTo(points[points.length - 1].y, 6);
    expect(drawn.ids).toEqual([strokes[0].id]);
    // And the pen is still up, ready for the next line.
    expect(penToolPressed()).toBe(true);
    expect(previewPath()).toBeNull();
  });

  it('TC-12: a stroke longer than the limit is written in parts that meet at a point', async () => {
    await renderBoard();
    await clickPenTool();
    // More than STROKE_MAX_POINTS points, all of them different, so nothing is filtered away.
    const points = run({ x: -300, y: -200 }, { x: 300, y: 200 }, STROKE_MAX_POINTS + 9);
    expect(points.length).toBe(STROKE_MAX_POINTS + 10);

    const drawn = await drawStroke(points, { flushEvery: 1_000 });

    expect(drawn.ids.length).toBe(2);
    const first = strokeInDoc(drawn.ids[0]);
    const second = strokeInDoc(drawn.ids[1]);
    // No part went over the limit, and the second part starts on the point the first ended on,
    // so the two meet without a gap (PRD: pen.long_stroke).
    expect(first.points.length / 2).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    const firstLine = scaledPoints(first);
    const secondLine = scaledPoints(second);
    const join = firstLine[firstLine.length - 1];
    expect(secondLine[0].x).toBeCloseTo(join.x, 6);
    expect(secondLine[0].y).toBeCloseTo(join.y, 6);
    // Each part is a stroke of its own and keeps the same pen.
    expect(first.color).toBe(second.color);
    expect(first.thickness).toBe(second.thickness);
  });

  it('TC-13: Escape puts the pen down without leaving anything behind', async () => {
    await renderBoard();
    await clickPenTool();
    expect(penSurfaceOrNull()).not.toBeNull();

    pressKey('Escape');
    await flushFrames();
    expect(penSurfaceOrNull()).toBeNull();
    expect(penToolbarOrNull()).toBeNull();
    expect(penToolPressed()).toBe(false);
    expect(strokesInDoc()).toHaveLength(0);

    // `v` was already Select; pressing it changes nothing and still creates nothing.
    pressKey('v');
    await flushFrames();
    expect(toolPressed('[data-testid="tool-select"]')).toBe(true);
    expect(strokesInDoc()).toHaveLength(0);
  });

  it('TC-13: Escape in the middle of a drag drops the line being drawn', async () => {
    await renderBoard();
    await clickPenTool();
    const surface = penSurface();
    const screen = (point: Point): Point => worldToScreen(readCamera(), point);
    pointerDownOn(surface, screen(SHORT_LINE[0]));
    await flushFrames();
    for (const point of SHORT_LINE.slice(1, 8)) {
      pointerMoveOn(surface, screen(point));
    }
    await flushFrames();
    expect(previewPath()).not.toBeNull();
    expect(strokesInDoc()).toHaveLength(0);

    pressKey('Escape');
    await flushFrames();
    // The surface is gone, so the release lands on the board and reaches nobody.
    const viewport = viewportElement();
    pointerUpOn(viewport, screen(SHORT_LINE[8]));
    await flushFrames();

    expect(strokesInDoc()).toHaveLength(0);
    expect(toolPressed('[data-testid="tool-select"]')).toBe(true);
  });

  it('TC-14: changing the colour leaves the strokes already on the board alone', async () => {
    await renderBoard();
    await clickPenTool();
    const first = (await drawStroke(run({ x: -200, y: -40 }, { x: -80, y: 40 }, 8))).ids[0];
    expect(strokeInDoc(first).color).toBe('black');
    const before = strokeInDoc(first);

    clickPenSwatch('purple');
    clickPenThickness('thin');
    // Choosing is not an edit: the stroke that exists is untouched, and nothing was written.
    expect(strokeInDoc(first)).toEqual(before);
    await waitForStrokes(1);

    const second = (await drawStroke(run({ x: 40, y: -40 }, { x: 160, y: 40 }, 8))).ids[0];
    const strokes = await waitForStrokes(2);
    expect(strokeInDoc(first).color).toBe('black');
    expect(strokeInDoc(first).thickness).toBe('medium');
    expect(strokeInDoc(second).color).toBe('purple');
    expect(strokeInDoc(second).thickness).toBe('thin');
    expect(strokes.map((stroke) => stroke.color)).toEqual(['black', 'purple']);
  });

  it('the pen toolbar appears with the tool, offers six colours and three thicknesses, and defaults to black and medium', async () => {
    await renderBoard();
    expect(penToolbarOrNull()).toBeNull();

    await clickPenTool();
    const toolbar = penToolbarOrNull();
    expect(toolbar).not.toBeNull();
    // Exactly one colour and one thickness read as pressed, and they are the defaults.
    expect(penPressedColours()).toEqual(['black']);
    expect(penPressedThicknesses()).toEqual(['medium']);
    expect(document.querySelectorAll('[data-testid^="pen-colour-"]')).toHaveLength(6);
    expect(document.querySelectorAll('[data-testid^="pen-thickness-"]')).toHaveLength(3);
    expect(penSwatchLabels()).toEqual([
      'black pen',
      'blue pen',
      'red pen',
      'green pen',
      'orange pen',
      'purple pen',
    ]);

    pressKey('v');
    await flushFrames();
    expect(penToolbarOrNull()).toBeNull();
  });

  it('a Pen drag draws over the objects under it instead of moving them or panning the board', async () => {
    await renderBoard();
    const note = await seedNote();
    const was = notePosition(note);
    const camera = readCamera();
    await clickPenTool();

    // Straight through the note: the press belongs to the pen, so the note keeps its place and
    // nothing is selected, and the board does not budge.
    const drawn = await drawStroke(run({ x: -300, y: -20 }, { x: 260, y: 120 }, 10));
    expect(await waitForStrokes(1)).toHaveLength(1);
    expect(drawn.ids).toHaveLength(1);
    expect(notePosition(note)).toEqual(was);
    expect(selectedStickyIds()).toEqual([]);
    expect(readCamera()).toEqual(camera);
    // The note is still there under the line, and still the only note on the board.
    await waitForNotes(1);
    expect(noteElement(note)).not.toBeNull();
  });

  it('a press on the toolbar takes the pen everywhere else', async () => {
    await renderBoard();
    pressKey('p');
    await flushFrames();
    expect(penSurfaceOrNull()).not.toBeNull();
    pressKey('s');
    await flushFrames();
    expect(penSurfaceOrNull()).toBeNull();
    pressKey('p');
    await flushFrames();
    expect(penSurfaceOrNull()).not.toBeNull();
    // The other tools' surfaces are gone: only one pointer at a time.
    expect(document.querySelector('[data-testid="shape-tool-surface"]')).toBeNull();
  });
});

function penSwatchLabels(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="pen-colour-"]')).map(
    (button) => button.getAttribute('aria-label') ?? '',
  );
}

/** One note, in the middle of where the drag below runs through. */
async function seedNote(): Promise<string> {
  // `createNote` centres a note on the point it is given.
  const id = createNote({ x: -20, y: 50 });
  await waitForNotes(1);
  return id;
}
