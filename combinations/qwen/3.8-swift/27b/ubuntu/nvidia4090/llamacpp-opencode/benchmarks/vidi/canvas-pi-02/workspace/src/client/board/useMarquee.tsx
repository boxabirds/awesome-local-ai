// Shift+drag marquee selection (story 7, sel.marquee_ui).
//
// The rect is kept in WORLD units so zooming mid-drag cannot skew it.
// Selection is ADDITIVE (marquee adds to the current selection, PRD) and
// only counts objects ENTIRELY inside (objectsInRect). An empty marquee
// (no fully-contained objects) leaves the selection unchanged. pointercancel
// cancels without selecting; Escape while active does the same.

import { useCallback, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import { screenToWorld, type Camera } from '../canvas/camera';

export interface MarqueeApi {
  /** The live marquee rect in world units, null when inactive. */
  rect: Rect | null;
  /** Begin a marquee at a screen point (Shift+pointerdown on empty space). */
  begin(screen: Point): void;
  /** Track the pointer (screen point). */
  move(screen: Point): void;
  /** Release: select all fully-contained objects additively. */
  end(): void;
  /** Cancel (pointercancel / Escape): no selection change. */
  cancel(): void;
}

export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): MarqueeApi {
  const [rect, setRect] = useState<Rect | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const startRef = useRef<Point | null>(null);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const update = (r: Rect | null): void => {
    rectRef.current = r;
    setRect(r);
  };

  const begin = useCallback((screen: Point) => {
    const world = screenToWorld(cameraRef.current, screen);
    startRef.current = world;
    update(normalizeRect(world, world));
  }, []);

  const move = useCallback((screen: Point) => {
    const start = startRef.current;
    if (start === null) return;
    update(normalizeRect(start, screenToWorld(cameraRef.current, screen)));
  }, []);

  const end = useCallback(() => {
    const r = rectRef.current;
    startRef.current = null;
    update(null);
    if (r === null) return;
    const ids = objectsInRect(snapshotRef.current, r);
    if (ids.length > 0) onSelectRef.current(ids);
  }, []);

  const cancel = useCallback(() => {
    startRef.current = null;
    update(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

/** Renders the live marquee rect in the WORLD layer (world units). */
export function MarqueeRect(props: { rect: Rect | null; camera: Camera }): ReactElement | null {
  if (props.rect === null) return null;
  return (
    <div
      className="marquee-rect"
      data-testid="marquee-rect"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: props.rect.x,
        top: props.rect.y,
        width: props.rect.width,
        height: props.rect.height,
      }}
    />
  );
}
