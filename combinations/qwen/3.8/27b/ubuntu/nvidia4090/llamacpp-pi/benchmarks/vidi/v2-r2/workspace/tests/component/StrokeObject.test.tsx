/**
 * Story 11 component tests: stroke selection hit tolerance (TC-15), the
 * fall-through of clicks inside the bbox but far from the line (TC-16) and
 * the selected-stroke remote-delete recovery (TC-21), per the design's
 * test contract.
 *
 * Camera fixture: world (0,0) at screen (640,400), zoom 1, 1280x800.
 */
import { act, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { expect, it, vi } from 'vitest';
import { createSticky, deleteObjects, snapshotAll } from '../../src/shared/board-model';
import { createStroke, type StrokeSnap } from '../../src/shared/objects/stroke';
import { getObjectType } from '../../src/client/objects/registry';
import { renderStickyBoard } from './harness';

vi.useFakeTimers();

/** A doc with a single medium-black stroke along world y = 0 (x 0..100). */
function lineDoc(): { doc: Y.Doc; snap: StrokeSnap } {
  const doc = new Y.Doc();
  doc.getMap('meta');
  doc.getMap('objects');
  createStroke(
    doc,
    {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      color: 'black',
      thickness: 'medium',
    },
    'tester',
  );
  return { doc, snap: snapshotAll(doc)[0] as StrokeSnap };
}

it('TC-15: registry hit test: 5px is a hit, 7px is a miss (50% and 200% zoom)', () => {
  const { snap } = lineDoc();
  const hitTest = getObjectType('stroke')!.hitTest;
  for (const zoom of [0.5, 2] as const) {
    // Offsets measured in screen px → converted to world (÷ zoom); the
    // registry tolerance is max(thickness/2, 6px/zoom).
    const hit = hitTest(snap, { x: 50, y: 5 / zoom }, zoom);
    const miss = hitTest(snap, { x: 50, y: 7 / zoom }, zoom);
    expect(hit, `zoom ${zoom}: 5px`).toBe(true);
    expect(miss, `zoom ${zoom}: 7px`).toBe(false);
  }
});

it('TC-16: a click on top of a sticky, inside the stroke’s bbox but far from the line, selects the sticky', () => {
  const utils = renderStickyBoard();
  act(() => {
    createSticky(utils.doc, { x: 0, y: 0 });
    // A corner-shaped stroke whose bbox covers the sticky’s centre (0,0)
    // but whose line stays 300 world units away from it.
    createStroke(
      utils.doc,
      {
        points: [
          { x: -300, y: -300 },
          { x: -300, y: 300 },
          { x: 300, y: 300 },
        ],
        color: 'black',
        thickness: 'medium',
      },
      'tester',
    );
  });

  const sticky = utils.getByTestId('sticky-note');
  const stroke = utils.getByTestId('stroke-object');
  // The click lands at world (0,0) — inside the stroke’s bbox, far from
  // the line: the sticky underneath receives it.
  fireEvent.pointerDown(sticky, { clientX: 640, clientY: 400, pointerId: 1 });
  fireEvent.pointerUp(sticky, { clientX: 640, clientY: 400, pointerId: 1 });

  expect(sticky.getAttribute('data-selected')).toBe('true');
  expect(stroke.getAttribute('data-selected')).toBe('false');
});

it('TC-21: a selected stroke can be deleted remotely; the selection clears without crashing', () => {
  const utils = renderStickyBoard();
  let id: string | null = null;
  act(() => {
    id = createStroke(
      utils.doc,
      {
        points: [
          { x: -50, y: 0 },
          { x: 50, y: 0 },
        ],
        color: 'black',
        thickness: 'medium',
      },
      'tester',
    );
  });
  expect(id).not.toBeNull();

  // Select the stroke by clicking its line at world (0,0) → screen (640,400).
  const viewport = utils.getByTestId('board-viewport');
  fireEvent.pointerDown(viewport, { clientX: 640, clientY: 400, pointerId: 1 });
  fireEvent.pointerUp(viewport, { clientX: 640, clientY: 400, pointerId: 1 });
  expect(utils.getByTestId('stroke-object').getAttribute('data-selected')).toBe('true');

  // A remote peer deletes it while it is selected.
  act(() => {
    deleteObjects(utils.doc, [id as string]);
  });

  // The object is gone and the selection cleared (no exception).
  expect(utils.queryByTestId('stroke-object')).toBeNull();
  expect(utils.queryByTestId('selection-overlay')).toBeNull();
  expect(snapshotAll(utils.doc)).toHaveLength(0);
});
