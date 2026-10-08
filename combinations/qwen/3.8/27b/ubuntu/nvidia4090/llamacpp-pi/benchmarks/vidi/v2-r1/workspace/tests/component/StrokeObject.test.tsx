// Story 11 component tests: the stroke object and the registry entry
// (TC-15, TC-16, TC-21).
//
//  - TC-15: the registry hit test is the distance-to-line test with the
//    6 px / zoom tolerance, at 50% and 200% zoom.
//  - TC-16: a click inside the stroke bbox but far from the line, over a
//    sticky note, selects the sticky — the hit test falls through to the
//    object below.
//  - TC-21: deleting a selected stroke through the model clears the
//    selection without an error.

import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { createSticky, deleteObject, objectsSnapshot } from '../../src/shared/board-model';
import { createStroke, type StrokeSnap } from '../../src/shared/objects/stroke';
import { getObjectType, objectAtPoint } from '../../src/client/objects/registry';
import { click, flushRaf, hooks, renderApp } from './helpers';

const selectButton = () => screen.getByRole('button', { name: 'Select (V)' });

function pinCamera(): void {
  hooks().setCamera({ x: 0, y: 0, zoom: 1 });
}

function strokeSnap(): StrokeSnap {
  const s = objectsSnapshot(hooks().doc).find((o) => o.type === 'stroke');
  if (s === undefined) throw new Error('no stroke in the document');
  return s as StrokeSnap;
}

describe('stroke object and registry (component)', () => {
  it('TC-15: the hit test is distance-to-line with the 6 px/zoom tolerance (50% and 200%)', async () => {
    await renderApp();
    pinCamera();
    act(() => {
      createStroke(
        hooks().doc,
        { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: 'black', thickness: 'medium' },
        'me',
      );
    });
    const snap = strokeSnap();
    const hitTest = getObjectType('stroke')!.hitTest;
    expect(hitTest).toBeDefined();

    for (const zoom of [0.5, 2]) {
      // 5 screen px off the line is inside the max(t/2, 6/zoom) tolerance.
      expect(hitTest(snap, { x: 50, y: 5 / zoom }, zoom)).toBe(true);
      // 7 screen px off the line is outside it.
      expect(hitTest(snap, { x: 50, y: 7 / zoom }, zoom)).toBe(false);
    }
  });

  it('TC-16: a click inside the bbox but far from the line, over a sticky, selects the sticky', async () => {
    await renderApp();
    pinCamera();
    // The sticky first (below), a zigzag stroke over it (above).
    let stickyId = '';
    act(() => {
      stickyId = createSticky(hooks().doc, { x: 50, y: 22 }) ?? '';
    });
    act(() => {
      createStroke(
        hooks().doc,
        {
          // A "v": (0,0) → (25,20) → (50,0). Bbox ≈ x −4..54, y −4..24.
          points: [
            { x: 0, y: 0 },
            { x: 25, y: 20 },
            { x: 50, y: 0 },
          ],
          color: 'black',
          thickness: 'thick',
        },
        'me',
      );
    });

    // (50, 22) is inside the stroke bbox but ≈17 world units from the line:
    // the stroke's hit test must miss and the sticky below must be returned.
    const snap = objectsSnapshot(hooks().doc);
    const hit = objectAtPoint(snap, { x: 50, y: 22 }, 1);
    expect(hit?.id).toBe(stickyId);
    expect(hit?.type).toBe('sticky');

    // Same via the UI: a click on the sticky selects it (a real click at that
    // point lands on the sticky, since the stroke does not cover it).
    click(screen.getByTestId('sticky-note'));
    await flushRaf();
    expect(screen.queryByTestId('selection-overlay')).not.toBeNull();
    const strokeEl = screen.getByTestId('stroke-object');
    expect(strokeEl).not.toHaveAttribute('data-selected');
  });

  it('TC-21: deleting a selected stroke through the model clears the selection without error', async () => {
    await renderApp();
    pinCamera();
    let id = '';
    act(() => {
      id =
        createStroke(
          hooks().doc,
          {
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
            ],
            color: 'black',
            thickness: 'medium',
          },
          'me',
        ) ?? '';
    });

    // Select the stroke with the Select tool.
    fireEvent.keyDown(window, { key: 'v' });
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    // The wide invisible hit path is the target a real click lands on.
    const hitPath = screen.getByTestId('stroke-hitpath');
    fireEvent.pointerDown(hitPath, { pointerId: 1, clientX: 50, clientY: 0, bubbles: true });
    fireEvent.pointerUp(hitPath, { pointerId: 1, clientX: 50, clientY: 0, bubbles: true });
    await flushRaf();
    const strokeEl = screen.getByTestId('stroke-object');
    expect(strokeEl).toHaveAttribute('data-selected');

    // Another client (or Delete) removes it through the model.
    act(() => {
      deleteObject(hooks().doc, id);
    });
    await flushRaf();
    expect(hooks().getObjects().filter((o) => o.type === 'stroke')).toHaveLength(0);
    expect(screen.queryByTestId('selection-overlay')).not.toBeInTheDocument();
  });
});
