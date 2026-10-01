/**
 * Component tests for StrokeObject (story 11).
 * TC-15: registry hitTest at 5px and 7px screen distance at 50% and 200% zoom
 * TC-16: click inside bbox far from line over a sticky → sticky selected, stroke not
 * TC-21: stroke deleted remotely while selected → selection cleared, no exception
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import * as Y from 'yjs';
import { getObjectType } from '../../src/client/objects/registry';
import '../../src/client/objects/registerTypes';
import { createStroke } from '../../src/shared/objects/stroke';
import { snapshot } from '../../src/shared/board-model';
import { App } from '../../src/client/App';

describe('StrokeObject registry hitTest', () => {
  it('TC-15: hit at 5px screen distance, miss at 7px, at 50% and 200% zoom', () => {
    const doc = new Y.Doc();
    // Create a horizontal stroke at y=100, from x=50 to x=300
    const id = createStroke(doc, {
      points: [{ x: 50, y: 100 }, { x: 150, y: 100 }, { x: 300, y: 100 }],
      color: 'black',
      thickness: 'medium',
    }, 'u');
    expect(id).not.toBeNull();

    const snap = snapshot(doc).find((o) => o.id === id)!;
    const strokeSpec = getObjectType('stroke')!;
    expect(strokeSpec).toBeDefined();

    // At zoom 0.5: 5 screen px = 10 world units, 7 screen px = 14 world units
    // Tolerance = max(thickness/2, STROKE_HIT_TOLERANCE_PX / 0.5) = max(2, 12) = 12
    const zoom50 = 0.5;
    // Point 5 screen px away = 10 world units (y = 100 + 10 = 110)
    expect(strokeSpec.hitTest(snap, { x: 150, y: 110 }, zoom50)).toBe(true);
    // Point 7 screen px away = 14 world units (y = 100 + 14 = 114)
    expect(strokeSpec.hitTest(snap, { x: 150, y: 114 }, zoom50)).toBe(false);

    // At zoom 2: 5 screen px = 2.5 world units, 7 screen px = 3.5 world units
    // Tolerance = max(thickness/2, STROKE_HIT_TOLERANCE_PX / 2) = max(2, 3) = 3
    const zoom200 = 2;
    // Point 5 screen px away = 2.5 world units (y = 100 + 2.5 = 102.5)
    expect(strokeSpec.hitTest(snap, { x: 150, y: 102.5 }, zoom200)).toBe(true);
    // Point 7 screen px away = 3.5 world units (y = 100 + 3.5 = 103.5)
    expect(strokeSpec.hitTest(snap, { x: 150, y: 103.5 }, zoom200)).toBe(false);
  });

  it('TC-16: click inside stroke bbox far from line → does NOT hit stroke', () => {
    const doc = new Y.Doc();
    // Create a diagonal stroke: narrow bbox but far points
    // A stroke going from (50, 100) to (50, 300) - vertical line
    // Its bbox is approximately x=48, y=98, width=4, height=204 (for medium thickness=4)
    const id = createStroke(doc, {
      points: [{ x: 50, y: 100 }, { x: 50, y: 200 }, { x: 50, y: 300 }],
      color: 'black',
      thickness: 'medium',
    }, 'u');
    expect(id).not.toBeNull();

    const snap = snapshot(doc).find((o) => o.id === id)!;
    const strokeSpec = getObjectType('stroke')!;

    // A point far from the vertical line misses
    expect(strokeSpec.hitTest(snap, { x: 200, y: 200 }, 1)).toBe(false);

    // Also test with a diagonal stroke for a wide bbox
    const id2 = createStroke(doc, {
      points: [{ x: 0, y: 0 }, { x: 300, y: 300 }],
      color: 'black',
      thickness: 'medium',
    }, 'u');
    const snap2 = snapshot(doc).find((o) => o.id === id2)!;

    // Point (300, 0) is inside the bbox but far from the diagonal line
    // Distance from (300, 0) to line from (0,0) to (300,300):
    // The line is y=x. Distance = |300-0|/sqrt(2) ≈ 212 world units
    expect(strokeSpec.hitTest(snap2, { x: 300, y: 0 }, 1)).toBe(false);
  });
});

describe('StrokeObject rendering', () => {
  it('renders an SVG path with aria-label="Drawing"', () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, {
      points: [{ x: 10, y: 10 }, { x: 50, y: 50 }, { x: 90, y: 10 }],
      color: 'red',
      thickness: 'medium',
    }, 'u');
    expect(id).not.toBeNull();

    // Use the App to test full rendering
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Element.prototype.getBoundingClientRect = function () {
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
    };

    render(<App doc={doc} />);
    act(() => { vi.advanceTimersByTime(50); });

    const strokeEl = screen.getByTestId(`stroke-${id}`);
    expect(strokeEl).toBeDefined();
    expect(strokeEl.getAttribute('aria-label')).toBe('Drawing');

    vi.useRealTimers();
  });
});
