import { useCallback, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ObjectSnapshot } from '@/shared/board-model';
import { objectsInRect } from '@/shared/board-model';
import { normalizeRect, type Point, type Rect } from '@/shared/geometry';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';

/**
 * Shift+drag marquee selection (story 7, sel.marquee_ui).
 *
 * The rect is stored in WORLD units (converted on every move with the live
 * camera), so zooming or panning mid-drag is harmless. On `end`, the ids of
 * all objects lying ENTIRELY inside the rect (objectsInRect) are handed to
 * `onSelect`, which the Board wires to `selection.setMany(ids, additive =
 * true)` — the marquee ADDS to the existing selection. `cancel`
 * (pointercancel / lostpointercapture / Escape) discards the drag with no
 * selection change.
 */

export interface Marquee {
  /** The live rect in world units, or null when not dragging. */
  rect: Rect | null;
  begin(screen: Point): void;
  move(screen: Point): void;
  end(): void;
  cancel(): void;
}

export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): Marquee {
  const [drag, setDrag] = useState<{ start: Point; current: Point } | null>(null);
  const dragRef = useRef<{ start: Point; current: Point } | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const setBoth = (next: { start: Point; current: Point } | null): void => {
    dragRef.current = next;
    setDrag(next);
  };

  const begin = useCallback((screen: Point): void => {
    const world = screenToWorld(cameraRef.current, screen);
    setBoth({ start: world, current: world });
  }, []);

  const move = useCallback((screen: Point): void => {
    if (dragRef.current === null) return;
    const current = screenToWorld(cameraRef.current, screen);
    setBoth({ start: dragRef.current.start, current });
  }, []);

  const end = useCallback((): void => {
    const d = dragRef.current;
    if (d === null) return;
    setBoth(null);
    // Empty result (no fully-inside objects) leaves the selection unchanged
    // because setMany with an empty additive batch is a no-op.
    onSelectRef.current(objectsInRect(snapshotRef.current, normalizeRect(d.start, d.current)));
  }, []);

  const cancel = useCallback((): void => {
    setBoth(null);
  }, []);

  const rect = drag !== null ? normalizeRect(drag.start, drag.current) : null;
  return { rect, begin, move, end, cancel };
}

/**
 * The translucent marquee rectangle, drawn in screen space (fixed
 * positioning) from the world rect and the live camera.
 */
export function MarqueeRect(props: { rect: Rect | null; camera: Camera }): ReactElement | null {
  const { rect, camera } = props;
  if (rect === null) return null;
  const tl = worldToScreen(camera, { x: rect.x, y: rect.y });
  return (
    <div
      data-testid="marquee"
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: tl.x,
        top: tl.y,
        width: rect.width * camera.zoom,
        height: rect.height * camera.zoom,
        background: 'rgba(26, 115, 232, 0.12)',
        border: '1px solid #1A73E8',
        pointerEvents: 'none',
        zIndex: 10001,
      }}
    />
  );
}
