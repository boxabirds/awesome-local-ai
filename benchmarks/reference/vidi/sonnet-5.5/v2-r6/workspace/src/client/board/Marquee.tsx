import { useCallback, useRef, useState } from 'react';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import { screenToWorld, type Camera } from '../canvas/camera';

const MARQUEE_BORDER_PX = 1;

/** Shift+drag rectangle. The rect is kept in world units, so zooming mid-drag is harmless. */
export function useMarquee(camera: Camera, snapshot: readonly ObjectSnapshot[], onSelect: (ids: string[]) => void) {
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
    startRef.current = screenToWorld(latest.current.camera, screen);
    set({ x: startRef.current.x, y: startRef.current.y, width: 0, height: 0 });
  }, []);
  const move = useCallback((screen: Point) => {
    if (!startRef.current) return;
    set(normalizeRect(startRef.current, screenToWorld(latest.current.camera, screen)));
  }, []);
  const end = useCallback(() => {
    const r = rectRef.current;
    startRef.current = null;
    set(null);
    if (!r) return;
    const ids = objectsInRect(latest.current.snapshot, r);
    if (ids.length > 0) latest.current.onSelect(ids);
  }, []);
  const cancel = useCallback(() => {
    startRef.current = null;
    set(null);
  }, []);
  return { rect, begin, move, end, cancel };
}

export function MarqueeRect({ rect, camera }: { rect: Rect | null; camera: Camera }) {
  if (!rect) return null;
  return (
    <div
      className="marquee"
      data-testid="marquee"
      style={{
        left: rect.x, top: rect.y, width: rect.width, height: rect.height,
        borderWidth: MARQUEE_BORDER_PX / camera.zoom,
      }}
    />
  );
}
