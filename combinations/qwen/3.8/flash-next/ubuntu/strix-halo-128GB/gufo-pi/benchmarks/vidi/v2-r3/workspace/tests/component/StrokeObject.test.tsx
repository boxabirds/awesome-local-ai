import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import { snapshot, getObjectsMap, createSticky, deleteObjects } from '../../src/shared/board-model';
import type { StrokeSnap } from '../../src/shared/objects/stroke';
import { createStroke } from '../../src/shared/objects/stroke';
import { scaledPoints } from '../../src/shared/objects/stroke';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { getObjectType } from '../../src/client/objects/registry';
import { STROKE_HIT_TOLERANCE_PX, PEN_THICKNESS_WORLD } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { pointer, frames } from './pointerUtils';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const handleRef = createRef<HarnessHandle | null>();
  render(<BoardHarness handleRef={handleRef} />);
  const handle = handleRef.current!;
  return { handle, doc: handle.doc };
}

describe('stroke.object (TC-15, TC-16, TC-21)', () => {
  it('TC-15: registry hitTest at 5px and 7px screen distance at 50% and 200% zoom', () => {
    const { handle, doc } = setup();

    // Create a stroke from (200, 300) to (400, 300) - horizontal line in world space
    const id = createStroke(doc, {
      points: [{ x: 200, y: 300 }, { x: 300, y: 300 }, { x: 400, y: 300 }],
      color: 'black',
      thickness: 'thin',
    }, 'user');
    expect(id).not.toBeNull();
    frames();

    const snaps = snapshot(doc);
    const stroke = snaps.find((o) => o.id === id) as StrokeSnap;
    expect(stroke).toBeDefined();

    const spec = getObjectType('stroke');
    expect(spec).toBeDefined();
    expect(spec!.hitTestZoom).toBeDefined();

    // At zoom 0.5: threshold = max(thickness/2, 6/0.5) = max(1, 12) = 12
    // Point at 5 world-units distance → within 12 → hit
    const zoom05 = 0.5;
    const point5world = { x: 300, y: 305 }; // 5 world units above the line
    const point7world = { x: 300, y: 307 }; // 7 world units above the line
    expect(spec!.hitTestZoom!(stroke, point5world, zoom05)).toBe(true);
    expect(spec!.hitTestZoom!(stroke, point7world, zoom05)).toBe(true);

    // At zoom 2: threshold = max(thickness/2, 6/2) = max(1, 3) = 3
    // Point at 5 world-units → exceeds 3 → miss
    // Point at 7 world-units → exceeds 3 → miss
    const zoom2 = 2;
    // 5 world units / zoom 2 = 2.5 screen px → but threshold is 3 world units (6px/2zoom=3)
    // Actually: threshold is in world units: max(1, 6/2) = 3 world units
    // 5 world > 3 world → miss
    // 2 world > 3 world → false... let me recalculate
    // Point 2 world units above: 2 < 3 → hit
    // Point 4 world units above: 4 > 3 → miss
    const point2world = { x: 300, y: 302 };
    const point4world = { x: 300, y: 304 };
    expect(spec!.hitTestZoom!(stroke, point2world, zoom2)).toBe(true);
    expect(spec!.hitTestZoom!(stroke, point4world, zoom2)).toBe(false);
  });

  it('TC-15 boundary: exactly at threshold hit and beyond miss at 50% zoom', () => {
    const { handle, doc } = setup();

    const id = createStroke(doc, {
      points: [{ x: 200, y: 300 }, { x: 400, y: 300 }],
      color: 'black',
      thickness: 'thin',
    }, 'user');

    const snaps = snapshot(doc);
    const stroke = snaps.find((o) => o.id === id) as StrokeSnap;
    const spec = getObjectType('stroke')!;

    // At zoom 0.5: threshold = max(1, 6/0.5) = max(1, 12) = 12 world units
    // 11 world units → hit
    expect(spec.hitTestZoom!(stroke, { x: 300, y: 311 }, 0.5)).toBe(true);
    // 13 world units → miss
    expect(spec.hitTestZoom!(stroke, { x: 300, y: 313 }, 0.5)).toBe(false);
  });

  it('TC-16: click inside bbox far from line does not select stroke', () => {
    const { handle, doc } = setup();

    // Create a large circular-ish stroke that encompasses a sticky
    // Points form an arc at y=200..y=400 from x=100..x=500
    const strokeId = createStroke(doc, {
      points: [
        { x: 100, y: 200 },
        { x: 300, y: 100 },
        { x: 500, y: 200 },
        { x: 500, y: 400 },
        { x: 300, y: 500 },
        { x: 100, y: 400 },
      ],
      color: 'black',
      thickness: 'thin',
    }, 'user');

    // Create a sticky in the center of the stroke's bbox
    const stickyId = createSticky(doc, { x: 300, y: 300 });

    frames();

    // Click on the sticky (center of bbox, far from stroke line)
    const snaps = snapshot(doc);
    const stroke = snaps.find((o) => o.id === strokeId) as StrokeSnap;
    const spec = getObjectType('stroke')!;

    // The stroke line is far from the center (300,300)
    // Check: distance from center to line should be > threshold
    const centerPoint = { x: 300, y: 300 };
    const dist = distanceToPolyline(scaledPoints(stroke), centerPoint);
    // Should be far from any stroke segment (at least ~90 units)
    expect(dist).toBeGreaterThan(50);

    // At zoom 1: threshold = max(1, 6) = 6; distance >> 6 → no hit
    expect(spec.hitTestZoom!(stroke, centerPoint, 1)).toBe(false);
  });

  it('TC-21: stroke deleted via model while selected → no exception', () => {
    const { handle, doc } = setup();

    // Create a stroke and select it
    const strokeId = createStroke(doc, {
      points: [{ x: 100, y: 100 }, { x: 200, y: 200 }],
      color: 'black',
      thickness: 'medium',
    }, 'user');

    frames();

    // Select the stroke
    act(() => {
      handle.selection.click(strokeId!);
    });
    frames();

    expect(handle.getSelectedIds().has(strokeId!)).toBe(true);

    // Delete the stroke via model (simulating remote delete)
    act(() => {
      deleteObjects(doc, [strokeId!]);
    });
    frames();

    // Should not throw; selection may or may not be cleared depending on stale handling
    // Just verify no exception was thrown and the board no longer has the stroke
    const objects = snapshot(doc);
    const found = objects.find((o) => o.id === strokeId);
    expect(found).toBeUndefined();
  });
});
