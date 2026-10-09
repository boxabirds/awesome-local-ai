/**
 * Story 11, task 5: the stroke as an object on the board (TC-15, TC-16, TC-21).
 *
 * A stroke is a box, and almost none of it is ink. Everything a user does to one — click it,
 * move it, stretch it, delete it — comes from story 7's ordinary code, and the three things
 * story 11 adds to that are small and sharp: a stroke is clicked by how near the pointer came
 * to the line (TC-15), a click inside its box but away from the line belongs to whatever is
 * underneath (TC-16), and a stroke that someone else deletes stops being selected without
 * anybody being told (TC-21).
 */
import { describe, expect, it } from 'vitest';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { scaledPoints, STROKE_TYPE } from '../../src/shared/objects/stroke';
import type { Point } from '../../src/shared/geometry';
import { worldToScreen } from '../../src/client/canvas/camera';
import { getObjectType } from '../../src/client/objects/registry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import {
  createNote,
  flushFrames,
  noteElement,
  pointerDownOn,
  pointerUpOn,
  pressKey,
  readCamera,
  renderBoard,
  waitForNotes,
} from './fixtures/board';
import {
  deleteStroke,
  resizeStrokeInDoc,
  seedStroke,
  selectStroke,
  selectedStickyIds,
  selectedStrokeIds,
  strokeElement,
  strokeHitPath,
  strokeInDoc,
  strokePathD,
  strokesInDoc,
  waitForStrokes,
} from './fixtures/pen';

/** A flat straight line, so a distance from it is a difference in y and nothing else. */
const FLAT: Point[] = [
  { x: -100, y: -40 },
  { x: 100, y: -40 },
];

/** A shallow ∧: its box contains the middle of the board, its ink does not go near it. */
const ARCH: Point[] = [
  { x: -100, y: -100 },
  { x: 0, y: 100 },
  { x: 100, y: -100 },
];

function specOf() {
  const spec = getObjectType(STROKE_TYPE);
  if (!spec) throw new Error('the stroke type is not registered');
  return spec;
}

describe('clicking near a stroke (TC-15)', () => {
  /** A board point `screenPx` away from the line, at right angles to it. */
  function besideLine(zoom: number, screenPx: number): Point {
    return { x: 0, y: -40 - screenPx / zoom };
  }

  it('TC-15: 5 screen pixels from the line is a click on it and 7 is not, at 50% and 200% zoom', async () => {
    await renderBoard();
    const id = seedStroke(FLAT);
    const stroke = strokeInDoc(id);
    const spec = specOf();

    for (const zoom of [0.5, 1, 2]) {
      const near = besideLine(zoom, STROKE_HIT_TOLERANCE_PX - 1);
      const far = besideLine(zoom, STROKE_HIT_TOLERANCE_PX + 1);
      // The point really is that many screen pixels from the line at that zoom.
      expect(distanceToPolyline(scaledPoints(stroke), near) * zoom).toBeCloseTo(
        STROKE_HIT_TOLERANCE_PX - 1,
        6,
      );
      expect(spec.hitTest?.(stroke, near, zoom)).toBe(true);
      expect(spec.hitTest?.(stroke, far, zoom)).toBe(false);
    }
  });

  it('a line thicker than the click margin is clicked by its own thickness, not by six pixels', async () => {
    await renderBoard();
    const id = seedStroke(FLAT, { thickness: 'thick' });
    const stroke = strokeInDoc(id);
    const spec = specOf();
    const half = PEN_THICKNESS_WORLD.thick / 2; // 4 board units
    // Zoomed in, six screen pixels is a hair off the line, and it is the line's own half-width
    // that decides: just inside it is a hit, just outside is not.
    expect(spec.hitTest?.(stroke, { x: 0, y: -40 - half + 0.5 }, 8)).toBe(true);
    expect(spec.hitTest?.(stroke, { x: 0, y: -40 - half - 0.5 }, 8)).toBe(false);
    // Zoomed out, six screen pixels is a wide margin in board units and the margin wins.
    expect(spec.hitTest?.(stroke, { x: 0, y: -40 - 20 }, 0.25)).toBe(true);
    expect(spec.hitTest?.(stroke, { x: 0, y: -40 - 30 }, 0.25)).toBe(false);
  });

  it('the click area in the DOM is the same margin the registry answers with, at this zoom', async () => {
    await renderBoard();
    const id = seedStroke(FLAT);
    const width = Number(strokeHitPath(id).getAttribute('stroke-width'));
    expect(width).toBeCloseTo((STROKE_HIT_TOLERANCE_PX * 2) / readCamera().zoom, 6);
  });
});

