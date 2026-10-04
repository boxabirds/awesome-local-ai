/**
 * Story 8 component tests — the undo step boundaries the product draws.
 *
 * These mount the real board (the controller lives in `BoardSurface` exactly as
 * in the app) and drive ordinary gestures: a drag, a resize, a delete, a colour
 * change. Each must land as its own undo step, so one undo reverses one thing and
 * never bleeds into the action before or after it (PRD undo.steps). Undo is
 * driven through the controller and checked against the shared document.
 */

import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  boxOf,
  centreOf,
  clickObject,
  dragWorld,
  fireKey,
  handleEl,
  objectEl,
  renderSelection,
  seedNote,
  selectionIds,
} from './selectionHarness';
import { undoStep } from './boardHarness';
import { objectSnapshots, snapshot, type StickySnapshot } from '../../src/shared/board-model';

let doc: ReturnType<typeof renderSelection>;

beforeEach(() => {
  doc = renderSelection();
});

function colourOf(id: string): string {
  return (snapshot(doc) as StickySnapshot[]).find((n) => n.id === id)?.color ?? '';
}

function pickColour(colour: string): void {
  const label = colour.charAt(0).toUpperCase() + colour.slice(1);
  fireEvent.click(screen.getByRole('button', { name: `${label} colour` }));
}

describe('undo step boundaries', () => {
  it('TC-14: undo reverses only the last of two moves', () => {
    const id = seedNote(doc, { x: 0, y: 0 });

    dragWorld(objectEl(id), centreOf(boxOf(doc, id)), {
      x: centreOf(boxOf(doc, id)).x + 40,
      y: centreOf(boxOf(doc, id)).y,
    });
    const afterFirst = boxOf(doc, id);

    dragWorld(objectEl(id), centreOf(boxOf(doc, id)), {
      x: centreOf(boxOf(doc, id)).x + 80,
      y: centreOf(boxOf(doc, id)).y,
    });
    const afterSecond = boxOf(doc, id);
    expect(afterSecond.x).toBeGreaterThan(afterFirst.x);

    undoStep(); // only the second move is reversed

    expect(boxOf(doc, id).x).toBe(afterFirst.x);
    expect(boxOf(doc, id).y).toBe(afterFirst.y);
  });

  it('TC-15: a resize gesture is one step — position and size both come back', () => {
    const id = seedNote(doc, { x: 0, y: 0 });
    clickObject(id);
    const before = boxOf(doc, id);

    const handle = handleEl('se');
    expect(handle).toBeTruthy();
    dragWorld(handle!, { x: before.x + before.width, y: before.y + before.height }, {
      x: before.x + before.width + 60,
      y: before.y + before.height + 40,
    });

    const resized = boxOf(doc, id);
    expect(resized.width).toBeGreaterThan(before.width);

    undoStep();
    expect(boxOf(doc, id)).toEqual(before); // one step undoes the whole resize
  });

  it('TC-16: a batch delete is one step — undo brings every object back', () => {
    const ids = [seedNote(doc, { x: 0, y: 0 }), seedNote(doc, { x: 300, y: 0 }), seedNote(doc, { x: 600, y: 0 })];

    fireKey('a', { ctrl: true });
    expect(selectionIds().length).toBe(3);

    fireKey('Delete');
    expect(objectSnapshots(doc).length).toBe(0);

    undoStep();
    const restored = objectSnapshots(doc).map((o) => o.id).sort();
    expect(restored).toEqual([...ids].sort());
  });

  it('TC-17: a colour change and a delete are separate steps', () => {
    const id = seedNote(doc, { x: 0, y: 0 });
    const originalColour = colourOf(id);
    clickObject(id);

    pickColour('green');
    expect(colourOf(id)).toBe('green');

    fireKey('Delete');
    expect(objectSnapshots(doc).length).toBe(0);

    undoStep(); // the delete is reversed first
    expect(objectSnapshots(doc).length).toBe(1);
    expect(colourOf(id)).toBe('green');

    undoStep(); // then the colour change
    expect(colourOf(id)).toBe(originalColour);
  });
});
