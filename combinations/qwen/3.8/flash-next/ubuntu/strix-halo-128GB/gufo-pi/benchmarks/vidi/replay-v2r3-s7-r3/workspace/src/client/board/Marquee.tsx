import { useCallback, useRef } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { normalizeRect, type Rect } from '../../shared/geometry';

export interface UseMarqueeResult {
  rect: Rect | null;
  begin(screen: Point): void;
  move(screen: Point): void;
  end(): void;
  cancel(): void;
}

/**
 * Manages the Shift+drag marquee selection rectangle state.
 * The rect is stored in world units so zoom changes during drag are harmless.
 */
export function useMarquee(
  camera: Camera,
  _snapshot: readonly unknown[],
  onSelect: (ids: string[]) => void,
  _getObjectsInRect: (rect: Rect) => string[],
): UseMarqueeResult & { getRect(): Rect | null; isActive(): boolean } {
  const startRef = useRef<Point | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const activeRef = useRef(false);

  const begin = useCallback((screen: Point) => {
    const world = screenToWorld(camera, screen);
    startRef.current = world;
    rectRef.current = null;
    activeRef.current = true;
  }, [camera]);

  const move = useCallback((screen: Point) => {
    if (!activeRef.current || !startRef.current) return;
    const world = screenToWorld(camera, screen);
    rectRef.current = normalizeRect(startRef.current, world);
  }, [camera]);

  const end = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    const rect = rectRef.current;
    startRef.current = null;
    rectRef.current = null;
    if (rect && rect.width > 0 && rect.height > 0) {
      const ids = _getObjectsInRect(rect);
      onSelect(ids);
    }
  }, [_getObjectsInRect, onSelect]);

  const cancel = useCallback(() => {
    activeRef.current = false;
    startRef.current = null;
    rectRef.current = null;
  }, []);

  return {
    get rect() { return rectRef.current; },
    begin,
    move,
    end,
    cancel,
    getRect: () => rectRef.current,
    isActive: () => activeRef.current,
  };
}

export interface MarqueeRectProps {
  rect: Rect | null;
  camera: Camera;
}

/**
 * Renders the translucent marquee rectangle in screen space.
 */
export function MarqueeRect({ rect, camera }: MarqueeRectProps) {
  if (!rect || rect.width === 0 || rect.height === 0) return null;

  const tl = {
    x: (rect.x - camera.x) * camera.zoom,
    y: (rect.y - camera.y) * camera.zoom,
  };
  const w = rect.width * camera.zoom;
  const h = rect.height * camera.zoom;

  return (
    <div
      data-testid="marquee-rect"
      style={{
        position: 'absolute',
        left: tl.x,
        top: tl.y,
        width: w,
        height: h,
        backgroundColor: 'rgba(25, 118, 210, 0.1)',
        border: '1px solid rgba(25, 118, 210, 0.6)',
        pointerEvents: 'none',
        zIndex: 1002,
      }}
    />
  );
}
