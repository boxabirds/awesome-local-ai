import { useCallback, useEffect, useRef, useState } from 'react';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';

/**
 * Shift+drag selection rectangle. The rect is kept in world units, so zooming during the drag is harmless.
 * `end` hands the ids of objects lying entirely inside to `onSelect` (nothing when there are none);
 * `cancel` (pointercancel, lost capture, Escape) discards it and leaves the selection unchanged.
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): { rect: Rect | null; begin(screen: Point): void; move(screen: Point): void; end(): void; cancel(): void } {
  const [rect, setRect] = useState<Rect | null>(null);
  const latest = useRef({ camera, snapshot, onSelect });
  latest.current = { camera, snapshot, onSelect };
  const startRef = useRef<Point | null>(null);
  const rectRef = useRef<Rect | null>(null);

  const set = (r: Rect | null) => {
    rectRef.current = r;
    setRect(r);
  };

  const begin = useCallback((screen: Point) => {
    const start = screenToWorld(latest.current.camera, screen);
    startRef.current = start;
    set(normalizeRect(start, start));
  }, []);

  const move = useCallback((screen: Point) => {
    const start = startRef.current;
    if (!start) return;
    set(normalizeRect(start, screenToWorld(latest.current.camera, screen)));
  }, []);

  const cancel = useCallback(() => {
    startRef.current = null;
    set(null);
  }, []);

  const end = useCallback(() => {
    const r = rectRef.current;
    startRef.current = null;
    set(null);
    if (!r) return;
    const ids = objectsInRect(latest.current.snapshot, r);
    if (ids.length > 0) latest.current.onSelect(ids);
  }, []);

  // Escape discards the marquee (and nothing else handles that Escape).
  const active = rect !== null;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      cancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, cancel]);

  return { rect, begin, move, end, cancel };
}

/** The light blue translucent selection rectangle, drawn in screen space. */
export function MarqueeRect(props: { rect: Rect | null; camera: Camera }) {
  const { rect, camera } = props;
  if (!rect) return null;
  const p = worldToScreen(camera, rect);
  return (
    <div
      className="marquee"
      data-testid="marquee"
      aria-hidden="true"
      style={{ left: p.x, top: p.y, width: rect.width * camera.zoom, height: rect.height * camera.zoom }}
    />
  );
}
