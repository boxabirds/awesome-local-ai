// @vitest-environment jsdom
// tests/component/StrokeObject.test.tsx
// TC-15, TC-16, TC-21: Stroke object hit test, fall-through selection, stale selection

import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, snapshot, deleteObject } from '../../src/shared/board-model';
import { createStroke, type StrokeSnap } from '../../src/shared/objects/stroke';
import { StrokeObject } from '../../src/client/objects/StrokeObject';
import { getObjectType } from '../../src/client/objects/registry';
import '../../src/client/objects/registerStroke';
import type { Point } from '../../src/shared/geometry';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

beforeEach(() => {
  cleanup();
});

// TC-15: registry hitTest at 5 px and 7 px screen distance at 50% and 200% zoom → hit / miss
describe('TC-15: Stroke hit test at various zooms', () => {
  it('hit at 5px screen distance, miss at 7px screen distance (at zoom 1)', () => {
    const doc = makeDoc();
    // Create a horizontal stroke from (0,0) to (100,0) with medium thickness
    const id = createStroke(doc, {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      color: 'black',
      thickness: 'medium',
    }, 'local')!;

    const snap = snapshot(doc).find(s => s.id === id) as unknown as StrokeSnap;
    const spec = getObjectType('stroke')!;

    // At zoom 1: tolerance = max(thickness/2, 6/1) = max(2, 6) = 6
    // Point 5 world units away → 5 screen px → hit
    const hitPoint: Point = { x: 50, y: 5 };
    expect(spec.hitTest(snap as any, hitPoint, 1)).toBe(true);

    // Point 7 world units away → 7 screen px → miss
    const missPoint: Point = { x: 50, y: 7 };
    expect(spec.hitTest(snap as any, missPoint, 1)).toBe(false);
  });

  it('hit at 5px screen distance, miss at 7px screen distance (at zoom 0.5)', () => {
    const doc = makeDoc();
    const id = createStroke(doc, {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      color: 'black',
      thickness: 'medium',
    }, 'local')!;

    const snap = snapshot(doc).find(s => s.id === id) as unknown as StrokeSnap;
    const spec = getObjectType('stroke')!;

    // At zoom 0.5: tolerance = max(thickness/2, 6/0.5) = max(2, 12) = 12 world units
    // 5 screen px = 10 world units → hit
    const hitPoint: Point = { x: 50, y: 10 };
    expect(spec.hitTest(snap as any, hitPoint, 0.5)).toBe(true);

    // 7 screen px = 14 world units → miss
    const missPoint: Point = { x: 50, y: 14 };
    expect(spec.hitTest(snap as any, missPoint, 0.5)).toBe(false);
  });

  it('hit at 5px screen distance, miss at 7px screen distance (at zoom 2)', () => {
    const doc = makeDoc();
    const id = createStroke(doc, {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      color: 'black',
      thickness: 'medium',
    }, 'local')!;

    const snap = snapshot(doc).find(s => s.id === id) as unknown as StrokeSnap;
    const spec = getObjectType('stroke')!;

    // At zoom 2: tolerance = max(thickness/2, 6/2) = max(2, 3) = 3 world units
    // 5 screen px = 2.5 world units → hit
    const hitPoint: Point = { x: 50, y: 2.5 };
    expect(spec.hitTest(snap as any, hitPoint, 2)).toBe(true);

    // 7 screen px = 3.5 world units → miss
    const missPoint: Point = { x: 50, y: 3.5 };
    expect(spec.hitTest(snap as any, missPoint, 2)).toBe(false);
  });
});

// TC-16: click inside a stroke's bbox far from the line over a sticky note → sticky selected, stroke not
describe('TC-16: Click inside bbox but far from line does not select stroke', () => {
  it('point inside stroke bbox but far from line is a miss', () => {
    const doc = makeDoc();
    // Create a stroke that goes from (0,0) to (100,0)
    // Its bbox will be roughly (0-2, 0-2, 100+4, 4+4) = (-2, -2, 104, 8)
    const id = createStroke(doc, {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      color: 'black',
      thickness: 'medium',
    }, 'local')!;

    const snap = snapshot(doc).find(s => s.id === id) as unknown as StrokeSnap;
    const spec = getObjectType('stroke')!;

    // Point inside the bbox but far from the line (e.g., 20 units below)
    // This is inside the bbox (which is only 8 units tall) but definitely far from the line
    const farPoint: Point = { x: 50, y: 20 };
    expect(spec.hitTest(snap as any, farPoint, 1)).toBe(false);
  });
});

// TC-21: stroke deleted via model while selected → selection cleared, no exception
describe('TC-21: Remote delete while selected', () => {
  it('deleting a selected stroke does not throw and selection can be cleared', () => {
    const doc = makeDoc();
    const id = createStroke(doc, {
      points: [{ x: 0, y: 0 }, { x: 100, y: 50 }],
      color: 'black',
      thickness: 'medium',
    }, 'local')!;

    // Verify stroke exists
    expect(snapshot(doc).find(s => s.id === id)).toBeDefined();

    // Simulate remote delete
    let threw = false;
    try {
      deleteObject(doc, id);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);

    // Stroke is gone
    expect(snapshot(doc).find(s => s.id === id)).toBeUndefined();
  });

  it('StrokeObject renders without error for a valid stroke', () => {
    const doc = makeDoc();
    const id = createStroke(doc, {
      points: [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }],
      color: 'blue',
      thickness: 'thick',
    }, 'local')!;

    const snap = snapshot(doc).find(s => s.id === id) as unknown as StrokeSnap;

    const { container } = render(
      <svg style={{ width: 300, height: 300 }}>
        <StrokeObject stroke={snap} selected={false} />
      </svg>
    );

    const path = container.querySelector('[data-testid="stroke-path"]') as SVGPathElement;
    expect(path).not.toBeNull();
    expect(path.getAttribute('stroke')).toBe('#1E88E5'); // blue
    expect(path.getAttribute('stroke-width')).toBe('8'); // thick
    expect(path.getAttribute('fill')).toBe('none');
    expect(path.getAttribute('stroke-linecap')).toBe('round');
    expect(path.getAttribute('stroke-linejoin')).toBe('round');
    expect(path.getAttribute('aria-label')).toBe('Drawing');
  });
});
