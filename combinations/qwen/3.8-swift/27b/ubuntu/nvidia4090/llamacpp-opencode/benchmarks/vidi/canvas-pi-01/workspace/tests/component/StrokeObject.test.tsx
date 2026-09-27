// Stroke object component tests (story 11, TC-15 to TC-16, TC-21): the
// registry hit test at several zoom levels (screen-px tolerance), a click
// inside a stroke's bbox but off its line (fall-through to the object
// beneath), and delete clearing the selection without crashing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { act } from '@testing-library/react';
import {
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
} from '../../src/shared/config';
import { createSticky, deleteObjects, initDoc, objectBounds, snapshot } from '../../src/shared/board-model';
import * as Y from 'yjs';
import { pointInRect } from '../../src/shared/geometry';
import { createStroke, type StrokeSnap } from '../../src/shared/objects/stroke';
import { getObjectType } from '../../src/client/objects/registry';
import {
  dispatch,
  installResizeObserverMock,
  pointerEvent,
  renderApp,
} from './helpers';
import { boardDoc } from './story7-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  installResizeObserverMock();
});

afterEach(() => cleanup());

function strokeSpec() {
  const spec = getObjectType('stroke');
  if (spec === undefined) throw new Error('stroke type not registered');
  return spec;
}

function makeLine(): StrokeSnap {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: 'black', thickness: 'medium' }, 'test')!;
  return snapshot(doc).find((o) => o.id === id) as StrokeSnap;
}

function toleranceFor(s: StrokeSnap, zoom: number): number {
  return Math.max(PEN_THICKNESS_WORLD[s.thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom);
}

describe('stroke.select — registry hitTest', () => {
  it('TC-15 a click 5 screen px from the line hits, 7 px misses, at zoom 1 / 0.5 / 2', () => {
    const s = makeLine();
    const spec = strokeSpec();
    for (const zoom of [1, 0.5, 2] as const) {
      // 5 screen px = 5/zoom world units; the tolerance is
      // max(2, 6/zoom) world units, so 5px is always inside and 7px outside.
      const tol = toleranceFor(s, zoom);
      expect(5 / zoom, `zoom ${zoom}`).toBeLessThanOrEqual(tol);
      expect(7 / zoom, `zoom ${zoom}`).toBeGreaterThan(tol);
      expect(spec.hitTest(s, { x: 50, y: 5 / zoom }, zoom), `zoom ${zoom}: 5px hits`).toBe(true);
      expect(spec.hitTest(s, { x: 50, y: 7 / zoom }, zoom), `zoom ${zoom}: 7px misses`).toBe(false);
    }
    // At zoom 1 the tolerance is exactly 6: 5.9 hits, 6.1 misses.
    expect(spec.hitTest(s, { x: 50, y: 5.9 }, 1)).toBe(true);
    expect(spec.hitTest(s, { x: 50, y: 6.1 }, 1)).toBe(false);
  });
});

describe('stroke.select — fall-through', () => {
  it('TC-16 a click inside the stroke bbox but off its line selects the note beneath', async () => {
    const { container } = await renderApp();
    const doc = boardDoc();
    act(() => {
      createSticky(doc, { x: 100, y: 100 }); // 200×200, centre (200,200)
      // A square loop around the note's centre: its bbox covers (200,200)
      // but its line is ≥50 units from it.
      createStroke(
        doc,
        {
          points: [
            { x: 150, y: 150 },
            { x: 250, y: 150 },
            { x: 250, y: 250 },
            { x: 150, y: 250 },
            { x: 150, y: 150 },
          ],
          color: 'red',
          thickness: 'medium',
        },
        'test',
      );
    });

    const stroke = snapshot(doc).find((o) => o.type === 'stroke') as StrokeSnap;
    const spec = strokeSpec();
    // Geometric: the point is inside the stroke's bbox but not near its line.
    expect(pointInRect(objectBounds(stroke), { x: 200, y: 200 })).toBe(true);
    expect(spec.hitTest(stroke, { x: 200, y: 200 }, 1)).toBe(false);

    // Click the note (the topmost object at that point is the note, since the
    // stroke's line is absent there) → the note is selected, the stroke is not.
    const note = container.querySelector<HTMLElement>('[data-testid="sticky-note"]')!;
    dispatch(note, pointerEvent('pointerdown', 840, 600));
    expect(note.hasAttribute('data-selected')).toBe(true);
    const strokeEl = container.querySelector<HTMLElement>('[data-testid="stroke-object"]');
    expect(strokeEl?.hasAttribute('data-selected')).toBe(false);
  });
});

describe('stroke.delete — selection cleanup', () => {
  it('TC-21 deleting a selected stroke clears the selection without crashing', async () => {
    const { container } = await renderApp();
    const doc = boardDoc();
    let id = '';
    act(() => {
      id = createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: 'black', thickness: 'medium' }, 'test')!;
    });

    const hit = container.querySelector<HTMLElement>('[data-testid="stroke-hit"]');
    expect(hit).not.toBeNull();
    dispatch(hit!, pointerEvent('pointerdown', 640, 400));
    const strokeEl = container.querySelector<HTMLElement>('[data-testid="stroke-object"]');
    expect(strokeEl!.hasAttribute('data-selected')).toBe(true);
    expect(container.querySelector('[data-testid="selection-count"]')?.textContent).toContain('1');

    act(() => {
      deleteObjects(doc, [id]);
    });
    // The selection cleared (no "N selected" left) and no crash.
    expect(container.querySelector('[data-testid="selection-count"]')).toBeNull();
    expect(container.querySelector('[data-testid="stroke-object"]')).toBeNull();
  });
});
