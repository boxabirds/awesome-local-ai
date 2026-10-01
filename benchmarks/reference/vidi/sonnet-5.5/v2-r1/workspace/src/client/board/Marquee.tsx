import { useCallback, useRef, useState } from 'react';
import { objectsInRect } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect } from '../../shared/geometry';
import type { Point, Rect } from '../../shared/geometry';
import { screenToWorld } from '../canvas/camera';
import type { Camera } from '../canvas/camera';

/** Shift+drag selection rectangle. Points are viewport-local screen points; the rect is kept in world units. */
export function useMarquee(camera: Camera, snapshot: readonly ObjectSnapshot[], onSelect: (ids: string[]) => void) {
  const [rect, setRect] = useState<Rect | null>(null);
  const live = useRef({ camera, snapshot, onSelect });
  live.current = { camera, snapshot, onSelect };
  const start = useRef<Point | null>(null);
  const current = useRef<Rect | null>(null);

  const set = (next: Rect | null) => {
    current.current = next;
    setRect(next);
  };

  const begin = useCallback((screen: Point) => {
    start.current = screenToWorld(live.current.camera, screen);
    set({ x: start.current.x, y: start.current.y, width: 0, height: 0 });
  }, []);

  const move = useCallback((screen: Point) => {
    if (!start.current) return;
    set(normalizeRect(start.current, screenToWorld(live.current.camera, screen)));
  }, []);

  const end = useCallback(() => {
    const done = current.current;
    start.current = null;
    if (!done) return;
    set(null);
    const ids = objectsInRect(live.current.snapshot, done);
    if (ids.length > 0) live.current.onSelect(ids);
  }, []);

  const cancel = useCallback(() => {
    start.current = null;
    if (current.current) set(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

export function MarqueeRect(props: { rect: Rect | null; camera: Camera }) {
  if (!props.rect) return null;
  const { x, y, width, height } = props.rect;
  return (
    <div
      className="marquee"
      data-testid="marquee"
      style={{ left: x, top: y, width, height, borderWidth: 1 / props.camera.zoom }}
    />
  );
}
