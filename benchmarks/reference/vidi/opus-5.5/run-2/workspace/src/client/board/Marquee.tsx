/**
 * Shift+drag selection rectangle (anchor: sel.marquee_ui). The rectangle is kept in world
 * units, so a zoom change during the drag is harmless. On release every object lying
 * entirely inside it is added to the selection; cancel (pointercancel, lost capture or
 * Escape) leaves the selection unchanged.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { screenToWorld, type Camera } from '../canvas/camera';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';

export interface MarqueeApi {
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
): MarqueeApi {
  const latest = useRef({ camera, snapshot, onSelect });
  latest.current = { camera, snapshot, onSelect };
  const start = useRef<Point | null>(null);
  const current = useRef<Rect | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  const update = (next: Rect | null) => {
    current.current = next;
    setRect(next);
  };

  const begin = useCallback((screen: Point) => {
    const world = screenToWorld(latest.current.camera, screen);
    start.current = world;
    update(normalizeRect(world, world));
  }, []);

  const move = useCallback((screen: Point) => {
    if (start.current === null) return;
    update(normalizeRect(start.current, screenToWorld(latest.current.camera, screen)));
  }, []);

  const end = useCallback(() => {
    const r = current.current;
    start.current = null;
    update(null);
    if (r === null) return;
    const ids = objectsInRect(latest.current.snapshot, r);
    if (ids.length > 0) latest.current.onSelect(ids);
  }, []);

  const cancel = useCallback(() => {
    start.current = null;
    update(null);
  }, []);

  // Escape during the drag discards the rectangle.
  const active = rect !== null;
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, cancel]);

  return { rect, begin, move, end, cancel };
}

/** The translucent rectangle, drawn in the world layer (border stays 1 screen pixel). */
export function MarqueeRect(props: { rect: Rect | null; camera: Camera }): React.JSX.Element | null {
  const { rect, camera } = props;
  if (rect === null) return null;
  return (
    <div
      className="marquee"
      data-testid="marquee"
      aria-hidden="true"
      style={{
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        borderWidth: `${1 / camera.zoom}px`,
      }}
    />
  );
}
