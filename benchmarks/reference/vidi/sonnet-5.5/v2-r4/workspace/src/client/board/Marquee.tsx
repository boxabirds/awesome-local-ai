import { useCallback, useEffect, useRef, useState } from 'react';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Rect } from '../../shared/geometry';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';

/**
 * Shift+drag selection rectangle. Points are viewport-local screen points; the rectangle is kept in world
 * units so a zoom during the drag is harmless.
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): { rect: Rect | null; begin(screen: Point): void; move(screen: Point): void; end(): void; cancel(): void } {
  const [rect, setRect] = useState<Rect | null>(null);
  const live = useRef({ camera, snapshot, onSelect });
  live.current = { camera, snapshot, onSelect };
  const origin = useRef<Point | null>(null);
  const current = useRef<Rect | null>(null);

  const begin = useCallback((screen: Point) => {
    const p = screenToWorld(live.current.camera, screen);
    origin.current = p;
    current.current = normalizeRect(p, p);
    setRect(current.current);
  }, []);

  const move = useCallback((screen: Point) => {
    if (!origin.current) return;
    current.current = normalizeRect(origin.current, screenToWorld(live.current.camera, screen));
    setRect(current.current);
  }, []);

  const cancel = useCallback(() => {
    origin.current = null;
    current.current = null;
    setRect(null);
  }, []);

  const end = useCallback(() => {
    const r = current.current;
    cancel();
    if (!r) return;
    const ids = objectsInRect(live.current.snapshot, r);
    if (ids.length > 0) live.current.onSelect(ids);
  }, [cancel]);

  const active = rect !== null;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, cancel]);

  return { rect, begin, move, end, cancel };
}

export function MarqueeRect({ rect, camera }: { rect: Rect | null; camera: Camera }) {
  if (!rect) return null;
  return (
    <div
      data-testid="marquee"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        background: 'rgba(30,136,229,0.15)',
        border: `${1 / camera.zoom}px solid #1e88e5`,
        boxSizing: 'border-box',
        pointerEvents: 'none',
        zIndex: 1_000_000_000,
      }}
    />
  );
}
