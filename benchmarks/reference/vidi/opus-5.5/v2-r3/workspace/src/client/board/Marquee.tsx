import { useCallback, useEffect, useRef, useState } from 'react';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import { screenToWorld, type Camera } from '../canvas/camera';

export interface Marquee {
  /** The rectangle in world units while dragging, else null. */
  rect: Rect | null;
  begin(screen: Point): void;
  move(screen: Point): void;
  end(): void;
  cancel(): void;
}

/**
 * Shift+drag box selection (sel.marquee). Points are viewport pixels; the
 * rectangle is kept in world units so zooming mid-drag is harmless. On `end`
 * the ids of objects entirely inside are handed to `onSelect` (nothing when
 * none); `cancel` (pointercancel, Escape) leaves the selection unchanged.
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): Marquee {
  const [rect, setRect] = useState<Rect | null>(null);
  const startRef = useRef<Point | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const latest = useRef({ camera, snapshot, onSelect });
  latest.current = { camera, snapshot, onSelect };

  const update = (r: Rect | null) => {
    rectRef.current = r;
    setRect(r);
  };

  const begin = useCallback((screen: Point) => {
    const start = screenToWorld(latest.current.camera, screen);
    startRef.current = start;
    update(normalizeRect(start, start));
  }, []);

  const move = useCallback((screen: Point) => {
    if (!startRef.current) return;
    update(normalizeRect(startRef.current, screenToWorld(latest.current.camera, screen)));
  }, []);

  const cancel = useCallback(() => {
    if (!startRef.current) return;
    startRef.current = null;
    update(null);
  }, []);

  const end = useCallback(() => {
    const r = rectRef.current;
    if (!startRef.current || !r) return;
    startRef.current = null;
    update(null);
    const ids = objectsInRect(latest.current.snapshot, r);
    if (ids.length > 0) latest.current.onSelect(ids);
  }, []);

  // Escape cancels before the board's own Escape (clear selection) sees it.
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

/** The translucent selection rectangle, drawn in the world layer. */
export function MarqueeRect(props: { rect: Rect | null; camera: Camera }) {
  if (!props.rect) return null;
  const { x, y, width, height } = props.rect;
  return (
    <div
      className="marquee"
      data-testid="marquee"
      aria-hidden="true"
      style={{ left: x, top: y, width, height, borderWidth: 1 / props.camera.zoom }}
    />
  );
}
