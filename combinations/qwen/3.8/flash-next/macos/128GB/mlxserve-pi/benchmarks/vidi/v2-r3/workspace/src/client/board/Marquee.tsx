import { useCallback, useRef, useState, type JSX } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { Rect } from '../../shared/geometry';
import { normalizeRect } from '../../shared/geometry';

export interface UseMarqueeResult {
  /** The current marquee rect in world coordinates, or null when inactive. */
  rect: Rect | null;
  /** Begin a marquee at a screen-space point. */
  begin(screen: Point): void;
  /** Move the marquee to a new screen-space point. */
  move(screen: Point): void;
  /** End the marquee (computes selection). */
  end(): void;
  /** Cancel the marquee without selecting. */
  cancel(): void;
}

/**
 * Hook managing the marquee selection state.
 *
 * - begin: called on Shift+pointerdown on empty viewport space
 * - move: called on pointermove during marquee
 * - end: called on pointerup → calls onSelect with ids fully inside
 * - cancel: called on Escape/pointercancel → no selection change
 */
export function useMarquee(
  camera: Camera,
  onSelect: (ids: string[]) => void,
  objectsInRectFn: (rect: Rect) => string[],
): UseMarqueeResult {
  const [rect, setRect] = useState<Rect | null>(null);
  const startRef = useRef<Point | null>(null);
  const activeRef = useRef(false);

  const begin = useCallback((screen: Point) => {
    activeRef.current = true;
    const world = screenToWorld(camera, screen);
    startRef.current = world;
    setRect({ x: world.x, y: world.y, width: 0, height: 0 });
  }, [camera]);

  const move = useCallback((screen: Point) => {
    if (!activeRef.current || startRef.current === null) return;
    const world = screenToWorld(camera, screen);
    const normalized = normalizeRect(startRef.current, world);
    setRect(normalized);
  }, [camera]);

  const end = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    const currentRect = rect;
    startRef.current = null;
    setRect(null);
    if (currentRect !== null && (currentRect.width > 0 || currentRect.height > 0)) {
      const ids = objectsInRectFn(currentRect);
      onSelect(ids);
    }
  }, [rect, objectsInRectFn, onSelect]);

  const cancel = useCallback(() => {
    activeRef.current = false;
    startRef.current = null;
    setRect(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

export interface MarqueeRectProps {
  /** The marquee rect in world coordinates, or null. */
  rect: Rect | null;
  /** The current camera for converting world to screen. */
  camera: Camera;
}

/**
 * Renders the translucent marquee selection rectangle. Positioned in screen
 * space (as a fixed overlay) so it's not affected by the world layer transform.
 */
export function MarqueeRect(props: MarqueeRectProps): JSX.Element | null {
  const { rect, camera } = props;
  if (rect === null) return null;

  // Convert world rect to screen rect
  const screenTopLeft = {
    x: (rect.x - camera.x) * camera.zoom,
    y: (rect.y - camera.y) * camera.zoom,
  };
  const screenWidth = rect.width * camera.zoom;
  const screenHeight = rect.height * camera.zoom;

  return (
    <div
      className="marquee-rect"
      data-testid="marquee-rect"
      style={{
        position: 'fixed',
        left: `${screenTopLeft.x}px`,
        top: `${screenTopLeft.y}px`,
        width: `${screenWidth}px`,
        height: `${screenHeight}px`,
        pointerEvents: 'none',
      }}
    />
  );
}
