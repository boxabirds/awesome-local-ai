import { useCallback, useRef, useState } from 'react';
import type { Camera } from '../canvas/camera';
import { screenToWorld, type Point } from '../canvas/camera';
import { normalizeRect, type Rect } from '../../shared/geometry';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';

export interface UseMarqueeResult {
  rect: Rect | null;
  begin(screen: Point): void;
  move(screen: Point): void;
  end(): void;
  cancel(): void;
}

/**
 * Marquee (Shift+drag) selection hook.
 * Stores the rect in world units so zoom changes during drag are harmless.
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): UseMarqueeResult & { cameraRef: React.MutableRefObject<Camera>; snapshotRef: React.MutableRefObject<readonly ObjectSnapshot[]> } {
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
    const cam = cameraRef.current;
    const world = screenToWorld(cam, screen);
    startRef.current = world;
    const r = { x: world.x, y: world.y, width: 0, height: 0 };
    rectRef.current = r;
    setRect(r);
  }, []);

  const move = useCallback((screen: Point) => {
    if (!startRef.current) return;
    const cam = cameraRef.current;
    const world = screenToWorld(cam, screen);
    const r = normalizeRect(startRef.current, world);
    rectRef.current = r;
    setRect(r);
  }, []);

  const end = useCallback(() => {
    if (!startRef.current) return;
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

  return { rect, begin, move, end, cancel, cameraRef, snapshotRef };
}

export interface MarqueeRectProps {
  rect: Rect | null;
  camera: Camera;
}

/** Renders the translucent selection rectangle in screen space. */
export function MarqueeRect(props: MarqueeRectProps) {
  if (!props.rect) return null;
  const cam = props.camera;
  const x = (props.rect.x - cam.x) * cam.zoom;
  const y = (props.rect.y - cam.y) * cam.zoom;
  const w = props.rect.width * cam.zoom;
  const h = props.rect.height * cam.zoom;

  return (
    <div
      className="marquee-rect"
      data-testid="marquee-rect"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        backgroundColor: 'rgba(74, 144, 217, 0.15)',
        border: '1px solid rgba(74, 144, 217, 0.7)',
        pointerEvents: 'none',
        zIndex: 10000,
      }}
    />
  );
}
