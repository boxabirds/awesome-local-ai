/**
 * Component tests: StrokeObject + registry entry — TC-15, TC-16, TC-21
 * (story 11).
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  initDoc,
  snapshot,
} from '../../src/shared/board-model';
import { createStroke } from '../../src/shared/objects/stroke';
import { getObjectType } from '../../src/client/objects/registry';
import { useSelection } from '../../src/client/board/useSelection';
import type { Point } from '../../src/shared/geometry';
import { STROKE_MIN_SIZE_WORLD } from '../../src/shared/config';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function linePoints(x0: number, y0: number, x1: number, y1: number, n = 20): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pts.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
  }
  return pts;
}

describe('StrokeObject registry + rendering (TC-15, TC-16, TC-21)', () => {
  it('TC-15: hit test is a line distance within 6 screen px (hit) / 7 screen px (miss) at 50% and 200% zoom', () => {
    const doc = newDoc();
    const id = createStroke(
      doc,
      { points: linePoints(100, 100, 300, 100), color: 'black', thickness: 'medium' },
      'local',
    )!;
    const s = snapshot(doc).find((o) => o.id === id)!;
    const spec = getObjectType('stroke');
    expect(spec).not.toBeNull();

    for (const zoom of [0.5, 2]) {
      // 5 screen pixels from the line → inside the 6px tolerance → hit
      const hitPoint = { x: 200, y: 100 + 5 / zoom };
      // 7 screen pixels from the line → outside the 6px tolerance → miss
      const missPoint = { x: 200, y: 100 + 7 / zoom };
      expect(spec!.hitTest(s, hitPoint, zoom)).toBe(true);
      expect(spec!.hitTest(s, missPoint, zoom)).toBe(false);
    }

    // Generic transform properties
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STROKE_MIN_SIZE_WORLD);
  });

  it('TC-16: a click inside the stroke bbox but far from the line misses the stroke and hits the sticky below', () => {
    const doc = newDoc();
    // L-shaped stroke: down then right; the point (250,150) is inside the
    // bbox but far from any part of the line.
    const lPoints: Point[] = [
      ...linePoints(100, 100, 100, 300),
      ...linePoints(100, 300, 300, 300).slice(1),
    ];
    const strokeId = createStroke(
      doc,
      { points: lPoints, color: 'black', thickness: 'medium' },
      'local',
    )!;
    // Sticky centred on (250,150): covers it comfortably
    const stickyId = createSticky(doc, { x: 250, y: 150 });
    expect(stickyId).not.toBe('');

    const snap = snapshot(doc);
    const strokeSpec = getObjectType('stroke')!;
    const stickySpec = getObjectType('sticky')!;
    const strokeSnap = snap.find((o) => o.id === strokeId)!;
    const stickySnap = snap.find((o) => o.id === stickyId)!;

    const p = { x: 250, y: 150 };
    // Inside the stroke's bbox (~100..300 × 100..300) and far from its line
    expect(strokeSpec.hitTest(strokeSnap, p, 1)).toBe(false);
    // ... but inside the sticky, so selection falls through to it
    expect(stickySpec.hitTest(stickySnap, p)).toBe(true);
  });

  it('TC-21: deleting a selected stroke via the model clears the selection without throwing', () => {
    const doc = newDoc();
    const id = createStroke(
      doc,
      { points: linePoints(0, 0, 100, 100), color: 'black', thickness: 'medium' },
      'local',
    )!;

    const snap1 = snapshot(doc);
    const { result, rerender } = renderHook(({ notes }) => useSelection(notes), {
      initialProps: { notes: snap1 },
    });

    act(() => {
      result.current.click(id);
    });
    expect(result.current.ids.size).toBe(1);
    expect(result.current.ids.has(id)).toBe(true);

    // Delete via the model, then re-snapshot and rerender
    deleteObject(doc, id);
    const snap2 = snapshot(doc);
    expect(snap2.every((o) => o.id !== id)).toBe(true);
    rerender({ notes: snap2 });

    // Pruned: selection is empty and nothing threw
    expect(result.current.ids.size).toBe(0);
  });
});
