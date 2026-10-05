import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup, act } from '@testing-library/react';
import { renderApp, pointerEvent } from './appHarness';
import { createStroke, type StrokeSnap } from '../../src/shared/objects/stroke';
import { getObjectType } from '../../src/client/objects/registry';
import { snapshotObjects, deleteObjects } from '../../src/shared/board-model';
import * as Y from 'yjs';

afterEach(cleanup);

/** The second (hit) path of a stroke element. */
function hitPath(strokeId: string): SVGPathElement {
  const el = document.querySelector(`[data-stroke-id="${strokeId}"]`);
  expect(el).not.toBeNull();
  const paths = (el as Element).querySelectorAll('path');
  expect(paths.length).toBe(2);
  return paths[1] as SVGPathElement;
}

describe('pen.select / stroke rendering (ui-component)', () => {
  it('TC-15: hitTest true within 6 screen px of the line at 0.5 and 2 zoom; false at 7 px', () => {
    const spec = getObjectType('stroke');
    expect(spec).toBeDefined();

    // A horizontal line from (100,100) to (200,100), thin.
    const doc = new Y.Doc();
    const id = createStroke(doc, { points: [{ x: 100, y: 100 }, { x: 200, y: 100 }], color: 'black', thickness: 'thin' }, 't');
    expect(id).not.toBeNull();
    const snap = snapshotObjects(doc).find((o) => o.id === id) as StrokeSnap;

    for (const zoom of [0.5, 2] as const) {
      // 5 screen px from the line → within the 6-px tolerance.
      expect(spec!.hitTest(snap, { x: 150, y: 100 + 5 / zoom }, zoom)).toBe(true);
      // 7 screen px from the line → outside it.
      expect(spec!.hitTest(snap, { x: 150, y: 100 + 7 / zoom }, zoom)).toBe(false);
    }
    // On the line itself, always a hit.
    expect(spec!.hitTest(snap, { x: 150, y: 100 }, 1)).toBe(true);
    // Far away: no hit.
    expect(spec!.hitTest(snap, { x: 150, y: 300 }, 1)).toBe(false);
  });

  it('TC-16: stroke drawn around a sticky; clicking the enclosed empty space selects the sticky, not the stroke', async () => {
    const app = await renderApp();

    // A sticky at (100,100)-(300,300).
    const noteId = app.addNote({ x: 200, y: 200 });
    // A rectangular stroke surrounding it (bbox (146,116)-(254,284), all lines
    // at least 50 world units from the board centre (200,200)).
    let strokeId: string | null = null;
    act(() => {
      strokeId = createStroke(
        app.doc,
        {
          points: [
            { x: 150, y: 120 },
            { x: 250, y: 120 },
            { x: 250, y: 280 },
            { x: 150, y: 280 },
            { x: 150, y: 120 },
          ],
          color: 'black',
          thickness: 'medium',
        },
        't',
      );
    });
    expect(strokeId).not.toBeNull();

    // Click the centre: inside the stroke's bbox but far from its line, on top of the sticky.
    const note = app.note(noteId);
    act(() => pointerEvent(note, 'pointerdown', 200, 200));

    expect(note.getAttribute('data-selected')).toBe('true');
    const strokeEl = document.querySelector(`[data-stroke-id="${strokeId}"]`);
    expect(strokeEl?.getAttribute('data-selected')).toBe('false');
  });

  it('TC-21: a remote deletion of a selected stroke clears the selection without exceptions', async () => {
    const app = await renderApp();

    let strokeId: string | null = null;
    act(() => {
      strokeId = createStroke(
        app.doc,
        { points: [{ x: 100, y: 100 }, { x: 200, y: 100 }], color: 'black', thickness: 'medium' },
        't',
      );
    });
    expect(strokeId).not.toBeNull();

    // Select the stroke by clicking its (invisible) hit path at the line.
    const el = document.querySelector(`[data-stroke-id="${strokeId}"]`) as Element;
    expect(el).not.toBeNull();
    act(() => pointerEvent(hitPath(strokeId!), 'pointerdown', 150, 100));
    expect(el.getAttribute('data-selected')).toBe('true');
    expect(screen.queryByTestId('selection-overlay')).not.toBeNull();

    // Simulate a remote deletion through the shared model.
    act(() => {
      deleteObjects(app.doc, [strokeId!]);
    });

    // The stroke is gone, the selection is cleared, and no exception was thrown.
    expect(document.querySelector(`[data-stroke-id="${strokeId}"]`)).toBeNull();
    expect(screen.queryByTestId('selection-overlay')).toBeNull();
  });
});
