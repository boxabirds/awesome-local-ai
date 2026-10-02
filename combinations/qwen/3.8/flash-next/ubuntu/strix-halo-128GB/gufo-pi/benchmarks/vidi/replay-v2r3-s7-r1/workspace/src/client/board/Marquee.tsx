import React, { useCallback, useRef, useState } from 'react';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { Rect, Point } from '../../shared/geometry';
import { normalizeRect } from '../../shared/geometry';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectsInRect } from '../../shared/board-model';

export interface UseMarqueeResult {
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
): UseMarqueeResult {
  const [rect, setRect] = useState<Rect | null>(null);
  const startRef = useRef<Point | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const begin = useCallback((screen: Point) => {
    const world = screenToWorld(cameraRef.current, screen);
    startRef.current = world;
    setRect({ x: world.x, y: world.y, width: 0, height: 0 });
  }, []);

  const move = useCallback((screen: Point) => {
    if (!startRef.current) return;
    const world = screenToWorld(cameraRef.current, screen);
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
 * Draws a translucent blue selection rectangle in screen space.
 */
export function MarqueeRect({ rect, camera }: MarqueeRectProps) {
  if (!rect) return null;

  // Convert world rect to screen rect
  const tl = screenToWorld(camera, { x: rect.x, y: rect.y });
  // Actually we need worldToScreen
  const toScreen = (p: Point): Point => ({
    x: (p.x - camera.x) * camera.zoom,
    y: (p.y - camera.y) * camera.zoom,
  });

  const screenTL = toScreen({ x: rect.x, y: rect.y });
  const screenBR = toScreen({ x: rect.x + rect.width, y: rect.y + rect.height });

  return (
    <div
      data-testid="marquee-rect"
      style={{
        position: 'absolute',
        left: screenTL.x,
        top: screenTL.y,
        width: screenBR.x - screenTL.x,
        height: screenBR.y - screenTL.y,
        backgroundColor: 'rgba(25, 118, 210, 0.15)',
        border: '1px solid rgba(25, 118, 210, 0.5)',
        pointerEvents: 'none',
        zIndex: 2000,
      }}
    />
  );
}
