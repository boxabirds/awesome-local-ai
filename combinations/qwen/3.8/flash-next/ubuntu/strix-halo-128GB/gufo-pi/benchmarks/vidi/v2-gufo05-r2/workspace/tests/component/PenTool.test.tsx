/**
 * Story 11: the Pen tool, gesture by gesture.
 *
 * These are the parts of sketching that a browser test cannot pin down economically —
 * which of the ways a gesture can stop save the stroke, what happens at the point limit,
 * and the promise that the line under the pointer is a preview and not a document write.
 * Everything runs on the real board, because the join between the tool and the board (who
 * owns the pointer, whose wheel it is) is most of what this story could get wrong.
 *
 * `tests/unit/stroke.test.ts` covers the recorded path: simplification, smoothing, the
 * model's own rules. Here the question is only what the gesture stores.
 */

import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  type PenColor,
  type PenThickness,
} from '../../src/shared/config';
import { createSticky, objectSnapshots } from '../../src/shared/board-model';
import { handwrittenLoop, longSpiral, underline, CORNER } from '../fixtures/pen-paths';
import { scaledPoints } from '../../src/shared/objects/stroke';
import { PEN_MIN_CURSOR_PX } from '../../src/client/tools/PenTool';
import {
  boxOf,
  colorPressed,
  countUpdates,
  drawWorld,
  fireBatch,
  fireKey,
  firePointer,
  fireWheel,
  flushFrames,
  objectCount,
  penCursor,
  penLayer,
  penToolButton,
  pickPenColor,
  pickPenThickness,
  pickPenTool,
  pickSelectTool,
  previewD,
  previewPath,
  readBoardDoc,
  readCamera,
  renderStory11,
  selectionIds,
  strokeInkEl,
  strokesOf,
  thicknessPressed,
  toScreen,
  worldPoints,
} from './story11Harness';

afterEach(() => cleanup());

/** jsdom reports inline colours as rgb(), so a swatch's colour has to be read that way. */
function rgb(hex: string): string {
  const value = hex.replace('#', '');
  const bytes = value.match(/.{2}/g)!.map((part) => Number.parseInt(part, 16));
  return `rgb(${bytes[0]}, ${bytes[1]}, ${bytes[2]})`;
}

