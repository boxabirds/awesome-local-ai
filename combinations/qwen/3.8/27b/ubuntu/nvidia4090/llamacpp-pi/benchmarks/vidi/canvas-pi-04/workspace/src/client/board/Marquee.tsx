// Story 7: shift+drag marquee selection (anchor: sel.marquee_ui).
//
// `useMarquee` tracks the marquee rect in WORLD units (so a zoom change during
// the drag is harmless) and, on `end`, reports the ids of the objects whose
// bounds intersect the rect via `objectsInRect` -> `onSelect` (wired to
// `setMany(ids, additive=true)`). `MarqueeRect` renders the translucent
// rectangle in screen space (converted from world with the camera).

import { useCallback, useRef, useState } from 'react';
import type { JSX } from 'react';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';

export interface Marquee {
  /** The current marquee rect in world units, or null when idle. */
  rect: Rect | null;
  begin: (screen: Point) => void;
  move: (screen: Point) => void;
  end: () => void;
  cancel: () => void;
}

export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): Marquee {
  const [rect, setRect] = useState<Rect | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const startRef = useRef<Point | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const begin = useCallback((screen: Point): void => {
    const s = screenToWorld(cameraRef.current, screen);
    startRef.current = s;
    const r = normalizeRect(s, s);
    rectRef.current = r;
    setRect(r);
  }, []);

  const move = useCallback((screen: Point): void => {
    const s = startRef.current;
    if (s === null) return;
    const r = normalizeRect(s, screenToWorld(cameraRef.current, screen));
    rectRef.current = r;
    setRect(r);
  }, []);

  const end = useCallback((): void => {
    const r = rectRef.current;
    startRef.current = null;
    rectRef.current = null;
    setRect(null);
    if (r !== null && (r.width > 0 || r.height > 0)) {
      const ids = objectsInRect(snapshot, r);
      if (ids.length > 0) onSelect(ids);
    }
  }, [snapshot, onSelect]);

  const cancel = useCallback((): void => {
    startRef.current = null;
    rectRef.current = null;
    setRect(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

export function MarqueeRect(props: { rect: Rect | null; camera: Camera }): JSX.Element | null {
  const { rect, camera } = props;
  if (rect === null) return null;
  const width = rect.width * camera.zoom;
  const height = rect.height * camera.zoom;
  if (width <= 0 && height <= 0) return null;
  const topLeft = worldToScreen(camera, { x: rect.x, y: rect.y });
  return (
    <div
      className="marquee-rect"
      style={{ left: topLeft.x, top: topLeft.y, width, height }}
      aria-hidden="true"
    />
  );
}
