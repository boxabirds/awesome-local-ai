/**
 * Shift+drag marquee selection rectangle.
 *
 * `useMarquee` manages the marquee state; `MarqueeRect` renders it in screen space.
 */
import { useCallback, useRef, useState, type JSX } from 'react';
import { type Camera, screenToWorld } from '../canvas/camera';
import type { Point, Rect } from '../../shared/geometry';
import { normalizeRect } from '../../shared/geometry';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectsInRect } from '../../shared/board-model';

export interface MarqueeState {
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
): MarqueeState {
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
    startRef.current = screen;
    rectRef.current = null;
    setRect(null);
  }, []);

  const move = useCallback((screen: Point) => {
    if (!activeRef.current || !startRef.current) return;
    const start = startRef.current;
    const cam = cameraRef.current;
    const worldStart = screenToWorld(cam, start);
    const worldEnd = screenToWorld(cam, screen);
    const worldRect = normalizeRect(worldStart, worldEnd);
    rectRef.current = worldRect;
    setRect(worldRect);
  }, []);

  const end = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    const r = rectRef.current;
    rectRef.current = null;
    setRect(null);
    startRef.current = null;
    if (!r) return;
    const ids = objectsInRect(snapshotRef.current, r);
    if (ids.length > 0) {
      onSelectRef.current(ids);
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

export function MarqueeRect(props: MarqueeRectProps): JSX.Element | null {
  const { rect, camera } = props;
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;

  const screenX = (rect.x - camera.x) * camera.zoom;
  const screenY = (rect.y - camera.y) * camera.zoom;
  const screenW = rect.width * camera.zoom;
  const screenH = rect.height * camera.zoom;

  return (
    <div
      className="marquee-rect"
      data-testid="marquee-rect"
      style={{
        left: screenX,
        top: screenY,
        width: screenW,
        height: screenH,
      }}
    />
  );
}
