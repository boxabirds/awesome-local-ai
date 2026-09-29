// Shift+drag selection rectangle (story 7). The rectangle is kept in world units, so zooming
// during the drag is harmless.
import { useCallback, useEffect, useRef, useState } from 'react';
import { type ObjectSnapshot, objectsInRect } from '../../shared/board-model';
import { type Point, type Rect, normalizeRect } from '../../shared/geometry';
import { type Camera, screenToWorld } from '../canvas/camera';
import { isRegisteredType } from '../objects/registry';

export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): {
  rect: Rect | null;
  begin(screen: Point): void;
  move(screen: Point): void;
  end(): void;
  cancel(): void;
} {
  const latest = useRef({ camera, snapshot, onSelect });
  latest.current = { camera, snapshot, onSelect };
  const startRef = useRef<Point | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  const update = (next: Rect | null) => {
    rectRef.current = next;
    setRect(next);
  };

  const begin = useCallback((screen: Point) => {
    const world = screenToWorld(latest.current.camera, screen);
    startRef.current = world;
    update(normalizeRect(world, world));
  }, []);

  const move = useCallback((screen: Point) => {
    const start = startRef.current;
    if (!start) return;
    update(normalizeRect(start, screenToWorld(latest.current.camera, screen)));
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
    const ids = objectsInRect(latest.current.snapshot, r, isRegisteredType);
    // Nothing fully inside: the selection stays as it was.
    if (ids.length > 0) latest.current.onSelect(ids);
  }, []);

  // Escape abandons the rectangle (and does not also clear the selection).
  const active = rect !== null;
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [active, cancel]);

  return { rect, begin, move, end, cancel };
}

/** The translucent light blue rectangle, drawn in the world layer. */
export function MarqueeRect(props: { rect: Rect | null; camera: Camera }) {
  const { rect, camera } = props;
  if (!rect) return null;
  return (
    <div
      className="marquee"
      data-testid="marquee"
      aria-hidden="true"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        borderWidth: 1 / camera.zoom,
      }}
    />
  );
}
