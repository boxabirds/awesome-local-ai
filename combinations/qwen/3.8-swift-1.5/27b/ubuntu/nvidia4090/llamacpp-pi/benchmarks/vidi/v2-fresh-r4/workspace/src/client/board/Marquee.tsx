import { useCallback, useRef, useState, type JSX } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectsInRect } from '../../shared/board-model';
import { normalizeRect, type Rect } from '../../shared/geometry';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';

export interface UseMarqueeResult {
  rect: Rect | null;
  begin(screenPoint: Point): void;
  move(screenPoint: Point): void;
  end(): void;
  cancel(): void;
}

/**
 * Hook for Shift+drag marquee selection.
 * Stores the rect in world units so zoom changes during drag are harmless.
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): UseMarqueeResult {
  const [rect, setRect] = useState<Rect | null>(null);
  const startWorldRef = useRef<Point | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const begin = useCallback((screenPoint: Point) => {
    const world = screenToWorld(cameraRef.current, screenPoint);
    startWorldRef.current = world;
    setRect({ x: world.x, y: world.y, width: 0, height: 0 });
  }, []);

  const move = useCallback((screenPoint: Point) => {
    if (!startWorldRef.current) return;
    const world = screenToWorld(cameraRef.current, screenPoint);
    setRect(normalizeRect(startWorldRef.current, world));
  }, []);

  const end = useCallback(() => {
    if (rect && rect.width > 0 && rect.height > 0) {
      const ids = objectsInRect(snapshot, rect);
      if (ids.length > 0) {
        onSelect(ids);
      }
    }
    startWorldRef.current = null;
    setRect(null);
  }, [rect, snapshot, onSelect]);

  const cancel = useCallback(() => {
    startWorldRef.current = null;
    setRect(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

export interface MarqueeRectProps {
  rect: Rect | null;
  camera: Camera;
}

/**
 * Renders the marquee selection rectangle in screen space.
 */
export function MarqueeRect(props: MarqueeRectProps): JSX.Element | null {
  const { rect, camera } = props;
  if (!rect) return null;

  const screenX = (rect.x - camera.x) * camera.zoom;
  const screenY = (rect.y - camera.y) * camera.zoom;
  const screenW = rect.width * camera.zoom;
  const screenH = rect.height * camera.zoom;

  return (
    <div
      className="marquee-rect"
      data-vidi6="marquee-rect"
      style={{
        position: 'absolute',
        left: `${screenX}px`,
        top: `${screenY}px`,
        width: `${screenW}px`,
        height: `${screenH}px`,
        backgroundColor: 'rgba(66, 133, 244, 0.1)',
        border: '1px solid rgba(66, 133, 244, 0.5)',
        pointerEvents: 'none',
      }}
    />
  );
}