describe('what a stroke is drawn as', () => {
  it('one path, in the pen it was drawn with, with round caps and joins and no fill', async () => {
    await renderBoard();
    const id = seedStroke(ARCH, { color: 'green', thickness: 'thin' });
    const element = strokeElement(id);
    const line = element.querySelector('[data-testid="stroke-line"]');
    const d = strokePathD(id);

    expect(element.getAttribute('aria-label')).toBe('Drawing');
    expect(element.dataset.noteType).toBe('stroke');
    // The path is in the box's own coordinates: the drawing says where the box is, the path
    // says where inside it the ink is.
    // ARCH starts at the top-left of its box, so the path starts half a thickness in.
    const pad = PEN_THICKNESS_WORLD.thin / 2;
    expect(d.startsWith(`M ${pad} ${pad}`)).toBe(true);
    expect(d).toContain('Q');
    expect(line?.getAttribute('stroke')).toBe(PEN_COLORS.green);
    expect(line?.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.thin));
    expect(line?.getAttribute('fill')).toBe('none');
    expect(line?.getAttribute('stroke-linecap')).toBe('round');
    expect(line?.getAttribute('stroke-linejoin')).toBe('round');
  });

  it('the box is the line and the thickness, and the drawing fills it', async () => {
    await renderBoard();
    const id = seedStroke(ARCH, { thickness: 'thick' });
    const stroke = strokeInDoc(id);
    const pad = PEN_THICKNESS_WORLD.thick / 2;
    expect(stroke.x).toBeCloseTo(-100 - pad, 6);
    expect(stroke.y).toBeCloseTo(-100 - pad, 6);
    expect(stroke.width).toBeCloseTo(200 + pad * 2, 6);
    expect(stroke.height).toBeCloseTo(200 + pad * 2, 6);
  });

  it('a bigger box makes a bigger drawing, and a line of the same thickness', async () => {
    await renderBoard();
    const id = seedStroke(ARCH);
    const was = strokeInDoc(id);
    resizeStrokeInDoc(id, { width: was.width * 2, height: was.height * 2 });
    await flushFrames();

    const stroke = strokeInDoc(id);
    const before = scaledPoints(was);
    const after = scaledPoints(stroke);
    // Every point is where it was, twice as far from the origin (PRD: pen.resize).
    for (let index = 0; index < before.length; index += 1) {
      expect(after[index].x).toBeCloseTo(stroke.x + (before[index].x - was.x) * 2, 6);
      expect(after[index].y).toBeCloseTo(stroke.y + (before[index].y - was.y) * 2, 6);
    }
    // The line itself did not get fatter: thickness belongs to the pen, not to the box.
    expect(strokeHitPath(id)).not.toBeNull();
    expect(
      strokeElement(id).querySelector('[data-testid="stroke-line"]')?.getAttribute('stroke-width'),
    ).toBe(String(PEN_THICKNESS_WORLD[stroke.thickness]));
  });

  it('a stroke has handles, keeps its ratio and refuses to shrink to nothing', async () => {
    await renderBoard();
    seedStroke(FLAT);
    await waitForStrokes(1);
    const spec = specOf();
    expect(spec.resizable).toBe(true);
    expect(spec.aspectLocked).toBe(true);
    expect(spec.minSize).toBe(STROKE_MIN_SIZE_WORLD);
    expect(spec.editableText).toBe(false);
  });
});

