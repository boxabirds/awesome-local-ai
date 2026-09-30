/**
 * Component tests for the stroke object (story 11, stroke.object).
 * TC-15, TC-16, TC-21. Real Y.Doc; registry hit test; selection pruning.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { render, renderHook, act } from '@testing-library/react';
import { useEffect, useReducer } from 'react';
import { getObjectType } from '../../src/client/objects/registry';
import { StrokeObject } from '../../src/client/objects/StrokeObject';
import { createStroke, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { initDoc, objectSnapshot, deleteObjects } from '../../src/shared/board-model';
import { useSelection } from '../../src/client/board/useSelection';
import {
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
} from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import type { ObjectProps } from '../../src/client/objects/registry';

/** A straight horizontal line from (0,0) to (100,0) at the given thickness. */
function makeLineDoc(doc: Y.Doc, thickness: 'medium' | 'thick' = 'medium'): StrokeSnap {
  const line: Point[] = [];
  for (let i = 0; i <= 10; i++) line.push({ x: i * 10, y: 0 });
  const id = createStroke(doc, { points: line, color: 'black', thickness }, 'u1');
  const snap = objectSnapshot(doc).find((o) => o.id === id) as StrokeSnap;
  return snap;
}

function strokeProps(snap: StrokeSnap, doc: Y.Doc, overrides?: Partial<ObjectProps>): ObjectProps {
  return {
    obj: snap,
    doc,
    z: snap.z,
    zoom: 1,
    selected: false,
    editing: false,
    editable: true,
    onPointerDown: () => {},
    onStartEdit: () => {},
    onEndEdit: () => {},
    ...overrides,
  };
}

