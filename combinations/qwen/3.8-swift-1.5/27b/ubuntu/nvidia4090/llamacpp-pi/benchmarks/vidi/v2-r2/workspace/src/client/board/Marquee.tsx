import { useCallback, useRef, useState, type ReactElement } from 'react';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Rect } from '../../shared/geometry';
import { screenToWorld, type Camera } from '../canvas/camera';

/**
 * Marquee selection (story 7, sel.marquee): Shift + drag on empty space draws
 * a rect in WORLD space and select-adds the objects lying entirely inside on
 * release. Cancel (pointercancel / Escape) leaves the selection unchanged.
 * The rect is rendered in the world layer (MarqueeRect).
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void
) {
  const [rect, setRect] = useState<Rect | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const begin = useCallback((screen: { x: number; y: number }) => {
    startRef.current = screenToWorld(cameraRef.current, screen);
    rectRef.current = null;
    setRect(null);
  }, []);

  const move = useCallback((screen: { x: number; y: number }) => {
    const start = startRef.current;
    if (!start) return;
    const r = normalizeRect(start, screenToWorld(cameraRef.current, screen));
    rectRef.current = r;
    setRect(r);
  }, []);

  const end = useCallback(() => {
    const r = rectRef.current;
    startRef.current = null;
    rectRef.current = null;
    setRect(null);
    if (r && (r.width > 0 || r.height > 0)) {
      const ids = objectsInRect(snapshotRef.current, r);
      if (ids.length > 0) onSelectRef.current(ids);
    }
  }, []);

  const cancel = useCallback(() => {
    startRef.current = null;
    rectRef.current = null;
    setRect(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

/** World-space marquee rectangle (render inside the viewport world layer). */
export function MarqueeRect({ rect }: { rect: Rect | null }): ReactElement | null {
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;
  return (
    <div
      data-testid="marquee-rect"
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        background: 'rgba(37, 99, 235, 0.15)',
        border: '1px solid #2563eb',
        boxSizing: 'border-box',
        pointerEvents: 'none',
      }}
    />
  );
}
