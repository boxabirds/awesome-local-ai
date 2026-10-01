import { useCallback, useRef, useState } from 'react';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Rect } from '../../shared/geometry';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';

/** Shift+drag selection rectangle. Points are viewport-relative screen points; the rect is kept in world units. */
export function useMarquee(camera: Camera, snapshot: readonly ObjectSnapshot[], onSelect: (ids: string[]) => void) {
  const [rect, setRect] = useState<Rect | null>(null);
  const start = useRef<Point | null>(null);
  const live = useRef({ camera, snapshot, onSelect, rect: null as Rect | null });
  live.current.camera = camera;
  live.current.snapshot = snapshot;
  live.current.onSelect = onSelect;

  const set = (r: Rect | null) => { live.current.rect = r; setRect(r); };

  const begin = useCallback((screen: Point) => {
    start.current = screenToWorld(live.current.camera, screen);
    set({ x: start.current.x, y: start.current.y, width: 0, height: 0 });
  }, []);
  const move = useCallback((screen: Point) => {
    if (!start.current) return;
    set(normalizeRect(start.current, screenToWorld(live.current.camera, screen)));
  }, []);
  const end = useCallback(() => {
    const r = live.current.rect;
    start.current = null;
    if (!r) return;
    set(null);
    const ids = objectsInRect(live.current.snapshot, r);
    if (ids.length > 0) live.current.onSelect(ids);
  }, []);
  const cancel = useCallback(() => {
    start.current = null;
    if (live.current.rect) set(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

export function MarqueeRect(props: { rect: Rect | null; camera: Camera }) {
  const { rect, camera } = props;
  if (!rect) return null;
  return (
    <div
      className="marquee"
      data-testid="marquee"
      style={{
        left: rect.x, top: rect.y, width: rect.width, height: rect.height, borderWidth: 1 / camera.zoom,
      }}
    />
  );
}