describe('stroke.object (TC-15, TC-16, TC-21)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  it('TC-15: registry hitTest at 5px and 7px screen distance → hit / miss at 50%, 100% and 200% zoom', () => {
    const spec = getObjectType('stroke');
    expect(spec).toBeDefined();
    const snap = makeLineDoc(doc); // medium thickness: half = 2 world units

    for (const zoom of [0.5, 1, 2] as const) {
      const tol = Math.max(PEN_THICKNESS_WORLD.medium / 2, STROKE_HIT_TOLERANCE_PX / zoom);
      const hitWorld = 5 / zoom; // 5 screen px → world distance
      const missWorld = 7 / zoom; // 7 screen px → world distance
      expect(hitWorld).toBeLessThanOrEqual(tol + 1e-9);
      expect(missWorld).toBeGreaterThan(tol);
      expect(spec!.hitTest(snap, { x: 50, y: hitWorld }, zoom), `5px at zoom ${zoom}`).toBe(true);
      expect(spec!.hitTest(snap, { x: 50, y: missWorld }, zoom), `7px at zoom ${zoom}`).toBe(false);
    }
  });

  it('TC-16: click inside the stroke bbox far from the line over a sticky → the sticky is the hit target, not the stroke', () => {
    const spec = getObjectType('stroke')!;

    // A sticky covering (0,0)-(200,200).
    const stickyObj = new Y.Map();
    stickyObj.set('type', 'sticky');
    stickyObj.set('x', 0);
    stickyObj.set('y', 0);
    stickyObj.set('width', 200);
    stickyObj.set('height', 200);
    stickyObj.set('z', 1);
    stickyObj.set('color', 'yellow');
    stickyObj.set('text', new Y.Text());
    stickyObj.set('createdAt', Date.now());
    doc.transact(() => {
      (doc.getMap('objects') as Y.Map<Y.Map<unknown>>).set('sticky-1', stickyObj);
    });

    // An L-shaped stroke inside the sticky's area: its bbox spans
    // ~(8,8)-(192,192) but its line runs along the top and left edges.
    const corner: Point[] = [
      { x: 10, y: 10 },
      { x: 190, y: 10 },
      { x: 190, y: 190 },
      { x: 10, y: 190 },
      { x: 10, y: 10 },
    ];
    const strokeId = createStroke(doc, { points: corner, color: 'red', thickness: 'medium' }, 'u1');
    const stroke = objectSnapshot(doc).find((o) => o.id === strokeId) as StrokeSnap;
    const sticky = objectSnapshot(doc).find((o) => o.id === 'sticky-1')!;

    // The click: world (100,100) — inside the stroke's bbox, far from its line.
    const click: Point = { x: 100, y: 100 };
    expect(spec.hitTest(stroke, click, 1)).toBe(false); // stroke missed
    expect(getObjectType('sticky')!.hitTest(sticky, click, 1)).toBe(true); // sticky hit

    // DOM: the stroke's SVG root has no pointer events, so a browser click at
    // (100,100) passes through the stroke and lands on the sticky below.
    const onPointerDown = vi.fn();
    const { container } = render(<StrokeObject {...strokeProps(stroke, doc, { onPointerDown })} />);
    const svg = container.querySelector('svg[data-testid="stroke-object"]') as SVGSVGElement;
    expect(svg).not.toBeNull();
    expect(svg.style.pointerEvents).toBe('none');
    // The only hittable part is the transparent line path.
    const hitPath = container.querySelector('path[data-testid="stroke-hit-path"]') as SVGPathElement;
    expect(hitPath).not.toBeNull();
    expect(hitPath.getAttribute('pointer-events')).toBe('stroke');
    // A click on the line path selects the stroke.
    act(() => {
      hitPath.dispatchEvent(
        Object.assign(new Event('pointerdown', { bubbles: true }), {
          button: 0,
        })
      );
    });
    expect(onPointerDown).toHaveBeenCalledTimes(1);
    expect(onPointerDown.mock.calls[0][1]).toBe(stroke.id);
  });

  it('TC-21: stroke deleted (remotely) while selected → selection cleared, no exception', () => {
    const snap0 = makeLineDoc(doc);
    const id = snap0.id;

    // A hook that mirrors Board: snapshot → useSelection, re-running on updates.
    const { result } = renderHook(
      ({ d }) => {
        const [, force] = useReducer((c: number) => c + 1, 0);
        useEffect(() => {
          const h = () => force();
          d.on('update', h);
          return () => {
            d.off('update', h);
          };
        }, [d]);
        return useSelection(objectSnapshot(d));
      },
      { initialProps: { d: doc } }
    );

    act(() => {
      result.current.click(id);
    });
    expect(result.current.ids.has(id)).toBe(true);

    // Remote delete: the object disappears from the doc.
    act(() => {
      expect(deleteObjects(doc, [id])).toBe(1);
    });

    // Selection pruned automatically, no exception thrown.
    expect(result.current.ids.size).toBe(0);
    expect(objectSnapshot(doc)).toHaveLength(0);
  });

  it('renders a smoothed path with round caps, stored thickness and an accessible name', () => {
    const snap = makeLineDoc(doc, 'thick');
    const { container } = render(<StrokeObject {...strokeProps(snap, doc, { selected: true, zoom: 2 })} />);

    const path = container.querySelector('svg[data-testid="stroke-object"] > path') as SVGPathElement;
    expect(path).not.toBeNull();
    // Path data is in the SVG's local (bbox-relative) coordinate space:
    // for a thick line from (0,0) to (100,0) the bbox is (-4,-4)-(104,4),
    // so the first world point sits at local (4,4) — not at world coords.
    expect(path.getAttribute('d')).toMatch(/^M 4 4 /);
    expect(path.getAttribute('stroke-linecap')).toBe('round');
    expect(path.getAttribute('stroke-linejoin')).toBe('round');
    expect(path.getAttribute('fill')).toBe('none');
    // Thickness is in world units and NOT scaled by zoom.
    expect(path.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.thick));
    const svg = container.querySelector('svg[data-testid="stroke-object"]') as SVGSVGElement;
    expect(svg.getAttribute('aria-label')).toBe('Drawing');
    // The hit path widens with the zoom-scaled tolerance (max(thickness, 12/zoom)).
    const hitPath = container.querySelector('path[data-testid="stroke-hit-path"]') as SVGPathElement;
    expect(hitPath.getAttribute('stroke-width')).toBe(String(Math.max(PEN_THICKNESS_WORLD.thick, 12 / 2)));

    // scaledPoints renders the stored line in world space (shared model).
    const pts = scaledPoints(snap);
    expect(pts[0].x).toBeCloseTo(0, 5);
    expect(pts[pts.length - 1].x).toBeCloseTo(100, 5);
  });
});