describe('pen.tool — a gesture and what ends it', () => {
  it('TC-09: the colour and weight in hand become the stroke, once, and the pen stays held', () => {
    const doc = renderStory11();
    pickPenTool();
    pickPenColor('red');
    pickPenThickness('thick');

    const { updates } = countUpdates(doc, () => {
      drawWorld(underline({ centre: { x: 100, y: 200 } }));
    });

    const strokes = strokesOf(doc);
    expect(strokes).toHaveLength(1);
    expect(strokes[0]).toMatchObject({ color: 'red', thickness: 'thick' });
    // One stroke is one document update — a tool that wrote on every move would share a
    // line in pieces, and undo would undo half a squiggle.
    expect(updates).toBe(1);
    // The pen is still in hand (PRD pen.stay_active), and nothing about drawing a sketch
    // is a "creation" that hands the selection to the new object.
    expect(penToolButton().getAttribute('aria-pressed')).toBe('true');
    expect(selectionIds()).toEqual([]);
  });

  it('the line on the screen while drawing is a preview: it moves, and the document does not', () => {
    const doc = renderStory11();
    pickPenTool();
    const path = handwrittenLoop();

    drawWorld(path.slice(0, 40), { end: 'none' });
    const preview = previewPath();
    expect(preview).not.toBeNull();
    expect(previewD()).toMatch(/^M /);
    expect(strokesOf(doc)).toHaveLength(0);

    // A second batch of moves, and the preview has changed shape…
    const before = previewD();
    drawWorld(path.slice(0, 120), { end: 'none' });
    expect(previewD()).not.toBe(before);
    expect(strokesOf(doc)).toHaveLength(0);

    // …and letting go replaces the promise with the thing.
    const at = toScreen(path[path.length - 1]!);
    firePointer(penLayer(), 'pointerup', at.x, at.y);
    flushFrames();
    expect(previewPath()).toBeNull();
    expect(strokesOf(doc)).toHaveLength(1);
  });

  it('TC-10: a press that never moves commits one point, and it is drawn as a dot', () => {
    const doc = renderStory11();
    pickPenTool();
    const at = { x: 500, y: 400 };
    drawWorld([at]);

    const strokes = strokesOf(doc);
    expect(strokes).toHaveLength(1);
    // One point stored, which is two numbers: the flat form a stroke keeps its points in.
    expect(strokes[0]!.points).toHaveLength(2);
    expect(scaledPoints(strokes[0]!)).toHaveLength(1);
    // A single point has no extent, so its box is the room the pen's round cap needs.
    const box = boxOf(doc, strokes[0]!.id);
    expect(box.width).toBeCloseTo(PEN_THICKNESS_WORLD.medium, 6);
    expect(box.height).toBeCloseTo(PEN_THICKNESS_WORLD.medium, 6);
    expect(strokeInkEl(strokes[0]!.id).getAttribute('d')).toMatch(/^M .* L /);
  });

  it('a jitter of a few pixels is still a click, and a drag past the threshold is a line', () => {
    const doc = renderStory11();
    pickPenTool();
    const start = { x: 200, y: 200 };
    // Just under the board's own drag threshold, measured in screen pixels.
    const zoom = readCamera().zoom;
    const nudge = { x: start.x + (DRAG_THRESHOLD_PX - 1) / zoom, y: start.y };
    drawWorld([start, nudge]);
    expect(scaledPoints(strokesOf(doc)[0]!)).toHaveLength(1);

    drawWorld([start, { x: start.x + (DRAG_THRESHOLD_PX + 20) / zoom, y: start.y }]);
    expect(strokesOf(doc)).toHaveLength(2);
    expect(scaledPoints(strokesOf(doc)[1]!).length).toBeGreaterThan(1);
  });

  it('TC-11: a pointer taken away mid-stroke keeps the part that was drawn', () => {
    const doc = renderStory11();
    pickPenTool();
    const path = underline({ centre: { x: 100, y: 300 } });

    // The browser takes the pointer back: a touch scrolled away, another app appeared.
    drawWorld(path.slice(0, 60), { end: 'cancel' });

    const strokes = strokesOf(doc);
    expect(strokes).toHaveLength(1);
    expect(previewPath()).toBeNull();
    // The sketch reaches where the hand got to, and no further.
    const box = boxOf(doc, strokes[0]!.id);
    const drawn = path.slice(0, 60);
    expect(box.x).toBeLessThanOrEqual(Math.min(...drawn.map((p) => p.x)) + 2);
    expect(box.x + box.width).toBeGreaterThanOrEqual(Math.max(...drawn.map((p) => p.x)) - 2);
    expect(box.x + box.width).toBeLessThanOrEqual(Math.max(...drawn.map((p) => p.x)) + 2);
  });

  it('a pointer capture that goes away is the same interruption, once', () => {
    const doc = renderStory11();
    pickPenTool();
    const path = CORNER;
    drawWorld(path, { end: 'capture' });
    // Released afterwards as well, the way a real capture is released after it is lost:
    // an interruption must not save the stroke twice.
    const at = toScreen(path[path.length - 1]!);
    firePointer(penLayer(), 'pointerup', at.x, at.y);
    flushFrames();
    expect(strokesOf(doc)).toHaveLength(1);
  });

  it('TC-12: past the point limit the line becomes two strokes that meet where it stopped', () => {
    const doc = renderStory11();
    pickPenTool();
    // 500 points per event is what a coalescing stylus hands over between two frames; the
    // limit is reached in the middle of a batch, which is the only way it is reached.
    const spiral = longSpiral(STROKE_MAX_POINTS + 10);
    fireBatch('pointerdown', spiral.slice(0, 1));
    for (let i = 1; i < spiral.length; i += 500) {
      fireBatch('pointermove', spiral.slice(i, i + 500));
    }
    const last = spiral[spiral.length - 1]!;
    const at = toScreen(last);
    firePointer(penLayer(), 'pointerup', at.x, at.y);
    flushFrames();

    const strokes = strokesOf(doc);
    expect(strokes).toHaveLength(2);
    for (const stroke of strokes)
      expect(scaledPoints(stroke).length).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    // No gap: the second line starts on the point the first one stopped on (PRD
    // pen.long_stroke), and it is the same pen.
    const first = worldPoints(strokes[0]!);
    expect(worldPoints(strokes[1]!)[0]).toEqual(first[first.length - 1]);
    expect(strokes[1]).toMatchObject({ color: strokes[0]!.color, thickness: strokes[0]!.thickness });
  });

  it('TC-13: Escape, or another tool, puts the pen down and creates nothing', () => {
    const doc = renderStory11();
    pickPenTool();
    drawWorld(handwrittenLoop().slice(0, 50), { end: 'none' });
    expect(previewPath()).not.toBeNull();

    // A person changing their mind is the one interruption that does not save (PRD
    // pen.cancel): the layer goes, and the points recorded in it go with it.
    fireKey('Escape');
    flushFrames();
    expect(screen.queryByTestId('pen-tool-layer')).toBeNull();
    expect(strokesOf(doc)).toHaveLength(0);
    expect(penToolButton().getAttribute('aria-pressed')).toBe('false');

    // The same again, this time with the Select button ending the gesture.
    pickPenTool();
    drawWorld(handwrittenLoop().slice(0, 50), { end: 'none' });
    pickSelectTool();
    expect(strokesOf(doc)).toHaveLength(0);
    expect(screen.queryByTestId('pen-tool-layer')).toBeNull();
  });

  it('TC-14: the choice changes the next stroke and never the one already on the board', () => {
    const doc = renderStory11();
    pickPenTool();
    drawWorld(underline({ centre: { x: 100, y: 100 } }));
    const first = strokesOf(doc)[0]!;
    expect(first.color).toBe('black');

    pickPenColor('blue');
    drawWorld(underline({ centre: { x: 100, y: 200 } }));

    const strokes = strokesOf(doc);
    expect(strokes).toHaveLength(2);
    expect(strokes[1]!.color).toBe('blue');
    // The drawing that is already there is untouched — the picker is not a paintbrush
    // (PRD pen.options.no_restyle), and its colour is stored in the stroke.
    expect(strokesOf(doc).find((s) => s.id === first.id)!.color).toBe('black');
    expect(strokeInkEl(first.id).getAttribute('stroke')).toBe(PEN_COLORS.black);
  });
});

