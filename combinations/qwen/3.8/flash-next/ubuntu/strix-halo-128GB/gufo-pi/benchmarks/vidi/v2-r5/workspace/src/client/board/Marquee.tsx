/**
 * Marquee: Shift+drag rectangle for box selection.
 *
 * useMarquee manages the state; MarqueeRect renders the translucent rectangle.
 */

import { useCallback, useRef, useState } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectsInRect } from '../../shared/board-model';
import type { Rect } from '../../shared/geometry';
import { normalizeRect } from '../../shared/geometry';

export interface UseMarqueeResult {
  rect: Rect | null;
  begin(screen: Point): void;
  move(screen: Point): void;
  end(): void;
  cancel(): void;
}

export interface UseMarqueeOptions {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  onSelect(ids: string[]): void;
}

export function useMarquee(options: UseMarqueeOptions): UseMarqueeResult {
  const { camera, snapshot, onSelect } = options;
  const [rect, setRect] = useState<Rect | null>(null);
  const rectRef = useRef<Rect | null>(null);
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
    const r = { x: world.x, y: world.y, width: 0, height: 0 };
    rectRef.current = r;
    setRect(r);
  }, []);

  const move = useCallback((screen: Point) => {
    const start = startRef.current;
    if (!start) return;
    const world = screenToWorld(cameraRef.current, screen);
    const r = normalizeRect(start, world);
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
      if (ids.length > 0) {
        onSelectRef.current(ids);
      }
    }
  }, []);

  const cancel = useCallback(() => {
    startRef.current = null;
    rectRef.current = null;
    setRect(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

export interface MarqueeRectProps {
  rect: Rect | null;
  camera: Camera;
}

/**
 * Renders the translucent selection rectangle in world coordinates (inside the world layer).
 */
export function MarqueeRect({ rect, camera: _camera }: MarqueeRectProps) {
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
        background: 'rgba(25, 118, 210, 0.1)',
        border: '1px solid rgba(25, 118, 210, 0.5)',
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    />
  );
}
