/**
 * Story 11: stroke.object component tests (TC-15, TC-16, TC-21).
 *
 * jsdom + real Y.Doc: the registry hit test (line distance at two zooms),
 * fall-through selection (a click inside the bbox but far from the line
 * selects the sticky underneath, not the stroke), and stale-selection
 * handling when a selected stroke is deleted remotely.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';
import { dispatchPointer } from '../helpers';
import { getObjectType } from '@client/objects/registry';
import { createStroke, scaledPoints, type StrokeSnap } from '@shared/objects/stroke';
import { snapshot, createSticky, deleteObjects } from '@shared/board-model';
import { PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '@shared/config';

const { connectMock } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connectMock = vi.fn((..._args: any[]) => ({ destroy: () => {} }));
  return { connectMock };
});
vi.mock('@client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@client/sync/connectBoard')>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ...actual, connectBoard: connectMock as any };
});

const { Board } = await import('@client/Board');

const capturedDocs: Y.Doc[] = [];

function renderBoard(boardId = 'stroke-object-test') {
  return render(<Board boardId={boardId} />);
}

describe('stroke.object (ui-component)', () => {
  beforeEach(() => {
    capturedDocs.length = 0;
    connectMock.mockImplementation((doc: Y.Doc, _id: string, onState: (s: string) => void) => {
      capturedDocs.push(doc);
      onState('connected');
      return { destroy: () => {} };
    });
  });

  afterEach(() => {
    cleanup();
  });

  // TC-15: registry hitTest at 5 px and 7 px SCREEN distance, at 50% and
  // 200% zoom → hit / miss at both zooms (boundary).
  it('TC-15: stroke hitTest hits at 5 screen px and misses at 7, at 50% and 200% zoom', () => {
    const spec = getObjectType('stroke');
    expect(spec).toBeDefined();

    const doc = new Y.Doc();
    const id = createStroke(doc, {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      color: 'black',
      thickness: 'medium',
    }, 't15');
    expect(id).not.toBeNull();
    const snap = snapshot(doc).find((s) => s.id === id) as StrokeSnap;

    // The line runs along world y = 0.
    const line = scaledPoints(snap);
    expect(line[0].y).toBeCloseTo(0);
    expect(line[1].y).toBeCloseTo(0);

    for (const zoom of [0.5, 2]) {
      const fiveWorld = 5 / zoom;
      const sevenWorld = 7 / zoom;
      const tolerance = Math.max(
        PEN_THICKNESS_WORLD[snap.thickness] / 2,
        STROKE_HIT_TOLERANCE_PX / zoom,
      );
      expect(fiveWorld).toBeLessThanOrEqual(tolerance);
      expect(sevenWorld).toBeGreaterThan(tolerance);
      expect(spec!.hitTest(snap, { x: 50, y: fiveWorld }, zoom)).toBe(true);
      expect(spec!.hitTest(snap, { x: 50, y: sevenWorld }, zoom)).toBe(false);
    }
  });

  // TC-16 (negative): a click inside the stroke's bbox, far from the line,
  // over a sticky note selects the sticky — not the stroke.
  it('TC-16: clicking empty space inside a stroke bbox over a sticky selects the sticky', () => {
    renderBoard();
    const doc = capturedDocs[0];

    // Sticky at world (0,0)-(200,200).
    let stickyId: string | null = null;
    act(() => {
      stickyId = createSticky(doc, { x: 100, y: 100 });
    });
    // A diagonal stroke across the sticky: world (10,10) to (190,190).
    let strokeId: string | null = null;
    act(() => {
      strokeId = createStroke(doc, {
        points: [{ x: 10, y: 10 }, { x: 190, y: 190 }],
        color: 'black',
        thickness: 'medium',
      }, 't16');
    });
    expect(stickyId).toBeTruthy();
    expect(strokeId).toBeTruthy();

    const sticky = screen.getByTestId('sticky-note');
    const stroke = screen.getByTestId('stroke-object');
    expect(stroke).toBeTruthy();

    // Default jsdom camera: zoom 1, world origin at screen (512, 384).
    // World (170, 30) is inside the stroke bbox, ~99 units from the line.
    const screenX = 512 + 170;
    const screenY = 384 + 30;
    act(() => {
      dispatchPointer(sticky, 'pointerdown', screenX, screenY);
      dispatchPointer(sticky, 'pointerup', screenX, screenY);
    });

    // The sticky is selected...
    expect(sticky).toHaveAttribute('data-selected');
    // ...and the stroke is not (the click was far from its line).
    expect(stroke).not.toHaveAttribute('data-selected');
  });

  // TC-21 (error path): a selected stroke deleted via the model (remote
  // delete) → the selection is cleared, no exception.
  it('TC-21: deleting a selected stroke clears the selection without throwing', () => {
    renderBoard();
    const doc = capturedDocs[0];

    let strokeId: string | null = null;
    act(() => {
      strokeId = createStroke(doc, {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        color: 'black',
        thickness: 'medium',
      }, 't21');
    });
    expect(strokeId).toBeTruthy();

    // Select the stroke by its line (the hit path).
    const hit = screen.getByTestId('stroke-hit-path');
    act(() => {
      // World (50, 0) → screen (562, 384).
      dispatchPointer(hit, 'pointerdown', 562, 384);
      dispatchPointer(hit, 'pointerup', 562, 384);
    });
    const stroke = screen.getByTestId('stroke-object');
    expect(stroke).toHaveAttribute('data-selected');
    expect(screen.getByTestId('selection-overlay')).toBeTruthy();

    // Remote delete while selected.
    act(() => {
      expect(() => deleteObjects(doc, [strokeId!])).not.toThrow();
    });

    // The stroke is gone and the selection is cleared.
    expect(screen.queryByTestId('stroke-object')).toBeNull();
    expect(screen.queryByTestId('selection-overlay')).toBeNull();
    expect(snapshot(doc).find((s) => s.id === strokeId)).toBeUndefined();
  });
});
