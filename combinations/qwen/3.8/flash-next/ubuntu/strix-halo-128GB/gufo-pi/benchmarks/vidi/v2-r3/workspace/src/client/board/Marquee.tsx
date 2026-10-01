import { useRef, useCallback, useState } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { Rect } from '../../shared/geometry';
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

/**
 * Shift+drag marquee selection state machine.
 * Stores the rect in world units so zoom changes during drag are harmless.
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): UseMarqueeResult {
  const [rect, setRect] = useState<Rect | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const startRef = useRef<Point | null>(null);
  const activeRef = useRef(false);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const begin = useCallback((screen: Point) => {
    activeRef.current = true;
    const world = screenToWorld(cameraRef.current, screen);
    startRef.current = world;
    const r = { x: world.x, y: world.y, width: 0, height: 0 };
    rectRef.current = r;
    setRect(r);
  }, []);

  const move = useCallback((screen: Point) => {
    if (!activeRef.current || !startRef.current) return;
    const world = screenToWorld(cameraRef.current, screen);
    const r = normalizeRect(startRef.current, world);
    rectRef.current = r;
    setRect(r);
  }, []);

  const end = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    const r = rectRef.current;
    startRef.current = null;
    rectRef.current = null;
    setRect(null);
    if (r && r.width > 0 && r.height > 0) {
      const ids = objectsInRect(snapshotRef.current, r);
      if (ids.length > 0) {
        onSelectRef.current(ids);
      }
    }
  }, []);

  const cancel = useCallback(() => {
    activeRef.current = false;
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
 * Renders the translucent selection rectangle in screen space.
 */
export function MarqueeRect({ rect, camera }: MarqueeRectProps) {
  if (!rect || rect.width === 0 || rect.height === 0) return null;

  const sx = (rect.x - camera.x) * camera.zoom;
  const sy = (rect.y - camera.y) * camera.zoom;
  const sw = rect.width * camera.zoom;
  const sh = rect.height * camera.zoom;

  return (
    <div
      data-testid="marquee-rect"
      style={{
        position: 'fixed',
        left: sx,
        top: sy,
        width: sw,
        height: sh,
        backgroundColor: 'rgba(100, 150, 255, 0.15)',
        border: '1px solid rgba(100, 150, 255, 0.6)',
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    />
  );
}
