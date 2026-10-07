import { useRef, useCallback, useState } from 'react';
import { normalizeRect, type Rect, type Point as GeoPoint } from '../../shared/geometry';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';

export interface UseMarqueeResult {
  rect: Rect | null;
  begin(screen: GeoPoint): void;
  move(screen: GeoPoint): void;
  end(): void;
  cancel(): void;
}

/**
 * Hook for Shift+drag marquee selection.
 * Rect is stored in world units so zoom changes during drag are harmless.
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): UseMarqueeResult {
  const [rect, setRect] = useState<Rect | null>(null);
  const startRef = useRef<GeoPoint | null>(null);
  const activeRef = useRef(false);
  const camRef = useRef(camera);
  camRef.current = camera;
  const snapRef = useRef(snapshot);
  snapRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const begin = useCallback((screen: GeoPoint) => {
    const cam = camRef.current;
    const world = screenToWorld(cam, screen);
    startRef.current = world;
    activeRef.current = true;
    setRect({ x: world.x, y: world.y, width: 0, height: 0 });
  }, []);

  const move = useCallback((screen: GeoPoint) => {
    if (!activeRef.current || !startRef.current) return;
    const cam = camRef.current;
    const world = screenToWorld(cam, screen);
    const r = normalizeRect(startRef.current, world);
    setRect(r);
  }, []);

  const end = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    const r = rect;
    startRef.current = null;
    setRect(null);
    if (r && (r.width > 0 || r.height > 0)) {
      const ids = objectsInRect(snapRef.current, r);
      if (ids.length > 0) {
        onSelectRef.current(ids);
      }
    }
  }, [rect]);

  const cancel = useCallback(() => {
    activeRef.current = false;
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
 * Renders the translucent selection rectangle in screen space.
 */
export function MarqueeRect({ rect, camera }: MarqueeRectProps) {
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;
  const { zoom, x: camX, y: camY } = camera;
  const sx = (rect.x - camX) * zoom;
  const sy = (rect.y - camY) * zoom;
  const sw = rect.width * zoom;
  const sh = rect.height * zoom;
  return (
    <div
      className="marquee-rect"
      data-testid="marquee-rect"
      style={{
        position: 'absolute',
        left: sx,
        top: sy,
        width: sw,
        height: sh,
        background: 'rgba(26, 115, 232, 0.15)',
        border: '1px solid rgba(26, 115, 232, 0.6)',
        pointerEvents: 'none',
        zIndex: 999,
      }}
    />
  );
}
