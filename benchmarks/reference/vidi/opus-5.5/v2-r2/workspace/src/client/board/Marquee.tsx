import { useCallback, useEffect, useRef, useState } from 'react';
import { type ObjectSnapshot, objectsInRect } from '../../shared/board-model';
import { type Point, type Rect, normalizeRect } from '../../shared/geometry';
import { type Camera, screenToWorld } from '../canvas/camera';

export interface MarqueeControls {
  rect: Rect | null;
  begin(screen: Point): void;
  move(screen: Point): void;
  end(): void;
  cancel(): void;
}

/**
 * Shift+drag selection rectangle. Stored in world units, so zooming mid-drag is
 * harmless. `end` hands the ids of objects entirely inside to `onSelect`
 * (nothing when none); `cancel` (pointercancel, Escape) changes nothing.
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): MarqueeControls {
  const [rect, setRect] = useState<Rect | null>(null);
  const start = useRef<Point | null>(null);
  const current = useRef<Rect | null>(null);
  const latest = useRef({ camera, snapshot, onSelect });
  latest.current = { camera, snapshot, onSelect };

  const begin = useCallback((screen: Point) => {
    const w = screenToWorld(latest.current.camera, screen);
    start.current = w;
    current.current = normalizeRect(w, w);
    setRect(current.current);
  }, []);

  const move = useCallback((screen: Point) => {
    if (!start.current) return;
    current.current = normalizeRect(start.current, screenToWorld(latest.current.camera, screen));
    setRect(current.current);
  }, []);

  const cancel = useCallback(() => {
    start.current = null;
    current.current = null;
    setRect(null);
  }, []);

  const end = useCallback(() => {
    const r = current.current;
    cancel();
    if (!r) return;
    const ids = objectsInRect(latest.current.snapshot, r);
    if (ids.length > 0) latest.current.onSelect(ids);
  }, [cancel]);

  // Escape abandons the rectangle.
  const active = rect !== null;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Capture phase + preventDefault: the board's Escape (clear selection) must not run too.
      e.preventDefault();
      cancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, cancel]);

  return { rect, begin, move, end, cancel };
}

/** The translucent rectangle, drawn in the (scaled) world layer. */
export function MarqueeRect(props: { rect: Rect | null; camera: Camera }): React.JSX.Element | null {
  const { rect } = props;
  if (!rect) return null;
  return (
    <div
      className="marquee-rect"
      data-testid="marquee"
      aria-hidden="true"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        borderWidth: 1 / props.camera.zoom,
        zIndex: Number.MAX_SAFE_INTEGER,
      }}
    />
  );
}
