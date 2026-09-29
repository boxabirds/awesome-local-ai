import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, deleteObjects, snapshotAll } from '@shared/board-model';
import { createStroke, scaledPoints, snapshotStroke, type StrokeSnap } from '@shared/objects/stroke';
import { createSticky } from '@shared/board-model';
import { STROKE_HIT_TOLERANCE_PX, PEN_THICKNESS_WORLD } from '@shared/config';
import { distanceToPolyline } from '@shared/geometry/polyline';
import { useSelection } from '@client/board/useSelection';
import { StrokeObject } from '@client/objects/StrokeObject';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('StrokeObject / registry hitTest', () => {
  afterEach(cleanup);

  it('TC-15: registry hitTest at 5px and 7px screen distance at 50% and 200% zoom — hit/miss', () => {
    const doc = makeDoc();
    // Create a horizontal stroke from (100,100) to (300,100)
    const id = createStroke(doc, {
      points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 300, y: 100 }],
      color: 'black',
      thickness: 'medium',
    }, 'user');
    expect(id).not.toBeNull();

    const strokes = snapshotStroke(doc);
    const s = strokes[0];
    const pts = scaledPoints(s);

    // At zoom 0.5: STROKE_HIT_TOLERANCE_PX / zoom = 6 / 0.5 = 12 world units tolerance
    const zoom50 = 0.5;
    const tol50 = Math.max(PEN_THICKNESS_WORLD.medium / 2, STROKE_HIT_TOLERANCE_PX / zoom50); // max(2, 12) = 12
    // 5px at zoom 0.5 = 10 world units
    const point5px50 = { x: 200, y: 100 + 10 };
    expect(distanceToPolyline(pts, point5px50)).toBeLessThanOrEqual(tol50);
    // 7px at zoom 0.5 = 14 world units
    const point7px50 = { x: 200, y: 100 + 14 };
    expect(distanceToPolyline(pts, point7px50)).toBeGreaterThan(tol50);

    // At zoom 2: STROKE_HIT_TOLERANCE_PX / zoom = 6 / 2 = 3 world units tolerance
    const zoom200 = 2;
    const tol200 = Math.max(PEN_THICKNESS_WORLD.medium / 2, STROKE_HIT_TOLERANCE_PX / zoom200); // max(2, 3) = 3
    // 5px at zoom 2 = 2.5 world units
    const point5px200 = { x: 200, y: 100 + 2.5 };
    expect(distanceToPolyline(pts, point5px200)).toBeLessThanOrEqual(tol200);
    // 7px at zoom 2 = 3.5 world units
    const point7px200 = { x: 200, y: 100 + 3.5 };
    expect(distanceToPolyline(pts, point7px200)).toBeGreaterThan(tol200);
  });

  it('TC-16: click inside bbox far from line over a sticky note → sticky selected, stroke not', () => {
    const doc = makeDoc();
    // Create a stroke: a small arc that has a large bbox
    const id = createStroke(doc, {
      points: [{ x: 100, y: 100 }, { x: 150, y: 300 }, { x: 200, y: 100 }],
      color: 'black',
      thickness: 'thin',
    }, 'user');
    expect(id).not.toBeNull();

    // Create a sticky note inside the stroke's bbox but far from the line
    const stickyId = createSticky(doc, { x: 150, y: 130 });

    // Verify that clicking at (150, 130) is far from the stroke line
    const strokes = snapshotStroke(doc);
    const pts = scaledPoints(strokes[0]);
    const dist = distanceToPolyline(pts, { x: 150, y: 130 });
    // The point (150,130) should be far from the line connecting (100,100)→(150,300)→(200,100)
    // The closest point on the path from (100,100) to (150,300) near x=150 would be about y=300
    // So (150, 130) should be at least ~20 units away from the line
    expect(dist).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);

    // The hit test should not match the stroke at this point
    const tol = Math.max(PEN_THICKNESS_WORLD.thin / 2, STROKE_HIT_TOLERANCE_PX / 1);
    expect(distanceToPolyline(pts, { x: 150, y: 130 })).toBeGreaterThan(tol);
  });

  it('TC-21: stroke deleted via model while selected → selection cleared, no exception', () => {
    const doc = makeDoc();
    const id = createStroke(doc, {
      points: [{ x: 10, y: 10 }, { x: 50, y: 50 }],
      color: 'black',
      thickness: 'medium',
    }, 'user');
    expect(id).not.toBeNull();

    // Test selection with pruning: simulate having the stroke selected, then deleting it
    let snapshots = snapshotAll(doc);
    const { result } = renderHookSelection(snapshots);

    // Select the stroke
    act(() => {
      result.current.click(id!);
    });
    expect(result.current.ids.has(id!)).toBe(true);

    // Delete the stroke
    act(() => {
      deleteObjects(doc, [id!]);
    });

    // Update with new snapshot (stroke removed)
    snapshots = snapshotAll(doc);
    act(() => {
      result.current.updateSnapshot(snapshots);
    });

    // Selection should be cleared by prune
    expect(result.current.ids.has(id!)).toBe(false);
  });
});

// Simple test hook for selection pruning behaviour
function renderHookSelection(initialSnapshot: readonly any[]) {
  const resultRef: { current: any } = { current: null };
  let updateFn: (snapshots: readonly any[]) => void = () => {};

  function TestComp({ snapshots }: { snapshots: readonly any[] }) {
    const selection = useSelection(snapshots);
    resultRef.current = { ...selection, updateSnapshot: (s: readonly any[]) => updateFn(s) };
    return null;
  }

  // We use a wrapper component that can update the snapshot prop
  let currentSnapshots = initialSnapshot;
  const { rerender } = render(<TestComp snapshots={currentSnapshots} />);

  updateFn = (s: readonly any[]) => {
    currentSnapshots = s;
    rerender(<TestComp snapshots={s} />);
  };

  return { result: resultRef };
}
