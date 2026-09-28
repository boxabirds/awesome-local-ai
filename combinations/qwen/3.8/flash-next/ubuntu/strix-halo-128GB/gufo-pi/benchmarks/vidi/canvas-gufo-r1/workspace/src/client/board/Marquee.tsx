import { useRef, useCallback, useState } from 'react';
import { screenToWorld, type Camera } from '../canvas/camera';
import { normalizeRect, type Rect } from '../../shared/geometry';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';

export interface UseMarqueeResult {
  rect: Rect | null;
  begin(screen: { x: number; y: number }): void;
  move(screen: { x: number; y: number }): void;
  end(): void;
  cancel(): void;
}

export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): UseMarqueeResult {
  const [rect, setRect] = useState<Rect | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const begin = useCallback((screen: { x: number; y: number }) => {
    const cam = cameraRef.current;
    const world = screenToWorld(cam, screen);
    startRef.current = world;
    setRect({ x: world.x, y: world.y, width: 0, height: 0 });
  }, []);

  const move = useCallback((screen: { x: number; y: number }) => {
    if (!startRef.current) return;
    const cam = cameraRef.current;
    const world = screenToWorld(cam, screen);
    const r = normalizeRect(startRef.current, world);
    setRect(r);
  }, []);

  const end = useCallback(() => {
    const r = rect;
    startRef.current = null;
    setRect(null);
    if (r && r.width > 0 && r.height > 0) {
      const ids = objectsInRect(snapshotRef.current, r);
      if (ids.length > 0) {
        onSelectRef.current(ids);
      }
    }
  }, [rect]);

  const cancel = useCallback(() => {
    startRef.current = null;
    setRect(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

export interface MarqueeRectProps {
  rect: Rect | null;
  camera: Camera;
}

/**
 * Renders the translucent blue selection rectangle in the world layer.
 */
export function MarqueeRect(props: MarqueeRectProps) {
  const { rect } = props;
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;

  return (
    <div
      data-testid="marquee-rect"
      className="marquee-rect"
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        border: '1px solid rgba(59, 130, 246, 0.5)',
        pointerEvents: 'none',
        zIndex: 99999,
      }}
    />
  );
}
