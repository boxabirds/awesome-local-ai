import { useCallback, useRef, useState } from 'react';
import { Camera, Point, screenToWorld } from '@client/canvas/camera';
import { ObjectSnapshot, objectsInRect } from '@shared/board-model';
import { Rect, normalizeRect } from '@shared/geometry';

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
  const rectRef = useRef<Rect | null>(null);
  const startWorldRef = useRef<Point | null>(null);
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
    startWorldRef.current = world;
    const r = { x: world.x, y: world.y, width: 0, height: 0 };
    rectRef.current = r;
    setRect(r);
  }, []);

  const move = useCallback((screen: Point) => {
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
    if (r && r.width > 0 && r.height > 0) {
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

export function MarqueeRect({ rect, camera }: MarqueeRectProps) {
  if (!rect || rect.width === 0 || rect.height === 0) return null;
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
        zIndex: 1002,
      }}
    />
  );
}