describe('pen.tool — the two choices', () => {
  it('the options are on the page with the pen, and only with the pen', () => {
    renderStory11();
    expect(screen.queryByTestId('pen-toolbar')).toBeNull();

    pickPenTool();
    expect(screen.getByRole('group', { name: 'Pen options' })).toBeTruthy();
    for (const name of ['black', 'blue', 'red', 'green', 'orange', 'purple']) {
      expect(screen.getByRole('button', { name: `${name} pen` })).toBeTruthy();
    }
    for (const label of ['Thin', 'Medium', 'Thick']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    // Exactly one of each is the current choice, and they start at the defaults.
    const pressedColors = ['black', 'blue', 'red', 'green', 'orange', 'purple'].filter((name) =>
      colorPressed(name as PenColor),
    );
    const pressedThicknesses = ['thin', 'medium', 'thick'].filter((name) =>
      thicknessPressed(name as PenThickness),
    );
    expect(pressedColors).toEqual(['black']);
    expect(pressedThicknesses).toEqual(['medium']);

    pickSelectTool();
    expect(screen.queryByTestId('pen-toolbar')).toBeNull();
  });

  it('a choice holds for every stroke after it, and is nobody else’s business', () => {
    const doc = renderStory11();
    pickPenTool();
    pickPenColor('orange');
    pickPenThickness('thin');
    drawWorld(underline({ centre: { x: 100, y: 100 } }));
    drawWorld(underline({ centre: { x: 100, y: 200 } }));
    expect(strokesOf(doc).map((s) => [s.color, s.thickness])).toEqual([
      ['orange', 'thin'],
      ['orange', 'thin'],
    ]);

    // Held while the page is open — picking another tool and coming back keeps it…
    pickSelectTool();
    pickPenTool();
    expect(colorPressed('orange')).toBe(true);
    expect(thicknessPressed('thin')).toBe(true);

    // …and a fresh page starts from the defaults again, because the choice was never
    // written to the board (PRD pen.options.reload).
    cleanup();
    const fresh = renderStory11();
    pickPenTool();
    expect(colorPressed('black')).toBe(true);
    expect(thicknessPressed('medium')).toBe(true);
    expect(strokesOf(fresh)).toHaveLength(0);
  });

  it('the pen is picked from the toolbar, the key, and nothing else', () => {
    renderStory11();
    expect(penToolButton().getAttribute('aria-pressed')).toBe('false');
    fireKey('p');
    flushFrames();
    expect(penToolButton().getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('pen-tool-layer').getAttribute('data-pen-color')).toBe('black');
  });
});

describe('pen.tool — the pointer, and the board underneath', () => {
  it('the cursor is a ring the size the stroke will be, in the colour chosen', () => {
    renderStory11();
    pickPenTool();
    const cursor = penCursor();
    // Not before the pointer has been seen: a pen picked from the keyboard leaves no ring
    // parked in the corner of the board.
    expect(cursor.style.visibility).not.toBe('visible');

    const at = toScreen({ x: 300, y: 300 });
    firePointer(penLayer(), 'pointermove', at.x, at.y);
    flushFrames();
    expect(cursor.style.visibility).toBe('visible');
    expect(cursor.style.width).toBe(
      `${Math.max(PEN_MIN_CURSOR_PX, PEN_THICKNESS_WORLD.medium * readCamera().zoom)}px`,
    );
    expect(cursor.style.borderColor).toBe(rgb(PEN_COLORS.black));

    pickPenColor('red');
    expect(penCursor().style.borderColor).toBe(rgb(PEN_COLORS.red));
  });

  it('TC-19: a wheel over the pen pans the board, because the pen is not in the way of it', () => {
    renderStory11();
    const start = readCamera();
    pickPenTool();

    fireWheel(penLayer(), { deltaX: 60 });
    flushFrames();
    // The wheel landed on the tool layer and was answered by the board's own handler: the
    // pen did not draw, and did not re-implement story 1 (PRD pen.navigation).
    expect(readCamera().x).toBeCloseTo(start.x + 60 / start.zoom, 9);
    expect(readCamera().y).toBeCloseTo(start.y, 9);
    expect(strokesOf(readBoardDoc())).toHaveLength(0);
  });

  it('TC-19: a drag that starts on a sticky note draws over it and leaves the note alone', () => {
    const doc = renderStory11();
    let noteId = '';
    act(() => {
      noteId = createSticky(doc, { x: 300, y: 300 });
    });
    flushFrames();
    const before = boxOf(doc, noteId);

    pickPenTool();
    // Straight across the middle of the note, where its own drag handler lives. In a
    // browser the pen layer is what is under the pointer here; the layer is the gesture's,
    // which is the thing being asserted (PRD tool.owns_gesture).
    drawWorld([
      { x: 300, y: 300 },
      { x: 420, y: 360 },
      { x: 500, y: 300 },
    ]);

    expect(boxOf(doc, noteId)).toEqual(before);
    expect(selectionIds()).toEqual([]);
    expect(strokesOf(doc)).toHaveLength(1);
  });

  it('two clicks are two dots, and never the double-click that makes a note', () => {
    const doc = renderStory11();
    pickPenTool();
    const at = toScreen({ x: 200, y: 200 });
    drawWorld([{ x: 200, y: 200 }]);
    act(() => {
      penLayer().dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y }),
      );
    });
    flushFrames();

    const types = objectSnapshots(doc).map((object) => object.type);
    expect(types.filter((type) => type === 'sticky')).toEqual([]);
    expect(objectCount(doc)).toBe(1);
  });

  it('a second pointer during a stroke does not start a second line', () => {
    const doc = renderStory11();
    pickPenTool();
    const path = handwrittenLoop({ points: 60 }).slice(0, 30);
    const screen = path.map(toScreen);
    firePointer(penLayer(), 'pointerdown', screen[0]!.x, screen[0]!.y);
    // Another finger lands while the first is still drawing.
    firePointer(penLayer(), 'pointerdown', screen[1]!.x, screen[1]!.y, {});
    for (const at of screen.slice(2)) firePointer(penLayer(), 'pointermove', at.x, at.y);
    firePointer(penLayer(), 'pointerup', screen[screen.length - 1]!.x, screen[screen.length - 1]!.y);
    flushFrames();

    expect(strokesOf(doc)).toHaveLength(1);
  });
});


