// Component tests for the Stroke object (stroke.object contract):
// TC-15 (hit test at two zooms), TC-16 (fall-through selection), TC-21
// (delete a selected stroke).

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { createSticky, deleteObjects, initDoc, snapshot } from '../../src/shared/board-model';
import { createStroke, type StrokeSnap } from '../../src/shared/objects/stroke';
import { getObjectType } from '../../src/client/objects/registry';
import { BoardHarness, makeDoc } from './board-harness';

function renderBoard() {
  const doc = makeDoc();
  initDoc(doc);
  render(<BoardHarness doc={doc} withToolbar />);
  return { doc };
}

/** The harness camera centres the origin: world (0,0) → screen (640,400). */
const toScreen = (p: { x: number; y: number }) => ({ x: 640 + p.x, y: 400 + p.y });

afterEach(cleanup);

describe('Stroke object (story 11)', () => {
  // TC-15: registry hitTest at 5 and 7 screen px from the line:
  // 5/zoom <= 6/zoom → hit; 7/zoom > 6/zoom → miss, at zoom 0.5 and 2.
  test('TC-15 line hit test is zoom-correct at 0.5x and 2x', () => {
    const doc = makeDoc();
    initDoc(doc);
    createStroke(
      doc,
      { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: 'black', thickness: 'medium' },
      'local',
    );
    const s = snapshot(doc).find((o) => o.type === 'stroke') as StrokeSnap;
    const spec = getObjectType('stroke')!;
    const asSnap = s as unknown as import('../../src/shared/board-model').ObjectSnapshot;

    for (const zoom of [0.5, 2]) {
      expect(spec.hitTest(asSnap, { x: 50, y: 5 / zoom }, zoom)).toBe(true);
      expect(spec.hitTest(asSnap, { x: 50, y: 7 / zoom }, zoom)).toBe(false);
    }
  });

  // TC-16: a click inside the stroke's bbox but far from its line selects
  // the object underneath (or nothing), never the stroke.
  test('TC-16 a click away from the line falls through to the object below', () => {
    const { doc } = renderBoard();
    let stickyId = '';

    // Sticky centred at world (150,150) — a 200×200 square.
    act(() => {
      const id = createSticky(doc, { x: 150, y: 150 });
      createStroke(
        doc,
        { points: [{ x: 100, y: 100 }, { x: 150, y: 200 }, { x: 200, y: 100 }], color: 'black', thickness: 'medium' },
        'local',
      );
      stickyId = id;
    });

    // Click world (150,150): inside the stroke's bbox, ~22 units from the line.
    const sp = toScreen({ x: 150, y: 150 });
    const strokeEl = screen.getByTestId('stroke-object');
    fireEvent.pointerDown(strokeEl, { clientX: sp.x, clientY: sp.y, button: 0 });
    fireEvent.pointerUp(strokeEl, { clientX: sp.x, clientY: sp.y });

    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe(stickyId);

    // Clicking on the line itself selects the stroke.
    const onLine = toScreen({ x: 125, y: 150 }); // midpoint of first segment
    fireEvent.pointerDown(strokeEl, { clientX: onLine.x, clientY: onLine.y, button: 0 });
    fireEvent.pointerUp(strokeEl, { clientX: onLine.x, clientY: onLine.y });
    const strokeId = snapshot(doc).find((o) => o.type === 'stroke')!.id;
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe(strokeId);
  });

  // TC-21: delete a selected stroke → no exception, selection cleared.
  test('TC-21 deleting a selected stroke works', () => {
    const { doc } = renderBoard();

    act(() => {
      createStroke(
        doc,
        { points: [{ x: -50, y: -50 }, { x: 0, y: 0 }, { x: 50, y: -50 }], color: 'blue', thickness: 'medium' },
        'local',
      );
    });
    const strokeId = snapshot(doc).find((o) => o.type === 'stroke')!.id;

    // Select it by clicking on its line (world (0,0) is on the stroke).
    const sp = toScreen({ x: 0, y: 0 });
    const strokeEl = screen.getByTestId('stroke-object');
    fireEvent.pointerDown(strokeEl, { clientX: sp.x, clientY: sp.y, button: 0 });
    fireEvent.pointerUp(strokeEl, { clientX: sp.x, clientY: sp.y });
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe(strokeId);

    // Someone deletes it (local or remote): the board must not crash.
    act(() => {
      deleteObjects(doc, [strokeId]);
    });

    expect(screen.queryByTestId('stroke-object')).toBeNull();
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe('');
  });
});