describe('clicking inside a stroke whose box covers something else (TC-16)', () => {
  it('TC-16: the click goes through to the note under the box, and the stroke stays unselected', async () => {
    await renderBoard();
    const note = createNote({ x: 60, y: -40 });
    await waitForNotes(1);
    const id = seedStroke(ARCH);
    await flushFrames();

    // This point of the note is inside the stroke's box and far from its line, so the browser
    // gives the press to the note: the box of a stroke is empty board as far as the pointer is
    // concerned, and only the line takes it.
    const inside = { x: 100, y: 40 };
    const stroke = strokeInDoc(id);
    expect(inside.x).toBeGreaterThan(stroke.x);
    expect(inside.x).toBeLessThan(stroke.x + stroke.width);
    expect(inside.y).toBeGreaterThan(stroke.y);
    expect(inside.y).toBeLessThan(stroke.y + stroke.height);
    expect(distanceToPolyline(scaledPoints(stroke), inside)).toBeGreaterThan(
      STROKE_HIT_TOLERANCE_PX,
    );
    const at = screenOfWorld(inside);
    pointerDownOn(noteElement(note), at);
    await flushFrames();
    pointerUpOn(noteElement(note), at);
    await flushFrames();

    expect(selectedStickyIds()).toEqual([note]);
    expect(selectedStrokeIds()).toEqual([]);

    // Which is what these two attributes are for: nothing in a stroke's box takes the pointer
    // except the line itself.
    const element = strokeElement(id);
    expect(element.style.pointerEvents).toBe('none');
    const svg = element.querySelector('svg');
    expect(svg?.getAttribute('style') ?? '').toContain('pointer-events: none');
    expect(strokeHitPath(id).getAttribute('pointer-events')).toBe('stroke');
  });

  it('the line itself does take the pointer, and selecting it does not select the note', async () => {
    await renderBoard();
    const note = createNote({ x: 60, y: -40 });
    await waitForNotes(1);
    const id = seedStroke(ARCH);
    await flushFrames();

    // The point of the line, and not of the note: pressing it selects the stroke.
    await selectStroke(id, { x: 0, y: 100 });
    expect(selectedStrokeIds()).toEqual([id]);
    expect(selectedStickyIds()).toEqual([]);
    expect(strokeElement(id).dataset.selected).toBe('true');
    expect(noteElement(note).dataset.selected).not.toBe('true');
  });
});

describe('a stroke that goes away while it is selected (TC-21)', () => {
  it('TC-21: deleting a selected stroke through the model clears the selection and throws nothing', async () => {
    await renderBoard();
    const id = seedStroke(ARCH);
    await selectStroke(id, { x: 0, y: 100 });
    expect(selectedStrokeIds()).toEqual([id]);

    // Another browser, or this one's Delete key: either way the object is gone from the document.
    deleteStroke(id);
    await flushFrames();

    expect(strokesInDoc()).toHaveLength(0);
    expect(document.querySelectorAll('[data-testid="stroke-object"]')).toHaveLength(0);
    expect(selectedStrokeIds()).toEqual([]);
    // The board is still there, and so is the pen's ability to draw another one.
    expect(document.querySelector('[data-testid="viewport"]')).not.toBeNull();
    expect(() => seedStroke(FLAT)).not.toThrow();
    await waitForStrokes(1);
    expect(strokesInDoc()).toHaveLength(1);
  });

  it('a selected stroke can be deleted with the Delete key like anything else', async () => {
    await renderBoard();
    const id = seedStroke(ARCH);
    await selectStroke(id, { x: 0, y: 100 });
    expect(selectedStrokeIds()).toEqual([id]);

    pressKey('Delete');
    await flushFrames();

    await waitForStrokes(0);
    expect(selectedStrokeIds()).toEqual([]);
  });
});

/** A board point, where it is drawn on the screen right now. */
function screenOfWorld(point: Point): Point {
  return worldToScreen(readCamera(), point);
}
