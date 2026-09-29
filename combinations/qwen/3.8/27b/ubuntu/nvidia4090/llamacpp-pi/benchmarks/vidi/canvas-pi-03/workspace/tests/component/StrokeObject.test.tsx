import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, act, cleanup } from '@testing-library/react';
import { renderFullApp, hooks, firePointer, pressKey, makeNote } from './story2';
import { getObjectType } from '@/client/objects/registry';
import { createStroke, type StrokeSnap } from '@/shared/objects/stroke';
import { deleteObjects } from '@/shared/board-model';
import type { Point } from '@/shared/geometry';

// Story 5: the board page checks existence before rendering the board.
vi.mock('@/client/api', () => ({
  checkBoard: vi.fn(async () => ({ kind: 'exists' })),
  createBoardRequest: vi.fn(async () => ({ kind: 'failed' })),
}));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** jsdom window is 1024x768; initial camera (-512,-384), zoom 1. */
const S = (wx: number, wy: number): { x: number; y: number } => ({ x: wx + 512, y: wy + 384 });

/** Creates a stroke through the model (as a remote client would). */
function makeStroke(points: Point[], thickness?: 'thin' | 'medium' | 'thick'): string {
  let id = '';
  act(() => {
    id = createStroke(
      hooks().getDoc(),
      { points, color: 'black', thickness: thickness ?? 'medium' },
      'tester',
    )!;
  });
  return id;
}

describe('story 11: stroke object (rendering, selection)', () => {
  it('TC-15: the registry hit test is a line distance: 5px hits and 7px misses at 50% and 200% zoom', async () => {
    await renderFullApp();
    // A thin (t = 2) straight line along y = 0 from x = 0 to x = 100.
    const id = makeStroke(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      'thin',
    );
    const snap = hooks().getObjects().find((o) => o.id === id) as StrokeSnap;
    const spec = getObjectType('stroke');
    expect(spec).toBeDefined();

    for (const zoom of [0.5, 2]) {
      // 5 screen px and 7 screen px from the line, expressed in world units.
      expect(spec!.hitTest(snap, { x: 50, y: 5 / zoom }, zoom)).toBe(true);
      expect(spec!.hitTest(snap, { x: 50, y: 7 / zoom }, zoom)).toBe(false);
    }
  });

  it('TC-16: a click inside the stroke bbox, far from the line, over a sticky selects the sticky', async () => {
    await renderFullApp();

    // Sticky centred on the origin: world (-100,-100)..(100,100).
    const noteId = makeNote(0, 0);

    // An "L" stroke whose bbox is world (-102,-102)..(102,102) but whose line
    // runs along x = -100 and y = 100 — the point (50,-50) is inside the bbox
    // yet ~150 world units from the nearest line.
    const strokeId = makeStroke(
      [
        { x: -100, y: -100 },
        { x: -100, y: 100 },
        { x: 100, y: 100 },
      ],
      'medium',
    );
    expect(strokeId).toBeTruthy();

    // Click at world (50,-50) — on the sticky, inside the stroke bbox, far
    // from the line (the stroke's DOM is pointer-events none except the line).
    const noteEl = document.querySelector(`[data-id="${noteId}"]`);
    if (noteEl === null) throw new Error('note element not found');
    firePointer(noteEl, 'pointerdown', S(50, -50).x, S(50, -50).y);
    firePointer(noteEl, 'pointerup', S(50, -50).x, S(50, -50).y);

    expect(hooks().getSelection()).toEqual([noteId]);
  });

  it('a click ON the line selects the stroke', async () => {
    await renderFullApp();
    const id = makeStroke(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      'thin',
    );
    // World (0,0) is on the line: dispatch on the invisible hit path.
    const hitEl = document.querySelector(`[data-id="${id}"] [data-testid="stroke-hit"]`);
    if (hitEl === null) throw new Error('stroke hit path not found');
    firePointer(hitEl, 'pointerdown', S(0, 0).x, S(0, 0).y);
    firePointer(hitEl, 'pointerup', S(0, 0).x, S(0, 0).y);
    expect(hooks().getSelection()).toEqual([id]);
  });

  it('TC-21: deleting the selected stroke through the model clears the selection without throwing', async () => {
    await renderFullApp();
    const id = makeStroke(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      'thin',
    );
    const hitEl = document.querySelector(`[data-id="${id}"] [data-testid="stroke-hit"]`);
    if (hitEl === null) throw new Error('stroke hit path not found');
    firePointer(hitEl, 'pointerdown', S(0, 0).x, S(0, 0).y);
    firePointer(hitEl, 'pointerup', S(0, 0).x, S(0, 0).y);
    expect(hooks().getSelection()).toEqual([id]);

    // A remote (or toolbar) delete removes it while selected.
    act(() => {
      deleteObjects(hooks().getDoc(), [id]);
    });
    expect(hooks().getSelection()).toHaveLength(0);
    expect(hooks().getObjects().filter((o) => o.type === 'stroke')).toHaveLength(0);
    // The board keeps working: the select tool is unaffected.
    pressKey(window, 'v');
    expect(screen.getByTestId('select-tool-button')).toHaveAttribute('aria-pressed', 'true');
  });
});
