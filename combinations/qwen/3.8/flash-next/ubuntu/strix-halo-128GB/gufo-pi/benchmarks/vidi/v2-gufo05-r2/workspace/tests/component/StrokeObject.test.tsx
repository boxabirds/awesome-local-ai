/**
 * Story 11: a sketch as an object on the board.
 *
 * The interesting part of a drawing is that its box is a lie — a loop drawn round three
 * notes has a box the size of those notes, most of it empty — so everything here is about
 * the difference between the box and the line: what a click finds, what the selection
 * handles, and what happens when the object under the selection disappears.
 */

import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import { hitTestObject } from '../../src/client/objects/registry';
import {
  createSticky,
  deleteObject,
  objectSnapshots,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../src/shared/config';
import { handwrittenLoop } from '../fixtures/pen-paths';
import {
  boxOf,
  fireKey,
  firePointer,
  flushFrames,
  pickSelectTool,
  readCamera,
  renderStory11,
  seedStrokeOn,
  selectionIds,
  strokeContainerEl,
  strokeEl,
  strokeHitEl,
  strokeInkEl,
  strokesOf,
  toScreen,
} from './story11Harness';

afterEach(() => cleanup());

/** The snapshot of one object, whatever it is. */
function snapshotOf(doc: Y.Doc, id: string): ObjectSnapshot {
  const object = objectSnapshots(doc).find((entry) => entry.id === id);
  if (!object) throw new Error(`object ${id} is not on the board`);
  return object;
}

describe('stroke.object — how close a click has to be', () => {
  // A straight line, so a distance asked about in screen pixels is one division away from
  // a distance in board units.
  function seedStraight(doc: Y.Doc): string {
    return seedStrokeOn(doc, [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  }

  it('TC-15: five screen pixels from the line is a hit, seven is not, at 50% and at 200%', () => {
    const doc = renderStory11();
    const line = seedStraight(doc);
    const object = snapshotOf(doc, line);
    // The line itself sits at y = 0 in board units; a point below it is that far away.
    const on = (zoom: number, pixels: number) =>
      hitTestObject(object, { x: 50, y: pixels / zoom }, { zoom });

    expect(on(0.5, 0)).toBe(true);
    expect(on(0.5, 5)).toBe(true);
    expect(on(0.5, 7)).toBe(false);
    expect(on(2, 0)).toBe(true);
    expect(on(2, 5)).toBe(true);
    expect(on(2, 7)).toBe(false);
    // The tolerance is six screen pixels at every zoom, which is what the four lines above
    // are really saying: the same gesture, at four different zooms.
    expect(on(0.5, STROKE_HIT_TOLERANCE_PX)).toBe(true);
    expect(on(2, STROKE_HIT_TOLERANCE_PX)).toBe(true);
  });

  it('a line thicker than the tolerance is hit by half its own width', () => {
    const doc = renderStory11();
    const line = seedStrokeOn(doc, [{ x: 0, y: 0 }, { x: 100, y: 0 }], 'black', 'thick');
    const object = snapshotOf(doc, line);
    // Half of "thick" is 4 board units, which at 100% is further than six screen pixels…
    const zoom = 1;
    expect(hitTestObject(object, { x: 50, y: PEN_THICKNESS_WORLD.thick / 2 }, { zoom })).toBe(true);
    // …so a point six pixels away is still inside the ink, and eight is outside.
    expect(hitTestObject(object, { x: 50, y: 6 }, { zoom })).toBe(true);
    expect(hitTestObject(object, { x: 50, y: 9 }, { zoom })).toBe(false);
  });

  it('TC-16: the middle of a loop is empty: the note inside it takes the click', () => {
    const doc = renderStory11();
    let noteId = '';
    act(() => {
      noteId = createSticky(doc, { x: 400, y: 300 });
    });
    // The loop is drawn round the note, so the note is inside the stroke's box.
    const loop = seedStrokeOn(doc, handwrittenLoop({ centre: { x: 400, y: 300 }, wobble: 0.5 }));
    const strokeBox = boxOf(doc, loop);
    const noteBox = boxOf(doc, noteId);
    const middle = { x: noteBox.x + noteBox.width / 2, y: noteBox.y + noteBox.height / 2 };
    // The whole note is inside the drawing's box, which is the point: the box says
    // "something is here", and most of it is empty board.
    for (const corner of [
      { x: noteBox.x, y: noteBox.y },
      { x: noteBox.x + noteBox.width, y: noteBox.y + noteBox.height },
    ]) {
      expect(corner.x).toBeGreaterThan(strokeBox.x);
      expect(corner.x).toBeLessThan(strokeBox.x + strokeBox.width);
      expect(corner.y).toBeGreaterThan(strokeBox.y);
      expect(corner.y).toBeLessThan(strokeBox.y + strokeBox.height);
    }

    // The registry says the point is not the stroke's, and the click on the note under it
    // selects the note alone (PRD pen.select).
    const zoom = readCamera().zoom;
    expect(hitTestObject(snapshotOf(doc, loop), middle, { zoom })).toBe(false);

    pickSelectTool();
    const at = toScreen(middle);
    const noteEl = document.querySelector<HTMLElement>(`[data-object-id="${noteId}"]`);
    if (!noteEl) throw new Error('the note is not rendered');
    firePointer(noteEl, 'pointerdown', at.x, at.y);
    firePointer(noteEl, 'pointerup', at.x, at.y);
    flushFrames();
    expect(selectionIds()).toEqual([noteId]);
  });

  it('the invisible band you can click is as wide as the rule, in screen pixels', () => {
    const doc = renderStory11();
    const line = seedStraight(doc);
    const zoom = readCamera().zoom;
    const band = Number(strokeHitEl(line).getAttribute('stroke-width'));
    expect(band).toBeCloseTo((STROKE_HIT_TOLERANCE_PX * 2) / zoom, 6);
    // The ink itself is the pen, not the band.
    expect(Number(strokeInkEl(line).getAttribute('stroke-width'))).toBe(
      PEN_THICKNESS_WORLD.medium,
    );
  });
});

describe('stroke.object — drawn, selected, deleted', () => {
  it('a sketch is drawn in its own box, in the colour and weight it was made with', () => {
    const doc = renderStory11();
    const loop = handwrittenLoop({ centre: { x: 400, y: 300 } });
    const id = seedStrokeOn(doc, loop, 'purple', 'thick');

    const box = boxOf(doc, id);
    const canvas = strokeEl(id);
    expect(canvas.getAttribute('width')).toBe(String(box.width));
    expect(canvas.getAttribute('height')).toBe(String(box.height));
    const holder = strokeContainerEl(id);
    expect(holder.style.left).toBe(`${box.x}px`);
    expect(holder.style.top).toBe(`${box.y}px`);
    expect(holder.style.width).toBe(`${box.width}px`);
    expect(holder.style.height).toBe(`${box.height}px`);
    const ink = strokeInkEl(id);
    expect(ink.getAttribute('stroke')).toBe(PEN_COLORS.purple);
    expect(ink.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.thick));
    expect(ink.getAttribute('fill')).toBe('none');
    expect(ink.getAttribute('stroke-linecap')).toBe('round');
    expect(ink.getAttribute('stroke-linejoin')).toBe('round');
    // Announced as a drawing, whatever was drawn.
    expect(holder.getAttribute('aria-label')).toBe('Drawing');
    // The path is inside the box it was given: no point of the drawing is outside it,
    // because the box is the drawing's bounds padded by half the pen.
    expect(box.x).toBeLessThanOrEqual(Math.min(...loop.map((p) => p.x)) + 4);
    expect(box.x + box.width).toBeGreaterThanOrEqual(Math.max(...loop.map((p) => p.x)) - 4);
  });

  it('a press on the line selects the sketch, and a press elsewhere does not', () => {
    const doc = renderStory11();
    const id = seedStrokeOn(doc, [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]);
    pickSelectTool();

    const on = toScreen({ x: 100, y: 0 });
    firePointer(strokeHitEl(id), 'pointerdown', on.x, on.y);
    firePointer(strokeHitEl(id), 'pointerup', on.x, on.y);
    flushFrames();
    expect(selectionIds()).toEqual([id]);

    // A press inside the box but far from the line: the band is not there, so the board
    // keeps the press and the selection goes with it.
    const far = toScreen({ x: 100, y: 40 });
    firePointer(screen.getByTestId('board-viewport'), 'pointerdown', far.x, far.y);
    firePointer(screen.getByTestId('board-viewport'), 'pointerup', far.x, far.y);
    flushFrames();
    expect(selectionIds()).toEqual([]);
  });

  it('TC-21: a selected sketch that goes away takes the selection with it', () => {
    const doc = renderStory11();
    const id = seedStrokeOn(doc, [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]);
    pickSelectTool();
    const on = toScreen({ x: 100, y: 0 });
    firePointer(strokeHitEl(id), 'pointerdown', on.x, on.y);
    firePointer(strokeHitEl(id), 'pointerup', on.x, on.y);
    flushFrames();
    expect(selectionIds()).toEqual([id]);

    // Somebody else deleted it — or this page did, through the model rather than the key.
    act(() => {
      deleteObject(doc, id);
    });
    expect(() => flushFrames()).not.toThrow();
    expect(selectionIds()).toEqual([]);
    expect(screen.queryByTestId(`stroke-${id}`)).toBeNull();

    // And the board still answers: the press that would have moved the sketch is now a
    // press on empty board, and the Delete key finds nothing to delete.
    fireKey('Delete');
    flushFrames();
    expect(strokesOf(doc)).toHaveLength(0);
  });
});
