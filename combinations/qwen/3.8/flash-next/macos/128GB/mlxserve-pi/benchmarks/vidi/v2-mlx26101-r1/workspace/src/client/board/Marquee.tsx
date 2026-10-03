// Shift+drag marquee selection (story 7).
//
// Holding Shift and dragging from anywhere (including empty board) draws a box; on
// release every object lying *fully* inside it is added to the selection (additive,
// so a marquee can build on what is already selected). Like the PRD says, it
// "selects all objects fully inside the box": an object only partly inside, or that
// merely touches an edge from outside, is left alone. An object whose type is not
// registered is never selected — we do not select what we cannot render. The marquee
// is a screen-space overlay: its box is stored in world units and converted to screen
// pixels for drawing, so it lines up with the board at any zoom.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, rectContains, type Rect } from '../../shared/geometry';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import type { SelectionApi } from './useSelection';

/** Is the whole object inside the marquee `rect`? Unknown types never are. */
export function fullyInside(obj: ObjectSnapshot, rect: Rect): boolean {
  if (!getObjectType(obj.type)) return false; // never select what we cannot render
  return rectContains(rect, objectBounds(obj));
}

/** The dashed marquee box, drawn in screen space from a world-space rect. */
export function MarqueeRect({
  rect,
  camera,
}: {
  rect: Rect;
  camera: Camera;
}): ReactElement {
  const tl = worldToScreen(camera, { x: rect.x, y: rect.y });
  return (
    <div
      data-testid="marquee"
      className="marquee"
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: tl.x,
        top: tl.y,
        width: rect.width * camera.zoom,
        height: rect.height * camera.zoom,
        pointerEvents: 'none',
      }}
    />
  );
}

export interface UseMarqueeOptions {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  selection: SelectionApi;
  canEdit: boolean;
}

export interface Marquee {
  /** Begin a marquee at this Shift+pointer-down screen point (client px). */
  start(p: Point): void;
  /** The live marquee rect in world units, or null when not dragging. */
  rect: Rect | null;
  active: boolean;
}

/**
 * Drives the marquee. `start` is called from the board surface's Shift+pointer-down
 * (which must then not begin a pan). Move / up run on the window; the selection is
 * committed once, on release, additively.
 */
export function useMarquee(opts: UseMarqueeOptions): Marquee {
  const live = useRef(opts);
  live.current = opts;
  const origin = useRef<Point | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  const finish = useCallback(() => {
    origin.current = null;
    setRect((current) => {
      if (current) {
        const { snapshot, selection } = live.current;
        const ids = snapshot.filter((o) => fullyInside(o, current)).map((o) => o.id);
        if (ids.length > 0) selection.setMany(ids, true);
      }
      return null;
    });
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const o = origin.current;
      if (!o) return;
      const cur = screenToWorld(live.current.camera, {
        x: e.clientX,
        y: e.clientY,
      });
      setRect(normalizeRect(o, cur));
    };
    const onUp = () => {
      if (origin.current) finish();
    };
    // A cancelled marquee is discarded, not committed: the selection is unchanged.
    const onCancel = () => {
      origin.current = null;
      setRect(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [finish]);

  const start = useCallback((p: Point) => {
    const { camera, canEdit } = live.current;
    if (!canEdit) return;
    const o = screenToWorld(camera, p);
    origin.current = o;
    setRect({ x: o.x, y: o.y, width: 0, height: 0 });
  }, []);

  return { start, rect, active: rect !== null };
}
