import { useCallback, useRef, useState } from 'react';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { Rect } from '../../shared/geometry';
import { normalizeRect } from '../../shared/geometry';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectsInRect } from '../../shared/board-model';

export interface UseMarqueeResult {
  rect: Rect | null;
  begin(screen: { x: number; y: number }): void;
  move(screen: { x: number; y: number }): void;
  end(): void;
  cancel(): void;
}

/**
 * Shift+drag marquee selection. Stores the rect in world units so zoom changes
 * during the drag are harmless.
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): UseMarqueeResult {
  const [rect, setRect] = useState<Rect | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const startWorldRef = useRef<{ x: number; y: number } | null>(null);
  const activeRef = useRef(false);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const begin = useCallback((screen: { x: number; y: number }) => {
    const world = screenToWorld(cameraRef.current, screen);
    startWorldRef.current = world;
    activeRef.current = true;
    const r = { x: world.x, y: world.y, width: 0, height: 0 };
    rectRef.current = r;
    setRect(r);
  }, []);

  const move = useCallback((screen: { x: number; y: number }) => {
    if (!activeRef.current || !startWorldRef.current) return;
    const world = screenToWorld(cameraRef.current, screen);
    const r = normalizeRect(startWorldRef.current, world);
    rectRef.current = r;
    setRect(r);
  }, []);

  const end = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    const r = rectRef.current;
    rectRef.current = null;
    setRect(null);
    if (r && (r.width > 0 || r.height > 0)) {
      const ids = objectsInRect(snapshotRef.current, r);
      if (ids.length > 0) {
        onSelectRef.current(ids);
      }
    }
    startWorldRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    activeRef.current = false;
    rectRef.current = null;
    setRect(null);
    startWorldRef.current = null;
  }, []);

  return { rect, begin, move, end, cancel };
}

export interface MarqueeRectProps {
  rect: Rect | null;
  camera: Camera;
}

/**
 * Renders the translucent blue selection rectangle in screen space.
 */
export function MarqueeRect({ rect, camera }: MarqueeRectProps) {
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;

  // Convert world rect to screen
  const x1 = (rect.x - camera.x) * camera.zoom;
  const y1 = (rect.y - camera.y) * camera.zoom;
  const w = rect.width * camera.zoom;
  const h = rect.height * camera.zoom;

  return (
    <div
      data-testid="marquee-rect"
      style={{
        position: 'absolute',
        left: x1,
        top: y1,
        width: w,
        height: h,
        backgroundColor: 'rgba(25, 118, 210, 0.1)',
        border: '1px solid rgba(25, 118, 210, 0.5)',
        pointerEvents: 'none',
        zIndex: 1001,
      }}
    />
  );
}
